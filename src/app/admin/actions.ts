"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, checkPassword, startSession, endSession, adminConfigured } from "@/lib/admin-auth";
import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";
import { getFx, toUsd } from "@/lib/fx";
import { salePriceUsd, isPricingError } from "@/lib/pricing";
import { toMinor, toMajor, decimals } from "@/lib/money";
import { refundPayment } from "@/lib/paystack";
import { queueEmail, siteUrl } from "@/lib/mail";
import { chat } from "@/lib/ai-gateway";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const v = Number(String(f.get(k) ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
function back(path: string, msg: string, error = false): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${error ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// ---------- Session ----------
let failures = 0;
export async function login(f: FormData) {
  if (!adminConfigured()) redirect("/admin/login?err=config");
  await new Promise((r) => setTimeout(r, Math.min(300 * 2 ** failures, 5000)));
  if (!checkPassword(str(f, "password"))) {
    failures += 1;
    redirect("/admin/login?err=1");
  }
  failures = 0;
  await startSession();
  redirect("/admin");
}
export async function logout() {
  await endSession();
  redirect("/admin/login");
}

// ---------- Catalogue ----------
export async function createProduct(f: FormData) {
  await requireAdmin();
  const name = str(f, "name");
  const kind = str(f, "kind");
  if (!name || !["physical", "digital", "service"].includes(kind)) back("/admin/produits", "Nom ou type invalide.", true);
  const slug = slugify(name);
  const sku = str(f, "sku") || `ASV-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await supabaseAdmin()
    .from("products")
    .insert({ name, slug, sku, kind, category_id: str(f, "category_id") || null })
    .select("id")
    .single();
  if (error || !data) back("/admin/produits", "Création impossible (nom ou SKU déjà utilisé ?).", true);
  await audit("product_created", data.id, { name }, "admin");
  redirect(`/admin/produits/${data.id}`);
}

export async function updateProduct(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const path = `/admin/produits/${id}`;
  const status = str(f, "status");
  const patch: Record<string, unknown> = {
    name: str(f, "name"),
    description: str(f, "description"),
    image_url: str(f, "image_url") || null,
    category_id: str(f, "category_id") || null,
    lead_time_days_min: Number(str(f, "lead_min")) || null,
    lead_time_days_max: Number(str(f, "lead_max")) || null,
    status,
  };
  if (!["draft", "review", "published", "suspended", "archived"].includes(status)) back(path, "Statut invalide.", true);
  const db = supabaseAdmin();
  if (status === "published") {
    const { data: p } = await db.from("products").select("price_usd_minor,kind").eq("id", id).single();
    if (!p?.price_usd_minor) back(path, "Publication refusée : calculez d'abord le prix.", true);
    if (p.kind === "physical") {
      const { count: o } = await db.from("offers").select("id", { count: "exact", head: true }).eq("product_id", id).eq("status", "verified");
      const { count: r } = await db.from("delivery_rules").select("id", { count: "exact", head: true }).eq("product_id", id);
      if (!o) back(path, "Publication refusée : aucune offre fournisseur vérifiée.", true);
      if (!r) back(path, "Publication refusée : aucun pays de livraison défini.", true);
    }
    if (!String(patch.description).trim() || !patch.image_url) back(path, "Publication refusée : description et image requises.", true);
  }
  const { error } = await db.from("products").update(patch).eq("id", id);
  if (error) back(path, "Mise à jour impossible.", true);
  await audit("product_updated", id, { status }, "admin");
  revalidatePath("/produits");
  back(path, "Produit enregistré.");
}

export async function addOffer(f: FormData) {
  await requireAdmin();
  const pid = str(f, "product_id");
  const path = `/admin/produits/${pid}`;
  const currency = str(f, "currency").toUpperCase();
  const price = num(f, "price");
  if (!/^[A-Z]{3}$/.test(currency) || !(price >= 0)) back(path, "Prix ou devise invalide.", true);
  const { error } = await supabaseAdmin().from("offers").insert({
    product_id: pid,
    supplier_id: str(f, "supplier_id"),
    source_url: str(f, "source_url") || null,
    supplier_sku: str(f, "supplier_sku"),
    variant: str(f, "variant"),
    price_minor: toMinor(price, currency), // saisi dans la devise source, converti en USD seulement au calcul du prix
    currency,
    moq: Math.max(1, Math.floor(num(f, "moq") || 1)),
    fulfilment_mode: str(f, "mode") || "B",
    destinations: str(f, "destinations").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
  });
  if (error) back(path, "Offre non enregistrée.", true);
  back(path, "Offre ajoutée (brouillon).");
}

export async function setOfferStatus(f: FormData) {
  await requireAdmin();
  const pid = str(f, "product_id");
  const path = `/admin/produits/${pid}`;
  const status = str(f, "status");
  const db = supabaseAdmin();
  if (status === "verified") {
    const { data: o } = await db.from("offers").select("supplier_id").eq("id", str(f, "id")).single();
    const { data: s } = await db.from("suppliers").select("trust_level").eq("id", o?.supplier_id ?? "").single();
    if (s?.trust_level !== "approved") back(path, "Fournisseur non approuvé : vérification refusée.", true);
  }
  await db.from("offers").update({ status, verified_at: status === "verified" ? new Date().toISOString() : null }).eq("id", str(f, "id"));
  await audit("offer_status", str(f, "id"), { status }, "admin");
  back(path, "Offre mise à jour.");
}

export async function deleteOffer(f: FormData) {
  await requireAdmin();
  await supabaseAdmin().from("offers").delete().eq("id", str(f, "id"));
  back(`/admin/produits/${str(f, "product_id")}`, "Offre supprimée.");
}

/** Prix calculé par le moteur déterministe : meilleure offre vérifiée convertie en USD + frais fixes. */
export async function computePrice(f: FormData) {
  await requireAdmin();
  const id = str(f, "product_id");
  const path = `/admin/produits/${id}`;
  const db = supabaseAdmin();
  const s = await getSettings();
  const { data: offers } = await db.from("offers").select("price_minor,currency,moq").eq("product_id", id).eq("status", "verified");
  if (!offers?.length) back(path, "Aucune offre vérifiée.", true);
  const fx = await getFx();
  const costs = offers
    .map((o) => toUsd(fx, toMajor(Number(o.price_minor), o.currency), o.currency))
    .filter((v): v is number => v !== null);
  if (costs.length !== offers.length) back(path, "Taux de change indisponible ou périmé : calcul refusé.", true);
  const extra = num(f, "extra_cost_usd") || 0;
  const feePct = s.paystack_fee_pct === "" ? null : Number(s.paystack_fee_pct);
  const r = salePriceUsd({
    fixedCostsUsd: Math.min(...costs) + extra,
    marginPct: num(f, "margin_pct") || Number(s.target_margin_pct || 30),
    feePct,
    feeFixedUsd: Number(s.payment_fee_fixed_usd || 0),
    reservePct: Number(s.returns_reserve_pct || 0),
    minProfitUsd: Number(s.min_profit_usd || 0),
  });
  if (isPricingError(r)) back(path, r.message, true);
  await db.from("products").update({ price_usd_minor: toMinor(r.priceUsd, "USD") }).eq("id", id);
  await audit("price_computed", id, r, "admin");
  back(path, `Prix : ${r.priceUsd} USD (marge réelle ${r.marginRealPct} %, bénéfice ${r.profitUsd} USD).`);
}

export async function upsertDeliveryRule(f: FormData) {
  await requireAdmin();
  const pid = str(f, "product_id");
  const path = `/admin/produits/${pid}`;
  const country = str(f, "country").toUpperCase();
  const ship = num(f, "shipping_usd");
  if (!/^[A-Z]{2}$/.test(country) || !(ship >= 0)) back(path, "Pays ou frais invalide.", true);
  const mode = str(f, "duty_mode") === "DDP" ? "DDP" : "DAP";
  const { error } = await supabaseAdmin().from("delivery_rules").upsert(
    { product_id: pid, country, duty_mode: mode, shipping_usd_minor: toMinor(ship, "USD"), days_min: Number(str(f, "days_min")) || null, days_max: Number(str(f, "days_max")) || null },
    { onConflict: "product_id,country" },
  );
  if (error) back(path, "Règle non enregistrée.", true);
  back(path, "Règle de livraison enregistrée.");
}

export async function deleteDeliveryRule(f: FormData) {
  await requireAdmin();
  await supabaseAdmin().from("delivery_rules").delete().eq("id", str(f, "id"));
  back(`/admin/produits/${str(f, "product_id")}`, "Règle supprimée.");
}

export async function aiDescription(f: FormData) {
  await requireAdmin();
  const id = str(f, "product_id");
  const path = `/admin/produits/${id}`;
  const { data: p } = await supabaseAdmin().from("products").select("name,kind,description").eq("id", id).single();
  const r = await chat("catalog", [
    { role: "system", content: "Rédige une description commerciale française de 80 à 120 mots, factuelle, sans promesse non vérifiable, sans prix ni délai." },
    { role: "user", content: `Produit : ${p?.name} (type ${p?.kind}). Notes : ${str(f, "notes")}` },
  ]);
  if (!r) back(path, "IA indisponible (clés ou modèles non configurés).", true);
  await supabaseAdmin().from("products").update({ description: r.text }).eq("id", id);
  await audit("ai_description", id, { provider: r.provider }, "admin");
  back(path, "Brouillon IA inséré : relisez-le avant de publier.");
}

// ---------- Fournisseurs et agences ----------
export async function createSupplier(f: FormData) {
  await requireAdmin();
  const { error } = await supabaseAdmin().from("suppliers").insert({
    code: str(f, "code").toUpperCase(), name: str(f, "name"), platform: str(f, "platform"), url: str(f, "url") || null,
    country: (str(f, "country") || "CN").toUpperCase(), billing_currency: (str(f, "currency") || "CNY").toUpperCase(),
  });
  if (error) back("/admin/fournisseurs", "Fournisseur non créé (code déjà utilisé ?).", true);
  back("/admin/fournisseurs", "Fournisseur ajouté (en revue).");
}
export async function setSupplierTrust(f: FormData) {
  await requireAdmin();
  const t = str(f, "trust_level");
  const db = supabaseAdmin();
  await db.from("suppliers").update({ trust_level: t, last_checked: new Date().toISOString() }).eq("id", str(f, "id"));
  if (t === "blocked") {
    // Un fournisseur bloqué retire immédiatement ses offres de la vente.
    await db.from("offers").update({ status: "blocked" }).eq("supplier_id", str(f, "id"));
  }
  await audit("supplier_trust", str(f, "id"), { t }, "admin");
  back("/admin/fournisseurs", "Niveau de confiance mis à jour.");
}
export async function createAgency(f: FormData) {
  await requireAdmin();
  const { error } = await supabaseAdmin().from("agencies").insert({
    name: str(f, "name"), city: str(f, "city"), country: (str(f, "country") || "CN").toUpperCase(),
    address_local: str(f, "address_local"), address_latin: str(f, "address_latin"), contact: str(f, "contact"), notes: str(f, "notes"),
  });
  if (error) back("/admin/agences", "Agence non créée.", true);
  back("/admin/agences", "Agence ajoutée.");
}
export async function toggleAgency(f: FormData) {
  await requireAdmin();
  await supabaseAdmin().from("agencies").update({ active: str(f, "active") === "true" }).eq("id", str(f, "id"));
  back("/admin/agences", "Agence mise à jour.");
}

// ---------- Commandes ----------
export async function updateOrderItem(f: FormData) {
  await requireAdmin();
  const orderId = str(f, "order_id");
  const path = `/admin/commandes/${orderId}`;
  const status = str(f, "purchase_status");
  const db = supabaseAdmin();
  const { error } = await db.from("order_items").update({
    purchase_status: status,
    supplier_order_ref: str(f, "supplier_order_ref") || null,
    carrier: str(f, "carrier") || null,
    tracking_number: str(f, "tracking_number") || null,
    agency_id: str(f, "agency_id") || null,
  }).eq("id", str(f, "id"));
  if (error) back(path, "Ligne non mise à jour.", true);
  await audit("order_item_updated", str(f, "id"), { status }, "admin");
  back(path, "Ligne d'achat mise à jour.");
}

export async function setOrderStatus(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const path = `/admin/commandes/${id}`;
  const status = str(f, "status");
  const allowed = ["manual_review", "paid_verified", "processing", "shipped", "delivered", "cancelled"];
  if (!allowed.includes(status)) back(path, "Statut non autorisé ici.", true);
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("status,email,public_token").eq("id", id).single();
  if (!o) back(path, "Commande introuvable.", true);
  // Aucune étape logistique avant un paiement vérifié.
  const { data: pay } = await db.from("payments").select("status").eq("order_id", id).eq("status", "paid_verified").maybeSingle();
  if (["processing", "shipped", "delivered"].includes(status) && !pay) back(path, "Paiement non vérifié : statut refusé.", true);
  await db.from("orders").update({ status }).eq("id", id);
  const msgs: Record<string, string> = {
    processing: "Votre commande est en préparation auprès de notre partenaire.",
    shipped: "Votre commande est expédiée.",
    delivered: "Votre commande est livrée.",
    cancelled: "Votre commande est annulée.",
  };
  const note = str(f, "message") || msgs[status];
  if (note) {
    await db.from("order_events").insert({ order_id: id, kind: status, message: note });
    if (["processing", "shipped", "delivered", "cancelled"].includes(status)) {
      await queueEmail({ to: o.email, orderId: id, subject: "Assavendo Digital — mise à jour de commande", body: `${note}\n\nSuivi : ${siteUrl()}/suivi/${o.public_token}` });
    }
  }
  await audit("order_status", id, { status }, "admin");
  back(path, "Statut mis à jour.");
}

export async function addOrderNote(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  await supabaseAdmin().from("order_events").insert({ order_id: id, kind: "note", message: str(f, "message"), is_public: str(f, "public") === "on" });
  back(`/admin/commandes/${id}`, "Note ajoutée.");
}

// ---------- Retours et remboursements ----------
export async function updateRma(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const status = str(f, "status");
  if (!["approved", "rejected", "received", "closed"].includes(status)) back("/admin/retours", "Statut invalide.", true);
  const db = supabaseAdmin();
  const { data: r } = await db.from("rma_requests").update({ status, admin_note: str(f, "admin_note"), updated_at: new Date().toISOString() }).eq("id", id).select("order_id").single();
  if (r) {
    const { data: o } = await db.from("orders").select("email").eq("id", r.order_id).single();
    if (o) await queueEmail({ to: o.email, orderId: r.order_id, subject: "Assavendo Digital — votre demande", body: `Statut de votre demande : ${status}.\n${str(f, "admin_note")}` });
  }
  back("/admin/retours", "Demande mise à jour.");
}

export async function refundRma(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const amount = num(f, "amount_usd");
  if (!(amount > 0)) back("/admin/retours", "Montant invalide.", true);
  const db = supabaseAdmin();
  const { data: r } = await db.from("rma_requests").select("order_id,status").eq("id", id).single();
  if (!r || !["approved", "received"].includes(r.status)) back("/admin/retours", "La demande doit être approuvée ou reçue avant remboursement.", true);
  const { data: pay } = await db.from("payments").select("reference,amount_minor").eq("order_id", r.order_id).eq("status", "paid_verified").maybeSingle();
  if (!pay) back("/admin/retours", "Aucun paiement vérifié pour cette commande.", true);
  try {
    const out = await refundPayment(pay.reference, toMinor(amount, "USD"));
    await db.from("rma_requests").update({ status: "refunded", refund_usd_minor: toMinor(amount, "USD"), refund_reference: out.id, updated_at: new Date().toISOString() }).eq("id", id);
    await db.from("order_events").insert({ order_id: r.order_id, kind: "refund", message: `Remboursement de ${amount.toFixed(decimals("USD"))} USD initié.` });
    const { data: o } = await db.from("orders").select("email").eq("id", r.order_id).single();
    if (o) await queueEmail({ to: o.email, orderId: r.order_id, subject: "Assavendo Digital — remboursement", body: `Un remboursement de ${amount.toFixed(2)} USD a été initié sur votre moyen de paiement.` });
  } catch (e) {
    back("/admin/retours", `Remboursement refusé : ${String(e).slice(0, 120)}`, true);
  }
  back("/admin/retours", "Remboursement initié via Paystack.");
}

// ---------- Paramètres ----------
const EDITABLE = [
  "paystack_dropshipping_status", "paystack_approval_proof", "paystack_currencies", "paystack_fee_pct", "payment_fee_fixed_usd",
  "returns_reserve_pct", "target_margin_pct", "min_profit_usd", "fx_stale_after_hours", "fx_display_margin_pct", "vpn_policy",
  "vat_registered", "vat_pct", "legal_name", "legal_address", "support_email", "tax_id", "retention_days",
];
export async function saveSettings(f: FormData) {
  await requireAdmin();
  const next: Record<string, string> = {};
  for (const k of EDITABLE) if (f.has(k)) next[k] = str(f, k);
  if (next.paystack_dropshipping_status === "approved" && !next.paystack_approval_proof) {
    back("/admin/parametres", "« Approuvé » exige la preuve écrite de Paystack (référence ou lien).", true);
  }
  for (const k of ["paystack_fee_pct", "returns_reserve_pct", "target_margin_pct", "vat_pct", "fx_display_margin_pct"]) {
    if (next[k] !== undefined && next[k] !== "" && !(Number(next[k]) >= 0 && Number(next[k]) < 100)) back("/admin/parametres", `Valeur invalide : ${k}.`, true);
  }
  if (next.vpn_policy && !["monitor", "challenge", "checkout_block", "strict_site_block"].includes(next.vpn_policy)) back("/admin/parametres", "Politique VPN invalide.", true);
  const rows = Object.entries(next).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin().from("settings").upsert(rows);
  if (error) back("/admin/parametres", "Enregistrement impossible.", true);
  await audit("settings_saved", "settings", Object.keys(next), "admin");
  back("/admin/parametres", "Paramètres enregistrés.");
}

export async function resendPendingEmails() {
  await requireAdmin();
  const db = supabaseAdmin();
  const { data } = await db.from("email_outbox").select("*").in("status", ["pending", "failed"]).limit(50);
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) back("/admin/emails", "RESEND_API_KEY et MAIL_FROM non configurés.", true);
  let sent = 0;
  for (const m of data ?? []) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to_email], subject: m.subject, text: m.body }),
    }).catch(() => null);
    if (r?.ok) { sent++; await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", m.id); }
  }
  back("/admin/emails", `${sent} e-mail(s) envoyé(s).`);
}
