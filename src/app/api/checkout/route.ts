import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";
import { initializePayment, canCharge } from "@/lib/paystack";
import { initializeMalipopayPayment, isMalipopayReadyForDropshipping } from "@/lib/malipopay";
import { scoreRisk, decideRisk, type VpnPolicy } from "@/lib/risk";
import { getFx } from "@/lib/fx";
import { validateAddress, normalizePhone } from "@/lib/address";
import { checkAnonymizer } from "@/lib/ipcheck";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { toMinor } from "@/lib/money";
import { dispatchWorkflowEvent } from "@/lib/workflow-service";
import { getCustomerFromRequest } from "@/lib/customer-auth";

export const runtime = "nodejs";

interface Body {
  items?: { productId?: string; variantId?: string | null; qty?: number }[];
  email?: string;
  shipCountry?: string;
  displayCurrency?: string;
  turnstileToken?: string;
  address?: {
    name?: string; phone?: string; line1?: string; line2?: string; district?: string;
    landmark?: string; city?: string; region?: string; postal?: string;
  };
  acceptTerms?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    if (!(await rateLimit(`checkout:${ip}`, 10, 10 * 60_000))) {
      return Response.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 });
    }
  } catch {
    return Response.json({ error: "Le contrôle de sécurité est temporairement indisponible. Réessayez plus tard." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  let customer = null;
  try {
    customer = await getCustomerFromRequest(req);
  } catch {
    return Response.json({ error: "Impossible de vérifier votre session client. Réessayez." }, { status: 503 });
  }
  if (customer && customer.email.toLowerCase() !== String(body?.email ?? "").trim().toLowerCase()) {
    return Response.json({ error: "L'adresse e-mail de commande doit correspondre au compte connecté." }, { status: 403 });
  }
  if (!body?.email || !EMAIL.test(body.email) || !/^[A-Za-z]{2}$/.test(body.shipCountry ?? "")) {
    return Response.json({ error: "Données invalides." }, { status: 400 });
  }
  if (!body.acceptTerms) {
    return Response.json({ error: "Vous devez accepter les conditions générales de vente." }, { status: 400 });
  }
  const rawItems = (body.items ?? []).slice(0, 20);
  if (rawItems.length === 0) return Response.json({ error: "Panier vide." }, { status: 400 });
  const a = body.address ?? {};
  if (!a.name || !a.phone || !a.line1 || !a.city || !a.region || !a.district) {
    return Response.json({ error: "Adresse de livraison incomplète : nom, téléphone, région, district, ville et adresse précise sont requis." }, { status: 400 });
  }
  const ship = body.shipCountry!.toUpperCase();
  const displayCurrency = String(body.displayCurrency || "USD").toUpperCase();
  const allowedDisplayCurrencies = new Set(["USD","TZS","KES","UGX","RWF","EUR","GBP","CNY","JPY","NGN","ZAR","GHS","CAD","AUD","AED","SAR","INR","CHF"]);
  if (!allowedDisplayCurrencies.has(displayCurrency)) {
    return Response.json({ error: "Devise d'affichage non prise en charge." }, { status: 400 });
  }
  const addrErr = validateAddress(ship, a.phone, a.postal);
  if (addrErr) return Response.json({ error: addrErr }, { status: 400 });

  const settings = await getSettings();
  const paymentProvider = (process.env.PAYMENT_PROVIDER ?? "paystack").trim().toLowerCase();
  if (paymentProvider === "paystack" && !canCharge(settings, true)) {
    // Le profil Paystack Kenya reste verrouillé pour le dropshipping jusqu'à une autorisation écrite.
    return Response.json(
      { error: "Le paiement en ligne n'est pas encore ouvert. Contactez-nous pour commander." },
      { status: 503 },
    );
  }
  if (paymentProvider === "malipopay") {
    if (ship !== "TZ" || displayCurrency !== "TZS") {
      return Response.json(
        { error: "MALIPOPAY est réservé aux commandes livrées en Tanzanie et payées en TZS. Choisissez la devise TZS." },
        { status: 400 },
      );
    }
    if (!isMalipopayReadyForDropshipping()) {
      return Response.json(
        { error: "Le paiement tanzanien n'est pas encore activé : le compte marchand et l'activité doivent être approuvés." },
        { status: 503 },
      );
    }
  }
  if (paymentProvider !== "paystack" && paymentProvider !== "malipopay") {
    return Response.json({ error: "Le prestataire de paiement configuré n'est pas pris en charge." }, { status: 503 });
  }

  const db = supabaseAdmin();
  // Regroupe les mêmes variantes. Les prix et les offres sont toujours relus depuis Supabase.
  const wanted = new Map<string, { productId: string; variantId: string | null; qty: number }>();
  for (const item of rawItems) {
    if (!item.productId || !/^[0-9a-f-]{36}$/i.test(item.productId)) {
      return Response.json({ error: "Référence de produit invalide." }, { status: 400 });
    }
    const variantId = item.variantId ? String(item.variantId) : null;
    if (variantId && !/^[0-9a-f-]{36}$/i.test(variantId)) {
      return Response.json({ error: "Référence de variante invalide." }, { status: 400 });
    }
    const key = `${item.productId}::${variantId ?? "base"}`;
    const quantity = Math.min(Math.max(Math.floor(Number(item.qty ?? 1)), 1), 20);
    const previous = wanted.get(key);
    wanted.set(key, { productId: item.productId, variantId, qty: Math.min((previous?.qty ?? 0) + quantity, 20) });
  }
  const productIds = [...new Set([...wanted.values()].map((item) => item.productId))];

  const [{ data: products, error: productError }, { data: allVariants, error: variantError }] = await Promise.all([
    db.from("products").select("id,name,price_usd_minor,status,kind")
      .in("id", productIds).eq("status", "published"),
    db.from("product_variants").select("id,product_id,name,attributes,price_usd_minor,active")
      .in("product_id", productIds).eq("active", true),
  ]);
  if (productError || variantError) {
    return Response.json({ error: "Impossible de vérifier les articles du panier." }, { status: 502 });
  }
  if (!products || products.length !== productIds.length) {
    return Response.json({ error: "Un article n'est plus disponible." }, { status: 404 });
  }

  const variantById = new Map((allVariants ?? []).map((variant) => [variant.id, variant]));
  const variantsByProduct = new Map<string, typeof allVariants>();
  for (const variant of allVariants ?? []) {
    const group = variantsByProduct.get(variant.product_id) ?? [];
    group.push(variant);
    variantsByProduct.set(variant.product_id, group);
  }
  let selectedLines: Array<{
    productId: string; variantId: string | null; qty: number;
    product: (typeof products)[number]; variant: (typeof allVariants)[number] | null; unitPriceMinor: number;
  }>;
  try {
    selectedLines = [...wanted.values()].map((item) => {
    const product = products.find((row) => row.id === item.productId)!;
    const productVariants = variantsByProduct.get(product.id) ?? [];
    if (productVariants.length > 0 && !item.variantId) {
      throw new Error(`Choisissez une variante pour « ${product.name} ».`);
    }
    if (item.variantId && !variantById.has(item.variantId)) {
      throw new Error(`La variante choisie pour « ${product.name} » n'est plus disponible.`);
    }
    const variant = item.variantId ? variantById.get(item.variantId)! : null;
    if (variant && variant.product_id !== product.id) {
      throw new Error("Une variante ne correspond pas au produit du panier.");
    }
    const unitPrice = variant?.price_usd_minor ?? product.price_usd_minor;
    if (!Number.isSafeInteger(Number(unitPrice)) || Number(unitPrice) <= 0) {
      throw new Error(`Le prix de « ${product.name} » n'est pas configuré.`);
    }
      return { ...item, product, variant, unitPriceMinor: Number(unitPrice) };
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Variante ou prix invalide." }, { status: 422 });
  }
  const physicalLines = selectedLines.filter((line) => line.product.kind === "physical");
  const [{ data: offers, error: offersError }, { data: rules, error: rulesError }] = await Promise.all([
    physicalLines.length
      ? db.from("offers").select("id,product_id,variant_id,supplier_id,supplier_sku,variant,price_minor,currency,fulfilment_mode,destinations,source_url,agency_id,availability_status,available_qty,last_checked_at,valid_until,quality_score,weight_grams,dimensions_mm,suppliers!inner(trust_level)")
          .in("product_id", productIds).eq("status", "verified")
      : Promise.resolve({ data: [], error: null }),
    physicalLines.length
      ? db.from("delivery_rules").select("*").in("product_id", productIds).eq("country", ship)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (offersError || rulesError) {
    return Response.json({ error: "Impossible de vérifier les conditions fournisseur et livraison." }, { status: 502 });
  }

  let itemsTotal = 0;
  let shipping = 0;
  const lines: Record<string, unknown>[] = [];
  for (const line of selectedLines) {
    let offer: Record<string, any> | null = null;
    let duty: string | null = null;
    if (line.product.kind === "physical") {
      const matching = (offers ?? []).filter((candidate) => {
        if (candidate.product_id !== line.product.id) return false;
        if (candidate.variant_id && candidate.variant_id !== line.variant?.id) return false;
        if (candidate.destinations?.length && !candidate.destinations.includes(ship)) return false;
        const supplier = Array.isArray(candidate.suppliers) ? candidate.suppliers[0] : candidate.suppliers;
        if (supplier?.trust_level !== "approved") return false;
        if (!["available", "low_stock", "preorder"].includes(candidate.availability_status)) return false;
        if (candidate.available_qty !== null && Number(candidate.available_qty) <= 0) return false;
        const checkedAt = candidate.last_checked_at ? new Date(candidate.last_checked_at).getTime() : 0;
        const validUntil = candidate.valid_until ? new Date(candidate.valid_until).getTime() : Infinity;
        return checkedAt > 0 && Date.now() - checkedAt <= 14 * 86_400_000 && validUntil > Date.now();
      });
      offer = (matching.find((candidate) => candidate.variant_id === line.variant?.id) ?? matching.find((candidate) => !candidate.variant_id)) ?? null;
      const rule = (rules ?? []).find((row) => row.product_id === line.product.id);
      if (!offer || !rule) {
        return Response.json({ error: `« ${line.product.name} » n'est pas disponible pour cette destination ou son offre fournisseur doit être vérifiée.` }, { status: 422 });
      }
      duty = rule.duty_mode;
      shipping += Number(rule.shipping_usd_minor);
    }
    itemsTotal += line.unitPriceMinor * line.qty;
    const snapshot = offer ? {
      id: offer.id,
      supplier_id: offer.supplier_id,
      supplier_sku: offer.supplier_sku,
      source_url: offer.source_url,
      price_minor: offer.price_minor,
      currency: String(offer.currency).trim().toUpperCase(),
      variant: offer.variant,
      variant_id: offer.variant_id,
      fulfilment_mode: offer.fulfilment_mode,
      agency_id: offer.agency_id,
      destinations: offer.destinations,
      quality_score: offer.quality_score,
      weight_grams: offer.weight_grams,
      dimensions_mm: offer.dimensions_mm,
      last_checked_at: offer.last_checked_at,
      valid_until: offer.valid_until,
    } : null;
    lines.push({
      product_id: line.product.id,
      product_name: line.product.name,
      variant_id: line.variant?.id ?? null,
      qty: line.qty,
      unit_usd_minor: line.unitPriceMinor,
      supplier_id: offer?.supplier_id ?? null,
      source_price_minor: offer?.price_minor ?? null,
      source_currency: offer?.currency ?? null,
      offer_snapshot: snapshot,
      duty_mode: duty,
    });
  }

  const totalMinor = itemsTotal + shipping;

  // Devises d'affichage : conversion fondée sur le snapshot FX serveur, jamais sur le navigateur.
  const fx = await getFx();
  let displayFxSnapshot: Record<string, unknown> | null = null;
  if (displayCurrency === "USD") {
    displayFxSnapshot = { base: "USD", currency: "USD", rate: 1, amount_minor: totalMinor, source: "identity", fetched_at: new Date().toISOString() };
  } else {
    if (!fx?.fresh || !Number.isFinite(fx.rates[displayCurrency]) || fx.rates[displayCurrency] <= 0) {
      return Response.json({ error: "Le taux de change fiable pour cette devise est temporairement indisponible. Choisissez USD ou réessayez plus tard." }, { status: 503 });
    }
    const localAmountMinor = toMinor((totalMinor / 100) * fx.rates[displayCurrency], displayCurrency);
    displayFxSnapshot = {
      base: "USD", currency: displayCurrency, rate: fx.rates[displayCurrency],
      amount_minor: localAmountMinor, source: fx.sources[displayCurrency] ?? "unknown",
      fetched_at: new Date(fx.fetchedAt).toISOString(),
    };
  }

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
    return Response.json({ error: "Cette tentative ne peut pas continuer en ligne. Contactez le support pour une vérification." }, { status: 403 });
  }

  if (decision.action === "challenge") {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!siteKey || !secret || !body.turnstileToken) {
      await audit("checkout_challenge_unavailable", body.email, { risk, reason: "turnstile_not_configured_or_missing" });
      return Response.json({
        error: "Une vérification anti-fraude est nécessaire. Le contrôle en ligne n'est pas configuré ; contactez le support pour finaliser votre commande.",
        verificationRequired: true,
      }, { status: 403 });
    }
    const form = new URLSearchParams({ secret, response: body.turnstileToken, remoteip: ip });
    let verified = false;
    try {
      const challengeResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const result = await challengeResponse.json() as { success?: boolean; hostname?: string; action?: string };
      const expectedHost = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://assavendo-shop.vercel.app").hostname;
      verified = challengeResponse.ok && result.success === true && result.hostname === expectedHost;
    } catch {
      verified = false;
    }
    if (!verified) {
      await audit("checkout_challenge_failed", body.email, { risk });
      return Response.json({ error: "La vérification anti-fraude a échoué. Réessayez." }, { status: 403 });
    }
  }

  const { data: order, error: oErr } = await db
    .from("orders")
    .insert({
      email: body.email,
      user_id: customer?.id ?? null,
      ship_country: ship,
      ship_address: {
        name: a.name, phone: normalizePhone(a.phone), country: ship,
        region: a.region, district: a.district, city: a.city,
        line1: a.line1, line2: a.line2 || null, landmark: a.landmark || null,
        postal: a.postal || null,
      },
      total_usd_minor: totalMinor,
      shipping_usd_minor: shipping,
      display_currency: displayCurrency,
      display_fx_snapshot: displayFxSnapshot,
      terms_accepted_at: new Date().toISOString(),
      risk_score: risk.score,
      risk_reasons: risk.reasons,
      risk_reviewed_at: null,
      status: decision.action === "manual_review" ? "manual_review" : "awaiting_payment",
    })
    .select("id,number")
    .single();
  if (oErr || !order) return Response.json({ error: "Commande impossible." }, { status: 500 });

  await db.from("order_items").insert(lines.map((l) => ({ ...l, order_id: order.id })));
  await db.from("order_events").insert({ order_id: order.id, kind: "created", message: decision.action === "manual_review" ? "Commande reçue et placée en vérification anti-fraude. Aucun paiement ni achat fournisseur n'a été initié." : "Commande enregistrée, en attente de paiement." });

  if (decision.action === "manual_review") {
    await audit("checkout_manual_review", order.id, { risk, decision });
    try {
      await dispatchWorkflowEvent(db,"order_manual_review",{
        order_id:order.id,order_status:"manual_review",risk_score:risk.score,
        ship_country:ship,event_type:"order_manual_review",
      },`manual-review:${order.id}`);
    } catch(error) { console.error("Workflow dispatch failed after checkout manual review",error); }
    return Response.json({
      manualReview: true,
      orderNumber: order.number,
      message: "Votre commande a été reçue pour vérification. Aucun paiement n'a été demandé. Notre équipe vous contactera.",
    }, { status: 202 });
  }

  try {
    if (paymentProvider === "malipopay") {
      const rate = fx?.rates?.TZS ?? NaN;
      if (!fx?.fresh || !Number.isFinite(rate) || rate <= 0) {
        return Response.json({ error: "Le taux USD/TZS fiable est temporairement indisponible. Réessayez plus tard." }, { status: 503 });
      }
      // MALIPOPAY demande un montant en TZS entiers ; l'arrondi est toujours vers le haut et archivé.
      const amountTzsWhole = Math.ceil((totalMinor / 100) * rate);
      if (!Number.isSafeInteger(amountTzsWhole) || amountTzsWhole <= 0) {
        return Response.json({ error: "Le montant converti en TZS est invalide." }, { status: 503 });
      }
      const pay = await initializeMalipopayPayment({
        orderId: order.id,
        orderNumber: order.number,
        customerPhone: normalizePhone(a.phone),
        amountTzsWhole,
        fxSnapshot: {
          base: "USD",
          quote: "TZS",
          rate,
          source: fx.sources.TZS ?? "unknown",
          fetchedAt: new Date(fx.fetchedAt).toISOString(),
          usdAmountMinor: totalMinor,
          tzsAmountWhole: amountTzsWhole,
          rounding: "ceil_to_whole_TZS",
        },
      });
      return Response.json({
        url: pay.checkoutUrl,
        provider: "malipopay",
        chargedCurrency: "TZS",
        chargedAmountWhole: amountTzsWhole,
        reference: pay.reference,
      });
    }
    const pay = await initializePayment({
      orderId: order.id,
      email: body.email,
      amountMinor: totalMinor,
      currency: "USD",
      fxSnapshot: fx ? {
        base: "USD", rates: fx.rates, sources: fx.sources,
        fetchedAt: new Date(fx.fetchedAt).toISOString(),
        displayCurrency, displayFxSnapshot,
      } : { base: "USD", displayCurrency, displayFxSnapshot },
    });
    return Response.json({ url: pay.authorizationUrl, provider: "paystack", chargedCurrency: "USD", chargedAmountMinor: totalMinor });
  } catch (e) {
    await audit("checkout_init_failed", order.id, String(e));
    return Response.json({ error: "Paiement indisponible pour le moment." }, { status: 502 });
  }
}
