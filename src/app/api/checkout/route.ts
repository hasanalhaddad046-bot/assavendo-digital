import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";
import { initializePayment, canCharge } from "@/lib/paystack";
import { scoreRisk, decideRisk, type VpnPolicy } from "@/lib/risk";
import { getFx } from "@/lib/fx";
import { validateAddress, normalizePhone } from "@/lib/address";
import { checkAnonymizer } from "@/lib/ipcheck";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

interface Body {
  items?: { productId?: string; qty?: number }[];
  email?: string;
  shipCountry?: string;
  address?: { name?: string; phone?: string; line1?: string; city?: string; region?: string; postal?: string };
  acceptTerms?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`checkout:${ip}`, 10, 10 * 60_000)) {
    return Response.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.email || !EMAIL.test(body.email) || !/^[A-Za-z]{2}$/.test(body.shipCountry ?? "")) {
    return Response.json({ error: "Données invalides." }, { status: 400 });
  }
  if (!body.acceptTerms) {
    return Response.json({ error: "Vous devez accepter les conditions générales de vente." }, { status: 400 });
  }
  const rawItems = (body.items ?? []).slice(0, 20);
  if (rawItems.length === 0) return Response.json({ error: "Panier vide." }, { status: 400 });
  const a = body.address ?? {};
  if (!a.name || !a.phone || !a.line1 || !a.city) {
    return Response.json({ error: "Adresse de livraison incomplète." }, { status: 400 });
  }
  const ship = body.shipCountry!.toUpperCase();
  const addrErr = validateAddress(ship, a.phone, a.postal);
  if (addrErr) return Response.json({ error: addrErr }, { status: 400 });

  const settings = await getSettings();
  if (!canCharge(settings, true)) {
    // Verrou d'éligibilité Paystack : on ne crée ni commande ni paiement.
    return Response.json(
      { error: "Le paiement en ligne n'est pas encore ouvert. Contactez-nous pour commander." },
      { status: 503 },
    );
  }

  const db = supabaseAdmin();
  // Regroupe les lignes identiques ; les prix viennent de la base, jamais du navigateur.
  const wanted = new Map<string, number>();
  for (const it of rawItems) {
    if (!it.productId) continue;
    const q = Math.min(Math.max(Math.floor(it.qty ?? 1), 1), 20);
    wanted.set(it.productId, Math.min((wanted.get(it.productId) ?? 0) + q, 20));
  }
  const ids = [...wanted.keys()];
  const { data: products } = await db
    .from("products")
    .select("id,name,price_usd_minor,status,kind")
    .in("id", ids)
    .eq("status", "published");
  if (!products || products.length !== ids.length || products.some((p) => !p.price_usd_minor)) {
    return Response.json({ error: "Un article n'est plus disponible." }, { status: 404 });
  }
  const { data: offers } = await db
    .from("offers")
    .select("id,product_id,supplier_id,supplier_sku,variant,price_minor,currency,fulfilment_mode,destinations,source_url")
    .in("product_id", ids)
    .eq("status", "verified");
  const { data: rules } = await db.from("delivery_rules").select("*").in("product_id", ids).eq("country", ship);

  let itemsTotal = 0;
  let shipping = 0;
  const lines: Record<string, unknown>[] = [];
  for (const p of products) {
    const qty = wanted.get(p.id)!;
    let offer = null;
    let duty: string | null = null;
    if (p.kind === "physical") {
      offer = (offers ?? []).find((o) => o.product_id === p.id && (!o.destinations?.length || o.destinations.includes(ship))) ?? null;
      const rule = (rules ?? []).find((r) => r.product_id === p.id);
      if (!offer || !rule) {
        return Response.json({ error: `« ${p.name} » n'est pas livrable vers ce pays.` }, { status: 422 });
      }
      duty = rule.duty_mode;
      shipping += Number(rule.shipping_usd_minor); // frais par ligne, indépendants de la quantité
    }
    itemsTotal += Number(p.price_usd_minor) * qty;
    lines.push({
      product_id: p.id, product_name: p.name, qty, unit_usd_minor: p.price_usd_minor,
      offer_snapshot: offer, duty_mode: duty,
    });
  }
  const totalMinor = itemsTotal + shipping;

  // Risque : signaux serveur uniquement.
  const ipCountry = req.headers.get("x-vercel-ip-country") ?? undefined;
  const anon = await checkAnonymizer(ip);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await db
    .from("orders").select("id", { count: "exact", head: true })
    .eq("email", body.email).gte("created_at", since);
  const signals = {
    ipCountry, shipCountry: ship, highValue: totalMinor >= 50_000,
    anonymizer: anon?.anonymizer, anonymizerConfidence: anon?.confidence,
    ordersLastHour: recent ?? 0,
  };
  const risk = scoreRisk(signals);
  const decision = decideRisk(risk, signals, (settings.vpn_policy as VpnPolicy) || "challenge");
  if (decision.action === "block_checkout" || decision.action === "block_site") {
    await audit("checkout_blocked", body.email, { risk, decision });
    return Response.json({ error: "Vérification supplémentaire requise. Contactez le support." }, { status: 403 });
  }

  const { data: order, error: oErr } = await db
    .from("orders")
    .insert({
      email: body.email,
      ship_country: ship,
      ship_address: { ...a, phone: normalizePhone(a.phone) },
      total_usd_minor: totalMinor,
      shipping_usd_minor: shipping,
      risk_score: risk.score,
      risk_reasons: risk.reasons,
      status: decision.action === "manual_review" ? "manual_review" : "awaiting_payment",
    })
    .select("id")
    .single();
  if (oErr || !order) return Response.json({ error: "Commande impossible." }, { status: 500 });

  await db.from("order_items").insert(lines.map((l) => ({ ...l, order_id: order.id })));
  await db.from("order_events").insert({ order_id: order.id, kind: "created", message: "Commande enregistrée, en attente de paiement." });

  try {
    const fx = await getFx();
    const pay = await initializePayment({
      orderId: order.id,
      email: body.email,
      amountMinor: totalMinor,
      currency: "USD",
      fxSnapshot: fx ? { fetchedAt: fx.fetchedAt } : null,
    });
    return Response.json({ url: pay.authorizationUrl });
  } catch (e) {
    await audit("checkout_init_failed", order.id, String(e));
    return Response.json({ error: "Paiement indisponible pour le moment." }, { status: 502 });
  }
}
