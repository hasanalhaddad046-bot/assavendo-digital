import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";
import { initializePayment, canCharge } from "@/lib/paystack";
import { scoreRisk, decideRisk, type VpnPolicy } from "@/lib/risk";
import { getFx } from "@/lib/fx";

export const runtime = "nodejs";

interface Body {
  productId?: string;
  qty?: number;
  email?: string;
  shipCountry?: string;
  address?: { name?: string; phone?: string; line1?: string; city?: string; region?: string; postal?: string };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.productId || !body.email || !EMAIL.test(body.email) || !/^[A-Za-z]{2}$/.test(body.shipCountry ?? "")) {
    return Response.json({ error: "Données invalides." }, { status: 400 });
  }
  const qty = Math.min(Math.max(Math.floor(body.qty ?? 1), 1), 20);
  const a = body.address ?? {};
  if (!a.name || !a.phone || !a.line1 || !a.city) {
    return Response.json({ error: "Adresse de livraison incomplète." }, { status: 400 });
  }
  const ship = body.shipCountry!.toUpperCase();

  const settings = await getSettings();
  if (!canCharge(settings, true)) {
    // Verrou d'éligibilité Paystack : on ne crée ni commande ni paiement.
    return Response.json(
      { error: "Le paiement en ligne n'est pas encore ouvert. Contactez-nous pour commander." },
      { status: 503 },
    );
  }

  const db = supabaseAdmin();
  // Prix lu en base, jamais envoyé par le navigateur.
  const { data: product } = await db
    .from("products")
    .select("id,price_usd_minor,status,kind")
    .eq("id", body.productId)
    .eq("status", "published")
    .maybeSingle();
  if (!product || !product.price_usd_minor) {
    return Response.json({ error: "Produit indisponible." }, { status: 404 });
  }

  // Offre vérifiée qui dessert ce pays (instantané conservé avec la ligne de commande).
  const { data: offers } = await db
    .from("offers")
    .select("id,supplier_id,supplier_sku,variant,price_minor,currency,fulfilment_mode,destinations,source_url")
    .eq("product_id", product.id)
    .eq("status", "verified");
  const offer = (offers ?? []).find((o) => !o.destinations?.length || o.destinations.includes(ship));
  if (product.kind === "physical" && !offer) {
    return Response.json({ error: "Livraison indisponible vers ce pays." }, { status: 422 });
  }

  // Risque : signaux serveur uniquement.
  const ipCountry = req.headers.get("x-vercel-ip-country") ?? undefined;
  const totalMinor = Number(product.price_usd_minor) * qty;
  const signals = { ipCountry, shipCountry: ship, highValue: totalMinor >= 50_000 };
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
      ship_address: a,
      total_usd_minor: totalMinor,
      risk_score: risk.score,
      risk_reasons: risk.reasons,
      status: decision.action === "manual_review" ? "manual_review" : "awaiting_payment",
    })
    .select("id")
    .single();
  if (oErr || !order) return Response.json({ error: "Commande impossible." }, { status: 500 });

  await db.from("order_items").insert({
    order_id: order.id,
    product_id: product.id,
    qty,
    unit_usd_minor: product.price_usd_minor,
    offer_snapshot: offer ?? null,
  });

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
