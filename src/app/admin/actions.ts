"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, checkPassword, startSession, endSession, adminConfigured } from "@/lib/admin-auth";
import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";
import { getFx, toUsd } from "@/lib/fx";
import { salePriceUsd, isPricingError } from "@/lib/pricing";
import { calculateOfferLandedCost, chooseBestLandedOffer } from "@/lib/landed-cost";
import { toMinor, toMajor, decimals } from "@/lib/money";
import { refundPayment } from "@/lib/paystack";
import { queueEmail, siteUrl } from "@/lib/mail";
import { chat } from "@/lib/ai-gateway";
import { createManusTask, listManusMessages, sendManusMessage } from "@/lib/manus";
import { redact } from "@/lib/ai-gateway";

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
    brand: str(f, "brand") || null,
    source_name: str(f, "source_name") || null,
    package_contents: str(f, "package_contents") || null,
    warranty_terms: str(f, "warranty_terms") || null,
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
  const sourceUrl = str(f, "source_url");
  if (!/^[A-Z]{3}$/.test(currency) || !(price >= 0) || !Number.isFinite(price)) back(path, "Prix ou devise invalide.", true);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) back(path, "URL source doit être http ou https.", true);
  const supplierId = str(f, "supplier_id");
  const { data: supplier } = await supabaseAdmin().from("suppliers").select("trust_level").eq("id", supplierId).maybeSingle();
  if (!supplier || supplier.trust_level === "blocked") back(path, "Fournisseur inexistant ou bloqué.", true);
  const variantId = str(f, "variant_id") || null;
  if (variantId) {
    const { data: variant } = await supabaseAdmin().from("product_variants")
      .select("id").eq("id", variantId).eq("product_id", pid).maybeSingle();
    if (!variant) back(path, "La variante sélectionnée n'appartient pas à ce produit.", true);
  }
  const agencyId = str(f, "agency_id") || null;
  if (agencyId) {
    const { data: agency } = await supabaseAdmin().from("agencies")
      .select("id").eq("id", agencyId).eq("active", true).maybeSingle();
    if (!agency) back(path, "Agence introuvable ou inactive.", true);
  }
  const fulfilmentMode = str(f, "mode") || "B";
  if (fulfilmentMode === "B" && !agencyId) {
    // An offer may be recorded without an agency, but it will remain out of stock routing until configured.
  }
  if (!["A", "B", "C"].includes(fulfilmentMode)) back(path, "Mode logistique invalide.", true);
  const { error } = await supabaseAdmin().from("offers").insert({
    product_id: pid,
    supplier_id: supplierId,
    source_url: sourceUrl || null,
    supplier_sku: str(f, "supplier_sku"),
    variant: str(f, "variant"),
    price_minor: toMinor(price, currency), // saisi dans la devise source, converti en USD seulement au calcul du prix
    currency,
    moq: Math.max(1, Math.floor(num(f, "moq") || 1)),
    fulfilment_mode: fulfilmentMode,
    availability_status: str(f, "availability_status") || "unknown",
    available_qty: Number.isFinite(num(f, "available_qty")) ? Math.max(0, Math.floor(num(f, "available_qty"))) : null,
    quality_score: Number.isFinite(num(f, "quality_score")) ? Math.max(0, Math.min(100, num(f, "quality_score"))) : null,
    last_checked_at: new Date().toISOString(),
    destinations: str(f, "destinations").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
    agency_id: agencyId,
    variant_id: variantId,
    valid_until: str(f, "valid_until")
      ? new Date(`${str(f, "valid_until")}T23:59:59.999Z`).toISOString()
      : null,
  });
  if (error) back(path, "Offre non enregistrée.", true);
  back(path, "Offre ajoutée (brouillon).");
}


export async function createVariant(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const path = `/admin/produits/${productId}`;
  const name = str(f, "name");
  const sku = str(f, "sku").toUpperCase();
  if (!name || !sku || !/^[A-Z0-9_-]{3,64}$/.test(sku)) back(path, "Nom ou SKU de variante invalide.", true);
  let attributes: Record<string, unknown> = {};
  const rawAttributes = str(f, "attributes");
  if (rawAttributes) {
    try {
      const value = JSON.parse(rawAttributes) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
      attributes = value as Record<string, unknown>;
    } catch {
      back(path, "Attributs de variante : JSON objet invalide.", true);
    }
  }
  const { error } = await supabaseAdmin().from("product_variants").insert({
    product_id: productId, sku, name, attributes,
    sort_order: Math.max(0, Math.floor(num(f, "sort_order") || 0)),
  });
  if (error) back(path, "Variante non créée : SKU peut-être déjà utilisé.", true);
  await audit("product_variant_created", productId, { sku, name }, "admin");
  revalidatePath(path);
  back(path, "Variante ajoutée.");
}

export async function toggleVariant(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const active = str(f, "active") === "true";
  const { error } = await supabaseAdmin().from("product_variants")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", str(f, "id")).eq("product_id", productId);
  if (error) back(`/admin/produits/${productId}`, "Variante non mise à jour.", true);
  back(`/admin/produits/${productId}`, "Variante mise à jour.");
}

export async function addOfferTier(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const offerId = str(f, "offer_id");
  const path = `/admin/produits/${productId}`;
  const minQty = Math.floor(num(f, "min_qty"));
  const maxRaw = str(f, "max_qty");
  const maxQty = maxRaw ? Math.floor(Number(maxRaw)) : null;
  const price = num(f, "price");
  const currency = str(f, "currency").toUpperCase();
  if (!Number.isSafeInteger(minQty) || minQty < 1
    || (maxQty !== null && (!Number.isSafeInteger(maxQty) || maxQty < minQty))
    || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) {
    back(path, "Palier de prix invalide.", true);
  }
  const db = supabaseAdmin();
  const { data: offer } = await db.from("offers").select("id").eq("id", offerId).eq("product_id", productId).maybeSingle();
  if (!offer) back(path, "Offre fournisseur introuvable.", true);
  const { data: tiers } = await db.from("offer_price_tiers").select("min_qty,max_qty").eq("offer_id", offerId);
  const overlaps = (tiers ?? []).some((tier) => {
    const existingMin = Number(tier.min_qty);
    const existingMax = tier.max_qty === null ? Infinity : Number(tier.max_qty);
    const newMax = maxQty === null ? Infinity : maxQty;
    return minQty <= existingMax && existingMin <= newMax;
  });
  if (overlaps) back(path, "Ce palier chevauche un palier déjà enregistré.", true);
  const { error } = await db.from("offer_price_tiers").insert({
    offer_id: offerId, min_qty: minQty, max_qty: maxQty,
    price_minor: toMinor(price, currency), currency,
  });
  if (error) back(path, "Palier non enregistré.", true);
  back(path, "Palier fournisseur ajouté.");
}

export async function deleteOfferTier(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const { error } = await supabaseAdmin().from("offer_price_tiers")
    .delete().eq("id", str(f, "id")).eq("offer_id", str(f, "offer_id"));
  if (error) back(`/admin/produits/${productId}`, "Palier non supprimé.", true);
  back(`/admin/produits/${productId}`, "Palier supprimé.");
}

export async function addOfferCostComponent(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const offerId = str(f, "offer_id");
  const path = `/admin/produits/${productId}`;
  const kinds = ["supplier_fee","packaging","customization","sample","domestic_shipping","insurance","handling","bank_fee","fx_fee","other"];
  const stages = ["supplier","china_domestic","agency_receiving","inspection","repackaging","export","international","destination","other"];
  const kind = str(f, "kind");
  const stage = str(f, "cost_stage") || "supplier";
  const label = str(f, "label");
  const amount = num(f, "amount");
  const currency = str(f, "currency").toUpperCase();
  if (!kinds.includes(kind) || !stages.includes(stage) || !label
    || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) {
    back(path, "Composant de coût invalide.", true);
  }
  const db = supabaseAdmin();
  const { data: offer } = await db.from("offers").select("id").eq("id", offerId).eq("product_id", productId).maybeSingle();
  if (!offer) back(path, "Offre fournisseur introuvable.", true);
  const { error } = await db.from("offer_cost_components").insert({
    offer_id: offerId, kind, label, amount_minor: toMinor(amount, currency), currency,
    per_unit: str(f, "per_unit") === "on",
    included_in_supplier_price: str(f, "included_in_supplier_price") === "on",
    cost_stage: stage,
  });
  if (error) back(path, "Composant de coût non enregistré.", true);
  back(path, "Composant de coût ajouté.");
}

export async function deleteOfferCostComponent(f: FormData) {
  await requireAdmin();
  const productId = str(f, "product_id");
  const { error } = await supabaseAdmin().from("offer_cost_components")
    .delete().eq("id", str(f, "id")).eq("offer_id", str(f, "offer_id"));
  if (error) back(`/admin/produits/${productId}`, "Composant non supprimé.", true);
  back(`/admin/produits/${productId}`, "Composant supprimé.");
}

export async function setOfferStatus(f: FormData) {
  await requireAdmin();
  const pid = str(f, "product_id");
  const path = `/admin/produits/${pid}`;
  const status = str(f, "status");
  const db = supabaseAdmin();
  if (!["draft", "review", "verified", "blocked", "expired"].includes(status)) back(path, "Statut d'offre invalide.", true);
  if (status === "verified") {
    const { data: o } = await db.from("offers").select("supplier_id").eq("id", str(f, "id")).single();
    const { data: s } = await db.from("suppliers").select("trust_level").eq("id", o?.supplier_id ?? "").single();
    if (s?.trust_level !== "approved") back(path, "Fournisseur non approuvé : vérification refusée.", true);
  }
  const { error } = await db.from("offers").update({
    status,
    verified_at: status === "verified" ? new Date().toISOString() : null,
    last_checked_at: status === "verified" ? new Date().toISOString() : undefined,
  }).eq("id", str(f, "id")).eq("product_id", pid);
  if (error) back(path, "Statut d'offre non mis à jour.", true);
  await audit("offer_status", str(f, "id"), { status }, "admin");
  back(path, "Offre mise à jour.");
}

export async function deleteOffer(f: FormData) {
  await requireAdmin();
  await supabaseAdmin().from("offers").delete().eq("id", str(f, "id"));
  back(`/admin/produits/${str(f, "product_id")}`, "Offre supprimée.");
}

/**
 * Détermine le coût rendu d'une offre au niveau de sa MOQ :
 * prix source + paliers + composants de coût, sans taux FX inventé.
 * La qualité, la disponibilité et la fraîcheur filtrent les offres avant comparaison.
 */
export async function computePrice(f: FormData) {
  await requireAdmin();
  const id = str(f, "product_id");
  const variantId = str(f, "variant_id") || null;
  const path = `/admin/produits/${id}`;
  const db = supabaseAdmin();
  const settings = await getSettings();
  const fx = await getFx();
  if (!fx?.fresh) back(path, "Taux FX indisponibles ou périmés. Le calcul est bloqué.", true);

  const { data: rawOffers, error: offersError } = await db
    .from("offers")
    .select("*, suppliers(trust_level,country)")
    .eq("product_id", id)
    .eq("status", "verified")
    .or(variantId ? `variant_id.eq.${variantId},variant_id.is.null` : "variant_id.is.null");
  if (offersError || !rawOffers?.length) back(path, "Aucune offre fournisseur vérifiée.", true);

  if (variantId) {
    const { data: variant } = await db.from("product_variants")
      .select("id").eq("id", variantId).eq("product_id", id).eq("active", true).maybeSingle();
    if (!variant) back(path, "Variante introuvable ou inactive.", true);
  }
  const staleDays = Math.max(1, Number(settings.supplier_offer_stale_days || 14));
  const now = Date.now();
  const eligibleOffers = rawOffers.filter((offer) => {
    if (variantId && offer.variant_id && offer.variant_id !== variantId) return false;
    const supplier = Array.isArray(offer.suppliers) ? offer.suppliers[0] : offer.suppliers;
    const checkedAt = offer.last_checked_at || offer.verified_at;
    const checkedTime = checkedAt ? new Date(checkedAt).getTime() : 0;
    const validUntil = offer.valid_until ? new Date(offer.valid_until).getTime() : Infinity;
    const available = ["available", "low_stock", "preorder"].includes(offer.availability_status);
    return supplier?.trust_level === "approved"
      && available
      && checkedTime > 0
      && Number.isFinite(checkedTime)
      && now - checkedTime <= staleDays * 86_400_000
      && validUntil > now;
  });
  if (!eligibleOffers.length) {
    back(path, `Aucune offre ne répond aux critères : fournisseur approuvé, stock connu, vérification de moins de ${staleDays} jours et validité non expirée.`, true);
  }

  const offerIds = eligibleOffers.map((offer) => offer.id);
  const [{ data: tiers, error: tiersError }, { data: components, error: costsError }] = await Promise.all([
    db.from("offer_price_tiers").select("*").in("offer_id", offerIds).order("min_qty"),
    db.from("offer_cost_components").select("*").in("offer_id", offerIds),
  ]);
  if (tiersError || costsError) back(path, "Lecture des paliers ou composants de coût impossible.", true);

  const qualityPenalty = Math.max(0, Math.min(50, Number(settings.supplier_quality_penalty_pct || 5)));
  const candidates = eligibleOffers.map((offer) => {
    const result = calculateOfferLandedCost({
      offerId: offer.id,
      priceMinor: Number(offer.price_minor),
      currency: String(offer.currency),
      moq: Number(offer.moq || 1),
      tiers: (tiers ?? []).filter((tier) => tier.offer_id === offer.id),
      components: (components ?? []).filter((component) => component.offer_id === offer.id),
    }, fx, offer.quality_score === null ? null : Number(offer.quality_score), qualityPenalty);
    if ("error" in result) return { offer, result: null, error: result.message };
    return {
      offer,
      result,
      error: null,
      priority: Number(offer.priority ?? 100),
      isPreferred: Boolean(offer.is_preferred),
    };
  });
  const valid = candidates.filter((candidate): candidate is typeof candidate & { result: NonNullable<typeof candidate.result> } => candidate.result !== null);
  if (!valid.length) {
    const detail = candidates.map((candidate) => candidate.error).filter(Boolean).slice(0, 3).join(" ");
    back(path, detail || "Aucune offre n'a de coût rendu calculable.", true);
  }
  const selected = chooseBestLandedOffer(valid.map((candidate) => ({
    priority: candidate.priority ?? 100,
    isPreferred: candidate.isPreferred ?? false,
    result: candidate.result,
    offer: candidate.offer,
  })));
  if (!selected) back(path, "Aucune offre ne peut être sélectionnée.", true);

  const extra = num(f, "extra_cost_usd");
  if (!Number.isFinite(extra) || extra < 0) back(path, "Frais complémentaires invalides.", true);
  const feePct = settings.paystack_fee_pct === "" ? null : Number(settings.paystack_fee_pct);
  const marginValue = num(f, "margin_pct");
  const marginPct = Number.isFinite(marginValue) && marginValue > 0
    ? marginValue
    : Number(settings.target_margin_pct || 30);
  const reservePct = Number(settings.returns_reserve_pct || 0);
  const feeFixedUsd = Number(settings.payment_fee_fixed_usd || 0);
  const minProfitUsd = Number(settings.min_profit_usd || 0);
  const fixedCostsUsd = selected.result.landedCostUsd + extra;
  const price = salePriceUsd({
    fixedCostsUsd,
    marginPct,
    feePct,
    feeFixedUsd,
    reservePct,
    minProfitUsd,
  });
  if (isPricingError(price)) back(path, price.message, true);

  const costSnapshot = {
    landed_cost: selected.result,
    extra_cost_usd: extra,
    quality_penalty_pct: qualityPenalty,
    selected_offer_quality_score: selected.offer.quality_score,
    supplier_priority: selected.offer.priority,
    supplier_preferred: selected.offer.is_preferred,
    supplier_trust_level: "approved",
    offer_last_checked_at: selected.offer.last_checked_at || selected.offer.verified_at,
    offer_valid_until: selected.offer.valid_until,
    calculation_policy: "landed_cost_plus_explicit_admin_overhead",
  };
  const priceTable = variantId ? "product_variants" : "products";
  const priceUpdate = await db.from(priceTable).update({
    price_usd_minor: toMinor(price.priceUsd, "USD"),
    landed_cost_usd_minor: toMinor(fixedCostsUsd, "USD"),
    selected_offer_id: selected.offer.id,
    source_price_minor: selected.result.sourceUnitPriceMinor,
    source_currency: selected.result.sourceCurrency,
    source_fx_snapshot: selected.result.fxSnapshot,
    price_calculated_at: new Date().toISOString(),
  }).eq("id", variantId || id);
  if (priceUpdate.error) back(path, "Prix calculé mais impossible à enregistrer sur le produit/variante.", true);

  const { error: snapshotError } = await db.from("price_calculations").insert({
    product_id: id,
    variant_id: variantId,
    selected_offer_id: selected.offer.id,
    selected_quantity: selected.result.quantityBasis,
    source_unit_price_minor: selected.result.sourceUnitPriceMinor,
    source_currency: selected.result.sourceCurrency,
    source_fx_snapshot: selected.result.fxSnapshot,
    cost_breakdown: costSnapshot,
    fixed_cost_usd_minor: toMinor(fixedCostsUsd, "USD"),
    fee_pct: feePct,
    reserve_pct: reservePct,
    target_margin_pct: marginPct,
    sale_price_usd_minor: toMinor(price.priceUsd, "USD"),
    profit_usd_minor: toMinor(price.profitUsd, "USD"),
    real_margin_pct: price.marginRealPct,
  });
  if (snapshotError) {
    await audit("price_snapshot_failed", id, { message: snapshotError.message, offer_id: selected.offer.id }, "admin");
    back(path, "Prix enregistré, mais son historique de calcul n'a pas pu être archivé. Vérification nécessaire.", true);
  }
  await audit("price_computed", id, {
    selected_offer_id: selected.offer.id,
    source_currency: selected.result.sourceCurrency,
    quantity_basis: selected.result.quantityBasis,
    landed_cost_usd: fixedCostsUsd,
    price,
    cost_snapshot: costSnapshot,
  }, "admin");
  revalidatePath("/produits");
  revalidatePath(`/produits/${(await db.from("products").select("slug").eq("id", id).single()).data?.slug ?? ""}`);
  back(path, `${variantId ? "Variante · " : ""}Offre optimale ${selected.offer.id.slice(0, 8)} · coût rendu ${fixedCostsUsd.toFixed(2)} USD · prix ${price.priceUsd.toFixed(2)} USD · marge ${price.marginRealPct.toFixed(2)} %.`);
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
  if (!["in_review", "approved", "watch", "blocked"].includes(t)) back("/admin/fournisseurs", "Niveau de confiance invalide.", true);
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
  const allowedPurchaseStatuses = ["to_buy", "draft_purchase", "approved_to_buy", "ordered", "partially_received", "received", "cancelled", "blocked"];
  if (!allowedPurchaseStatuses.includes(status)) back(path, "Statut d'achat invalide.", true);
  const { data: verifiedPayment } = await db.from("payments")
    .select("id").eq("order_id", orderId).eq("status", "paid_verified").maybeSingle();
  if (!verifiedPayment) back(path, "Approvisionnement interdit : paiement non vérifié.", true);
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
  const allowed = ["manual_review", "processing", "cancelled"];
  if (!allowed.includes(status)) back(path, "Statut non autorisé ici.", true);
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("status,email,public_token").eq("id", id).single();
  if (!o) back(path, "Commande introuvable.", true);
  // Aucune étape logistique avant un paiement vérifié.
  const { data: pay } = await db.from("payments").select("status").eq("order_id", id).eq("status", "paid_verified").maybeSingle();
  if (["processing"].includes(status) && !pay) back(path, "Paiement non vérifié : statut refusé.", true);
  await db.from("orders").update({ status }).eq("id", id);
  const msgs: Record<string, string> = {
    processing: "Votre commande est en préparation auprès de notre partenaire.",
    cancelled: "Votre commande est annulée.",
  };
  const note = str(f, "message") || msgs[status];
  if (note) {
    await db.from("order_events").upsert({
      order_id: id,
      kind: status,
      event_key: `admin-order-status:${id}:${status}:${Date.now()}`,
      message: note,
    });
    if (["processing", "cancelled"].includes(status)) {
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
  const { data: pay } = await db.from("payments")
    .select("reference,amount_minor,currency")
    .eq("order_id", r.order_id).eq("status", "paid_verified")
    .order("verified_at", { ascending: false }).limit(1).maybeSingle();
  if (!pay) back("/admin/retours", "Aucun paiement vérifié pour cette commande.", true);
  const currency = String(pay.currency).trim().toUpperCase();
  const amountMinor = toMinor(amount, currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > Number(pay.amount_minor)) {
    back("/admin/retours", `Montant invalide ou supérieur au paiement (${currency}).`, true);
  }
  try {
    const out = await refundPayment({
      reference: pay.reference,
      rmaId: id,
      amountMinor,
      currency,
      merchantNote: `Assavendo RMA ${id}`,
    });
    await db.from("rma_requests").update({
      refund_currency: currency,
      refund_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    await db.from("order_events").upsert({
      order_id: r.order_id,
      kind: "refund_pending",
      event_key: `refund-requested:${id}`,
      message: `Demande de remboursement de ${amount.toFixed(decimals(currency))} ${currency} transmise à Paystack. En attente de confirmation du prestataire.`,
    }, { onConflict: "event_key", ignoreDuplicates: true });
    await audit("refund_submitted", id, {
      amount_minor: amountMinor,
      currency,
      provider_reference: out.providerReference,
      status: out.status,
    }, "admin");
  } catch (e) {
    back("/admin/retours", `Remboursement à réconcilier : ${String(e).slice(0, 140)}`, true);
  }
  back("/admin/retours", "Demande transmise à Paystack. Le remboursement sera confirmé uniquement après le webhook refund.processed.");
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

export async function launchManusTask(f: FormData) {
  await requireAdmin();
  const title = str(f, "title").slice(0, 160);
  const prompt = str(f, "prompt");
  if (!title || !prompt || prompt.length > 24_000) back("/admin/ia", "Titre ou consigne invalide.", true);
  const safePrompt = redact(prompt);
  const digest = (await import("node:crypto")).createHash("sha256")
    .update(`${title}\n${safePrompt}`).digest("hex");
  const idempotencyKey = `manus:${digest}`;
  const db = supabaseAdmin();

  const { data: existing } = await db.from("ai_tool_runs")
    .select("id,status,provider_task_id,provider_task_url")
    .eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) {
    if (existing.provider_task_id) {
      back("/admin/ia", `Cette demande a déjà une tâche Manus : ${existing.provider_task_id}.`);
    }
    back("/admin/ia", "Cette demande existe déjà et doit être réconciliée avant de relancer Manus.", true);
  }

  const { data: run, error: insertError } = await db.from("ai_tool_runs").insert({
    tool_name: "manus_task",
    provider: "manus",
    arguments_redacted: { title, prompt: safePrompt.slice(0, 24_000) },
    status: "running",
    idempotency_key: idempotencyKey,
  }).select("id").single();
  if (insertError || !run) back("/admin/ia", "Impossible de réserver la tâche dans le journal IA.", true);

  try {
    const created = await createManusTask({
      title,
      prompt: safePrompt,
      agentProfile: "standard",
      clearConnectors: true,
    });
    await db.from("ai_tool_runs").update({
      provider_task_id: created.task_id,
      provider_task_url: created.task_url ?? null,
      provider_request_id: created.request_id ?? null,
      provider_status: "created",
      status: "running",
    }).eq("id", run.id);
    await audit("manus_task_created", run.id, {
      task_id: created.task_id,
      task_url: created.task_url ?? null,
      request_id: created.request_id ?? null,
    }, "admin");
  } catch (error) {
    await db.from("ai_tool_runs").update({
      status: "failed",
      provider_status: "create_failed",
      error: String(error).slice(0, 1000),
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    back("/admin/ia", `Création Manus échouée : ${String(error).slice(0, 120)}`, true);
  }
  back("/admin/ia", "Tâche Manus créée et enregistrée. Son état sera mis à jour via le webhook.");
}

export async function refreshManusTask(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const taskId = str(f, "task_id");
  const { data: run } = await supabaseAdmin().from("ai_tool_runs")
    .select("id,provider_task_id").eq("id", id).eq("provider", "manus").maybeSingle();
  if (!run || run.provider_task_id !== taskId) back("/admin/ia", "Tâche Manus introuvable.", true);
  try {
    const messages = await listManusMessages(taskId, 20);
    const { data: runData } = await supabaseAdmin().from("ai_tool_runs")
      .select("result_json").eq("id", id).maybeSingle();
    await supabaseAdmin().from("ai_tool_runs").update({
      result_json: messages,
      last_event_at: new Date().toISOString(),
    }).eq("id", id);
    await audit("manus_task_refreshed", id, { messages_received: true }, "admin");
  } catch (error) {
    back("/admin/ia", `Lecture Manus impossible : ${String(error).slice(0, 120)}`, true);
  }
  back("/admin/ia", "État Manus actualisé.");
}

export async function sendManusTaskMessage(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  const taskId = str(f, "task_id");
  const message = redact(str(f, "message"));
  if (!message) back("/admin/ia", "Message vide.", true);
  const { data: run } = await supabaseAdmin().from("ai_tool_runs")
    .select("provider_task_id,status").eq("id", id).eq("provider", "manus").maybeSingle();
  if (!run || run.provider_task_id !== taskId || !["running", "awaiting_approval"].includes(run.status)) {
    back("/admin/ia", "Cette tâche n'accepte pas de message supplémentaire.", true);
  }
  try {
    const result = await sendManusMessage(taskId, message);
    await supabaseAdmin().from("ai_tool_runs").update({
      status: "running", provider_status: "message_sent", last_event_at: new Date().toISOString(),
    }).eq("id", id);
    await audit("manus_task_message_sent", id, { request_id: result.request_id ?? null }, "admin");
  } catch (error) {
    back("/admin/ia", `Message non transmis : ${String(error).slice(0, 120)}`, true);
  }
  back("/admin/ia", "Message envoyé à Manus.");
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function orderPath(orderId: string) {
  return `/admin/commandes/${orderId}`;
}

async function hasVerifiedPayment(orderId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("payments").select("id")
    .eq("order_id", orderId).eq("status", "paid_verified").limit(1).maybeSingle();
  return !!data;
}

async function syncOrderStatusFromShipments(orderId: string): Promise<void> {
  const db = supabaseAdmin();
  const [{ data: order }, { data: packages }] = await Promise.all([
    db.from("orders").select("status,email,public_token").eq("id", orderId).maybeSingle(),
    db.from("shipment_packages")
      .select("id,stage,status")
      .eq("order_id", orderId)
      .in("stage", ["supplier_direct", "provider_fulfillment", "agency_to_customer"]),
  ]);
  if (!order || !packages?.length || !await hasVerifiedPayment(orderId)) return;

  const allDelivered = packages.every((item) => item.status === "delivered");
  const anyInCustomerTransit = packages.some((item) =>
    ["in_transit", "out_for_delivery", "delivered"].includes(item.status));

  let next: string | null = null;
  if (allDelivered) next = "delivered";
  else if (anyInCustomerTransit && ["paid_verified", "processing", "shipped"].includes(order.status)) next = "shipped";
  if (!next || next === order.status) return;

  await db.from("orders").update({ status: next }).eq("id", orderId)
    .in("status", ["paid_verified", "processing", "shipped"]);
  const message = next === "delivered"
    ? "Tous les colis de votre commande sont indiqués comme livrés."
    : "Au moins un colis de votre commande est en transit vers votre adresse.";
  await db.from("order_events").upsert({
    order_id: orderId,
    kind: next,
    event_key: `shipment-order-status:${orderId}:${next}`,
    message,
    is_public: true,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  if (order.email && order.public_token) {
    await queueEmail({
      to: order.email,
      orderId,
      idempotencyKey: `shipment-order-status:${orderId}:${next}`,
      subject: next === "delivered"
        ? "Assavendo Digital — commande livrée"
        : "Assavendo Digital — colis expédié",
      body: `${message}\n\nSuivi : ${siteUrl()}/suivi/${order.public_token}`,
    });
  }
}

export async function requestPurchaseApproval(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const { data: purchase } = await supabaseAdmin().from("purchase_orders")
    .select("id,order_id,status,internal_notes,orders(status)").eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  const linkedOrder = Array.isArray(purchase.orders) ? purchase.orders[0] : purchase.orders;
  if (linkedOrder?.status === "manual_review") {
    back(orderPath(purchase.order_id), "La revue antifraude doit être levée avant de soumettre l'achat.", true);
  }
  if (purchase.status !== "draft") back(orderPath(purchase.order_id), "Seul un brouillon peut être soumis à validation.", true);
  if (!await hasVerifiedPayment(purchase.order_id)) {
    back(orderPath(purchase.order_id), "Paiement non vérifié : approvisionnement interdit.", true);
  }
  const { error } = await supabaseAdmin().from("purchase_orders").update({
    status: "pending_approval",
    internal_notes: `${purchase.internal_notes ?? ""}\nSoumis à validation humaine le ${new Date().toISOString()}.`,
    updated_at: new Date().toISOString(),
  }).eq("id", purchaseId).eq("status", "draft");
  if (error) back(orderPath(purchase.order_id), "Soumission à validation impossible.", true);
  await audit("purchase_approval_requested", purchaseId, { order_id: purchase.order_id }, "admin");
  back(orderPath(purchase.order_id), "Fiche soumise à validation. Aucun achat n'a été passé.");
}

export async function approvePurchaseOrder(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const db = supabaseAdmin();
  const { data: purchase } = await db.from("purchase_orders")
    .select("id,order_id,status,supplier_id,agency_id,delivery_address,purchase_reference,orders(status)")
    .eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  const linkedOrder = Array.isArray(purchase.orders) ? purchase.orders[0] : purchase.orders;
  if (linkedOrder?.status === "manual_review") {
    back(orderPath(purchase.order_id), "La revue antifraude doit être levée avant d'approuver l'achat.", true);
  }
  if (purchase.status !== "pending_approval") back(orderPath(purchase.order_id), "La fiche n'est pas en attente d'approbation.", true);
  if (!await hasVerifiedPayment(purchase.order_id)) {
    back(orderPath(purchase.order_id), "Paiement non vérifié : approbation impossible.", true);
  }
  if (!purchase.supplier_id) back(orderPath(purchase.order_id), "Fournisseur non associé : attribuez un fournisseur avant approbation.", true);
  const { data: supplier } = await db.from("suppliers")
    .select("trust_level").eq("id", purchase.supplier_id).maybeSingle();
  if (supplier?.trust_level !== "approved") {
    back(orderPath(purchase.order_id), "Le fournisseur doit être approuvé avant tout achat.", true);
  }
  if (!isRecord(purchase.delivery_address)) {
    back(orderPath(purchase.order_id), "Destination d'approvisionnement absente : ne communiquez pas l'adresse client à la place de l'adresse d'entrepôt.", true);
  }

  const destination = purchase.delivery_address as Record<string, unknown>;
  if (destination.kind === "agency_warehouse") {
    if (!destination.address_local || !destination.address_latin || !destination.receiving_code) {
      back(orderPath(purchase.order_id), "Adresse d'agence incomplète : la validation est bloquée.", true);
    }
  } else {
    if (!destination.line1 || !destination.city || !destination.country) {
      back(orderPath(purchase.order_id), "Adresse de livraison directe incomplète.", true);
    }
  }

  const { data: lines, error: lineError } = await db.from("purchase_order_items")
    .select("id,offer_id,qty").eq("purchase_order_id", purchaseId);
  if (lineError || !lines?.length) back(orderPath(purchase.order_id), "La fiche d'achat ne contient aucune ligne.", true);
  const offerIds = [...new Set(lines.map((line) => line.offer_id).filter((value): value is string => !!value))];
  if (offerIds.length !== lines.length) {
    back(orderPath(purchase.order_id), "Une ou plusieurs lignes n'ont pas d'offre fournisseur source vérifiée.", true);
  }
  const { data: offers } = await db.from("offers").select("id,status,supplier_id")
    .in("id", offerIds);
  if (!offers || offers.length !== offerIds.length
    || offers.some((offer) => offer.status !== "verified" || offer.supplier_id !== purchase.supplier_id)) {
    back(orderPath(purchase.order_id), "Une offre source n'est plus vérifiée pour ce fournisseur.", true);
  }

  const { error } = await db.from("purchase_orders").update({
    status: "approved",
    approved_by: "admin",
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    internal_notes: `Approbation humaine enregistrée le ${new Date().toISOString()}. Exécution fournisseur encore manuelle.`,
  }).eq("id", purchaseId).eq("status", "pending_approval");
  if (error) back(orderPath(purchase.order_id), "Approbation non enregistrée.", true);
  await db.from("order_events").upsert({
    order_id: purchase.order_id,
    kind: "purchase_approved",
    event_key: `purchase-approved:${purchaseId}`,
    message: `La fiche d'achat ${purchase.purchase_reference} a été validée pour commande fournisseur. Aucun paiement automatique au fournisseur n'a été effectué.`,
    is_public: false,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  await audit("purchase_order_approved", purchaseId, { order_id: purchase.order_id }, "admin");
  back(orderPath(purchase.order_id), "Fiche approuvée. La commande fournisseur reste à passer et à confirmer manuellement.");
}

export async function markPurchaseOrderOrdered(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const supplierReference = str(f, "supplier_order_reference").slice(0, 160);
  if (!supplierReference) back("/admin/commandes", "La référence de commande du fournisseur est obligatoire.", true);
  const db = supabaseAdmin();
  const { data: purchase } = await db.from("purchase_orders")
    .select("id,order_id,status,purchase_reference").eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  if (purchase.status !== "approved") back(orderPath(purchase.order_id), "La fiche doit être approuvée avant d'être déclarée commandée.", true);
  if (!await hasVerifiedPayment(purchase.order_id)) back(orderPath(purchase.order_id), "Paiement non vérifié.", true);

  const { error } = await db.from("purchase_orders").update({
    status: "ordered",
    supplier_order_reference: supplierReference,
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", purchaseId).eq("status", "approved");
  if (error) back(orderPath(purchase.order_id), "Mise à jour de la commande fournisseur impossible.", true);
  await db.from("order_events").upsert({
    order_id: purchase.order_id,
    kind: "supplier_ordered",
    event_key: `supplier-ordered:${purchaseId}`,
    message: `La fiche d'achat ${purchase.purchase_reference} a été commandée auprès du fournisseur. Référence fournisseur : ${supplierReference}.`,
    is_public: false,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  await audit("purchase_order_submitted", purchaseId, { supplier_reference: supplierReference }, "admin");
  back(orderPath(purchase.order_id), "Commande fournisseur enregistrée.");
}

export async function recordPurchaseReceipt(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const itemId = str(f, "purchase_item_id");
  const receivedQty = Math.floor(num(f, "received_qty"));
  const damagedQty = Math.floor(num(f, "damaged_qty") || 0);
  const qcStatus = str(f, "qc_status");
  const qcNotes = str(f, "qc_notes").slice(0, 1000);
  const allowedQc = ["pending", "passed", "partial", "failed", "not_required"];
  const db = supabaseAdmin();

  const { data: purchase } = await db.from("purchase_orders")
    .select("id,order_id,status,purchase_reference,agency_id")
    .eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  if (!["ordered", "partially_received", "received"].includes(purchase.status)) {
    back(orderPath(purchase.order_id), "La réception est possible uniquement après confirmation de commande fournisseur.", true);
  }
  if (!await hasVerifiedPayment(purchase.order_id)) back(orderPath(purchase.order_id), "Paiement non vérifié.", true);

  const { data: item } = await db.from("purchase_order_items")
    .select("id,qty,received_qty,damaged_qty").eq("id", itemId).eq("purchase_order_id", purchaseId).maybeSingle();
  if (!item) back(orderPath(purchase.order_id), "Ligne d'achat introuvable.", true);
  if (!Number.isSafeInteger(receivedQty) || receivedQty < Number(item.received_qty)
    || receivedQty > Number(item.qty)) {
    back(orderPath(purchase.order_id), "Quantité reçue incohérente (elle doit être cumulative et ne pas dépasser la quantité commandée).", true);
  }
  if (!Number.isSafeInteger(damagedQty) || damagedQty < 0 || damagedQty > receivedQty
    || !allowedQc.includes(qcStatus)) {
    back(orderPath(purchase.order_id), "Quantité endommagée ou état qualité invalide.", true);
  }
  if (qcStatus === "failed" && damagedQty === 0 && !qcNotes) {
    back(orderPath(purchase.order_id), "Une réception échouée doit comporter une note qualité.", true);
  }

  const now = new Date().toISOString();
  const { error: itemError } = await db.from("purchase_order_items").update({
    received_qty: receivedQty,
    damaged_qty: damagedQty,
    received_at: receivedQty > 0 ? now : null,
    qc_status: qcStatus,
    qc_notes: qcNotes,
  }).eq("id", itemId).eq("purchase_order_id", purchaseId);
  if (itemError) back(orderPath(purchase.order_id), "Réception non enregistrée.", true);

  const { data: allItems, error: aggregateError } = await db.from("purchase_order_items")
    .select("qty,received_qty,damaged_qty,qc_status").eq("purchase_order_id", purchaseId);
  if (aggregateError || !allItems?.length) back(orderPath(purchase.order_id), "Réception enregistrée, mais le récapitulatif doit être vérifié.", true);

  const totalQty = allItems.reduce((sum, row) => sum + Number(row.qty), 0);
  const receivedTotal = allItems.reduce((sum, row) => sum + Number(row.received_qty), 0);
  const hasQcFailure = allItems.some((row) => row.qc_status === "failed");
  const status = receivedTotal === totalQty && !hasQcFailure ? "received"
    : receivedTotal > 0 ? "partially_received"
    : "ordered";

  await db.from("purchase_orders").update({
    status,
    received_qty: receivedTotal,
    received_at: status === "received" ? now : null,
    updated_at: now,
  }).eq("id", purchaseId);

  await db.from("order_events").upsert({
    order_id: purchase.order_id,
    kind: "agency_receipt",
    event_key: `purchase-receipt:${purchaseId}:${receivedTotal}:${damagedQty}`,
    message: `Réception fournisseur/agence mise à jour pour ${purchase.purchase_reference} : ${receivedTotal}/${totalQty} unités reçues. Contrôle qualité : ${hasQcFailure ? "anomalie à traiter" : "en cours ou validé"}.`,
    is_public: false,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  await audit("purchase_receipt_recorded", purchaseId, {
    item_id: itemId, received_qty: receivedQty, damaged_qty: damagedQty, qc_status: qcStatus,
  }, "admin");

  back(orderPath(purchase.order_id), status === "received"
    ? "Réception complète enregistrée. Le dossier peut passer à la réexpédition après contrôle de chaque ligne."
    : "Réception partielle enregistrée.");
}

export async function createAgencyReshipment(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const pieces = Math.max(1, Math.min(100, Math.floor(num(f, "pieces") || 1)));
  const weightGrams = str(f, "weight_grams") ? num(f, "weight_grams") : null;
  const db = supabaseAdmin();

  const { data: purchase } = await db.from("purchase_orders")
    .select("id,order_id,status,agency_id,purchase_reference,delivery_address")
    .eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  if (purchase.status !== "received" || !purchase.agency_id) {
    back(orderPath(purchase.order_id), "La réexpédition exige une réception complète dans une agence configurée.", true);
  }
  if (!await hasVerifiedPayment(purchase.order_id)) back(orderPath(purchase.order_id), "Paiement non vérifié.", true);
  const { data: lines } = await db.from("purchase_order_items")
    .select("qty,received_qty,damaged_qty,qc_status").eq("purchase_order_id", purchaseId);
  if (!lines?.length || lines.some((line) =>
    Number(line.received_qty) < Number(line.qty)
    || Number(line.damaged_qty) > 0
    || !["passed", "not_required"].includes(line.qc_status))) {
    back(orderPath(purchase.order_id), "La réexpédition est bloquée : réception ou contrôle qualité incomplet.", true);
  }

  const [{ data: order }, { data: agency }] = await Promise.all([
    db.from("orders").select("ship_address,ship_country").eq("id", purchase.order_id).maybeSingle(),
    db.from("agencies").select("id,name,city,country,address_local,address_latin,contact,active")
      .eq("id", purchase.agency_id).eq("active", true).maybeSingle(),
  ]);
  if (!order || !isRecord(order.ship_address)
    || !order.ship_address.line1 || !order.ship_address.city || !order.ship_country) {
    back(orderPath(purchase.order_id), "Adresse finale du client absente ou incomplète.", true);
  }
  if (!agency?.address_local || !agency?.address_latin) {
    back(orderPath(purchase.order_id), "Adresse de l'agence incomplète.", true);
  }

  const reference = `ASV-OUT-${purchaseId.slice(0, 8).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: shipment, error } = await db.from("shipment_packages").insert({
    order_id: purchase.order_id,
    agency_id: agency.id,
    stage: "agency_to_customer",
    status: "reship_requested",
    package_reference: reference,
    pieces,
    weight_grams: weightGrams && Number.isFinite(weightGrams) && weightGrams > 0 ? weightGrams : null,
    origin_address: {
      kind: "agency_warehouse",
      agency_id: agency.id,
      agency_name: agency.name,
      city: agency.city,
      country: agency.country,
      address_local: agency.address_local,
      address_latin: agency.address_latin,
      contact: agency.contact,
    },
    destination_address: order.ship_address,
    notes: "Réexpédition vers le client final. Cette adresse est réservée au transporteur de la seconde étape et ne doit pas être envoyée au fournisseur chinois.",
  }).select("id").single();
  if (error || !shipment) back(orderPath(purchase.order_id), "Création de la réexpédition impossible.", true);

  await db.from("order_events").upsert({
    order_id: purchase.order_id,
    kind: "reshipment_requested",
    event_key: `reshipment-requested:${shipment.id}`,
    message: "Le colis a été reçu par notre agence et la réexpédition vers l'adresse finale est demandée.",
    is_public: true,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  await audit("agency_reshipment_requested", String(shipment.id), {
    purchase_order_id: purchaseId,
    package_reference: reference,
    agency_id: agency.id,
  }, "admin");
  back(orderPath(purchase.order_id), `Réexpédition créée (${reference}). La référence transporteur reste à renseigner.`);
}

export async function updateShipmentPackage(f: FormData) {
  await requireAdmin();
  const packageId = str(f, "package_id");
  const carrier = str(f, "carrier").slice(0, 120);
  const tracking = str(f, "tracking_number").slice(0, 160);
  const trackingUrl = str(f, "tracking_url");
  const status = str(f, "status");
  const exceptionReason = str(f, "exception_reason").slice(0, 1000);
  const allowed = ["pending", "label_created", "in_transit", "arrived_at_agency", "received", "processing", "reship_requested", "out_for_delivery", "delivered", "lost", "damaged", "exception", "cancelled"];
  if (!allowed.includes(status)) back("/admin/commandes", "Statut de colis invalide.", true);
  if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) {
    back("/admin/commandes", "Lien de suivi invalide.", true);
  }

  const db = supabaseAdmin();
  const { data: parcel } = await db.from("shipment_packages")
    .select("id,order_id,stage,status,package_reference").eq("id", packageId).maybeSingle();
  if (!parcel) back("/admin/commandes", "Colis introuvable.", true);
  if (!await hasVerifiedPayment(parcel.order_id)) {
    back(orderPath(parcel.order_id), "Paiement non vérifié : statut du colis refusé.", true);
  }
  const inboundStatuses = ["pending", "label_created", "in_transit", "arrived_at_agency", "received", "lost", "damaged", "exception", "cancelled"];
  const customerStatuses = ["pending", "label_created", "in_transit", "out_for_delivery", "delivered", "lost", "damaged", "exception", "cancelled"];
  if (parcel.stage === "supplier_to_agency" && !inboundStatuses.includes(status)) {
    back(orderPath(parcel.order_id), "Ce colis concerne l'entrée en agence, pas la livraison finale.", true);
  }
  if (parcel.stage !== "supplier_to_agency" && !customerStatuses.includes(status)) {
    back(orderPath(parcel.order_id), "Statut incompatible avec cette étape logistique.", true);
  }
  if (["in_transit", "out_for_delivery", "delivered"].includes(status) && (!carrier || !tracking)) {
    back(orderPath(parcel.order_id), "Transporteur et numéro de suivi obligatoires pour ce statut.", true);
  }
  if (["lost", "damaged", "exception"].includes(status) && !exceptionReason) {
    back(orderPath(parcel.order_id), "Une explication est obligatoire pour un colis en anomalie.", true);
  }

  const now = new Date().toISOString();
  const isCustomerStage = ["supplier_direct", "provider_fulfillment", "agency_to_customer"].includes(parcel.stage);
  const publicMessage = ({
    label_created: "L'étiquette de votre colis a été créée.",
    in_transit: "Votre colis a été expédié et est en transit.",
    out_for_delivery: "Votre colis est en cours de livraison.",
    delivered: "Votre colis est indiqué comme livré.",
    lost: "Un incident a été signalé pour votre colis. Notre équipe vous contacte.",
    damaged: "Un dommage a été signalé sur le colis. Notre équipe vérifie la situation.",
    exception: "Un incident de transport nécessite une vérification.",
    cancelled: "L'expédition de ce colis a été annulée.",
  } as Record<string, string>)[status];

  const { error } = await db.from("shipment_packages").update({
    carrier: carrier || null,
    tracking_number: tracking || null,
    tracking_url: trackingUrl || null,
    status,
    shipped_at: ["in_transit", "out_for_delivery", "delivered"].includes(status) ? now : undefined,
    received_at: ["arrived_at_agency", "received"].includes(status) ? now : undefined,
    delivered_at: status === "delivered" ? now : undefined,
    last_event_at: now,
    exception_reason: exceptionReason || null,
    updated_at: now,
  }).eq("id", packageId);
  if (error) back(orderPath(parcel.order_id), "Mise à jour du colis impossible.", true);

  const eventMessage = publicMessage ?? (
    status === "arrived_at_agency" || status === "received"
      ? "Le colis est arrivé à l'entrepôt de notre agence pour contrôle et préparation."
      : `Statut logistique interne : ${status}.`
  );
  await db.from("shipment_events").insert({
    package_id: packageId,
    status,
    description: eventMessage,
    source: "manual",
    is_public: isCustomerStage && !!publicMessage,
    event_at: now,
  });
  if (isCustomerStage && publicMessage) {
    await db.from("order_events").upsert({
      order_id: parcel.order_id,
      kind: `shipment_${status}`,
      event_key: `shipment:${packageId}:${status}`,
      message: publicMessage,
      is_public: true,
    }, { onConflict: "event_key", ignoreDuplicates: true });
    const { data: order } = await db.from("orders")
      .select("email,public_token").eq("id", parcel.order_id).maybeSingle();
    if (order?.email && order.public_token) {
      await queueEmail({
        to: order.email,
        orderId: parcel.order_id,
        idempotencyKey: `shipment-email:${packageId}:${status}`,
        subject: "Assavendo Digital — suivi de colis",
        body: `${publicMessage}\n\nSuivi : ${siteUrl()}/suivi/${order.public_token}`,
      });
    }
  }

  await syncOrderStatusFromShipments(parcel.order_id);
  await audit("shipment_package_updated", packageId, {
    order_id: parcel.order_id, status, carrier, tracking_number: tracking,
  }, "admin");
  back(orderPath(parcel.order_id), "Colis mis à jour et événement de suivi enregistré.");
}



const DIGITAL_BUCKET = "digital-assets";
const DIGITAL_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/epub+zip": ".epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

export async function createDigitalAssetUpload(f: FormData): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  await requireAdmin();
  const productId = str(f, "product_id");
  const fileName = str(f, "file_name").replace(/[\\/\u0000-\u001f]/g, "").slice(0, 180);
  const mimeType = str(f, "mime_type").toLowerCase();
  const size = Math.floor(num(f, "size_bytes"));
  const extension = DIGITAL_MIME_EXTENSIONS[mimeType];

  if (!extension || !fileName || !Number.isSafeInteger(size) || size < 1 || size > 50 * 1024 * 1024) {
    return { ok: false, error: "Format, nom ou taille de fichier non autorisé." };
  }
  const { data: product } = await supabaseAdmin().from("products")
    .select("id,kind").eq("id", productId).eq("kind", "digital").maybeSingle();
  if (!product) return { ok: false, error: "Produit numérique introuvable." };

  const path = `${productId}/${crypto.randomUUID()}${extension}`;
  const { data, error } = await supabaseAdmin().storage.from(DIGITAL_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    return { ok: false, error: "Impossible de préparer un dépôt dans le bucket privé." };
  }
  return { ok: true, path, token: data.token };
}

export async function registerDigitalAsset(f: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const productId = str(f, "product_id");
  const path = str(f, "storage_path");
  const fileName = str(f, "file_name").replace(/[\\/\u0000-\u001f]/g, "").slice(0, 180);
  const mimeType = str(f, "mime_type").toLowerCase();
  const size = Math.floor(num(f, "size_bytes"));
  const checksum = str(f, "checksum_sha256").toLowerCase();

  if (!path.startsWith(`${productId}/`) || !/^[a-f0-9-]{36}\.(pdf|zip|epub|docx|xlsx|png|jpg)$/.test(path.slice(productId.length + 1))) {
    return { ok: false, error: "Chemin de stockage invalide." };
  }
  if (!DIGITAL_MIME_EXTENSIONS[mimeType] || !fileName || !Number.isSafeInteger(size)
    || size < 1 || size > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(checksum)) {
    return { ok: false, error: "Métadonnées de fichier invalides." };
  }
  const db = supabaseAdmin();
  const { data: product } = await db.from("products")
    .select("id,kind").eq("id", productId).eq("kind", "digital").maybeSingle();
  if (!product) return { ok: false, error: "Produit numérique introuvable." };
  const { data: signed, error: verifyError } = await db.storage.from(DIGITAL_BUCKET).createSignedUrl(path, 30);
  if (verifyError || !signed?.signedUrl) {
    return { ok: false, error: "Le fichier n'est pas présent dans le bucket privé." };
  }

  const { error } = await db.from("digital_assets").insert({
    product_id: productId,
    storage_bucket: DIGITAL_BUCKET,
    storage_path: path,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: size,
    checksum_sha256: checksum,
    scan_status: "pending",
    distribution_rights: "unverified",
    active: false,
    access_days: 30,
    max_downloads: 5,
  });
  if (error) {
    await db.storage.from(DIGITAL_BUCKET).remove([path]);
    return { ok: false, error: "Le fichier a été téléversé mais son enregistrement a échoué." };
  }
  await audit("digital_asset_uploaded", path, {
    product_id: productId, mime_type: mimeType, size_bytes: size, checksum_sha256: checksum,
  }, "admin");
  revalidatePath("/admin/numerique-services");
  return { ok: true };
}

export async function reviewDigitalAsset(f: FormData) {
  await requireAdmin();
  const id = str(f, "asset_id");
  const scanStatus = str(f, "scan_status");
  const rights = str(f, "distribution_rights");
  const allowedScan = ["pending", "clean", "infected", "failed"];
  const allowedRights = ["unverified", "owned", "licensed", "authorized", "rejected"];
  if (!allowedScan.includes(scanStatus) || !allowedRights.includes(rights)) {
    back("/admin/numerique-services", "Statut de sécurité ou de droits invalide.", true);
  }
  if (scanStatus === "clean" && !["owned", "licensed", "authorized"].includes(rights)) {
    back("/admin/numerique-services", "Un fichier propre ne peut pas être publié sans droits de distribution confirmés.", true);
  }
  const { data: asset } = await supabaseAdmin().from("digital_assets")
    .select("id,product_id,storage_bucket,storage_path").eq("id", id).maybeSingle();
  if (!asset) back("/admin/numerique-services", "Fichier numérique introuvable.", true);
  if (scanStatus === "clean") {
    const { data: signed, error } = await supabaseAdmin().storage
      .from(asset.storage_bucket).createSignedUrl(asset.storage_path, 30);
    if (error || !signed?.signedUrl) back("/admin/numerique-services", "Fichier introuvable dans son stockage privé.", true);
  }
  const active = scanStatus === "clean" && ["owned", "licensed", "authorized"].includes(rights);
  const { error } = await supabaseAdmin().from("digital_assets").update({
    scan_status: scanStatus,
    distribution_rights: rights,
    active,
  }).eq("id", id);
  if (error) back("/admin/numerique-services", "Mise à jour du contrôle numérique impossible.", true);
  await audit("digital_asset_reviewed", id, {
    scan_status: scanStatus, distribution_rights: rights, active,
  }, "admin");
  revalidatePath("/admin/numerique-services");
  back("/admin/numerique-services", active
    ? "Fichier autorisé et contrôlé. Il peut être distribué aux acheteurs ayant payé."
    : "Fichier désactivé jusqu'à validation du contrôle et des droits.");
}

export async function updateServiceTask(f: FormData) {
  await requireAdmin();
  const id = str(f, "task_id");
  const status = str(f, "status");
  const allowed = ["awaiting_brief", "ready", "assigned", "in_progress", "review", "revision_requested", "accepted", "completed", "cancelled", "disputed"];
  if (!allowed.includes(status)) back("/admin/numerique-services", "Statut de prestation invalide.", true);
  const briefText = str(f, "brief_json");
  let brief: Record<string, unknown> = {};
  if (briefText) {
    try {
      const parsed = JSON.parse(briefText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      brief = parsed as Record<string, unknown>;
    } catch {
      back("/admin/numerique-services", "Le brief doit être un objet JSON valide.", true);
    }
  }
  const supplierId = str(f, "assigned_supplier_id") || null;
  if (supplierId) {
    const { data: supplier } = await supabaseAdmin().from("suppliers")
      .select("trust_level").eq("id", supplierId).maybeSingle();
    if (supplier?.trust_level !== "approved") back("/admin/numerique-services", "Le prestataire doit être approuvé avant affectation.", true);
  }
  const dueRaw = str(f, "due_at");
  const dueAt = dueRaw ? new Date(dueRaw).toISOString() : null;
  const { data: existing } = await supabaseAdmin().from("service_tasks")
    .select("id,order_item_id,status").eq("id", id).maybeSingle();
  if (!existing) back("/admin/numerique-services", "Prestation introuvable.", true);
  if (["accepted", "completed"].includes(status) && !str(f, "acceptance_criteria")) {
    back("/admin/numerique-services", "Les critères d'acceptation doivent être renseignés.", true);
  }
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from("service_tasks").update({
    status,
    brief,
    scope: str(f, "scope").slice(0, 5000),
    assigned_supplier_id: supplierId,
    due_at: dueAt,
    acceptance_criteria: str(f, "acceptance_criteria").slice(0, 4000) || null,
    internal_notes: str(f, "internal_notes").slice(0, 4000),
    started_at: status === "in_progress" ? now : undefined,
    completed_at: status === "completed" ? now : null,
    updated_at: now,
  }).eq("id", id);
  if (error) back("/admin/numerique-services", "Mise à jour de la prestation impossible.", true);
  await audit("service_task_updated", id, { status, assigned_supplier_id: supplierId }, "admin");
  revalidatePath("/admin/numerique-services");
  back("/admin/numerique-services", "Prestation mise à jour.");
}

export async function createServiceMilestone(f: FormData) {
  await requireAdmin();
  const taskId = str(f, "task_id");
  const title = str(f, "title").slice(0, 180);
  const description = str(f, "description").slice(0, 2000);
  const dueRaw = str(f, "due_at");
  const dueAt = dueRaw ? new Date(dueRaw).toISOString() : null;
  if (!taskId || !title) back("/admin/numerique-services", "Tâche et titre du jalon sont obligatoires.", true);
  const { data: task } = await supabaseAdmin().from("service_tasks")
    .select("id").eq("id", taskId).maybeSingle();
  if (!task) back("/admin/numerique-services", "Prestation introuvable.", true);
  const { data: last } = await supabaseAdmin().from("service_milestones")
    .select("sort_order").eq("service_task_id", taskId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabaseAdmin().from("service_milestones").insert({
    service_task_id: taskId,
    title,
    description,
    due_at: dueAt,
    sort_order: Number(last?.sort_order ?? -1) + 1,
  });
  if (error) back("/admin/numerique-services", "Création du jalon impossible.", true);
  await audit("service_milestone_created", taskId, { title }, "admin");
  revalidatePath("/admin/numerique-services");
  back("/admin/numerique-services", "Jalon ajouté à la prestation.");
}

export async function assignPurchaseAgency(f: FormData) {
  await requireAdmin();
  const purchaseId = str(f, "purchase_order_id");
  const agencyId = str(f, "agency_id");
  const db = supabaseAdmin();
  const { data: purchase } = await db.from("purchase_orders")
    .select("id,order_id,status,purchase_reference")
    .eq("id", purchaseId).maybeSingle();
  if (!purchase) back("/admin/commandes", "Fiche d'achat introuvable.", true);
  if (purchase.status !== "pending_approval") {
    back(orderPath(purchase.order_id), "La fiche doit être en attente de validation avant l'affectation d'une agence.", true);
  }
  if (!await hasVerifiedPayment(purchase.order_id)) {
    back(orderPath(purchase.order_id), "Paiement non vérifié : affectation bloquée.", true);
  }
  const { data: lines, error: lineError } = await db.from("purchase_order_items")
    .select("id,fulfilment_mode").eq("purchase_order_id", purchaseId);
  if (lineError || !lines?.length || lines.some((line) => line.fulfilment_mode !== "B")) {
    back(orderPath(purchase.order_id), "Cette fiche n'est pas une commande en mode agence B.", true);
  }
  const { data: agency } = await db.from("agencies")
    .select("id,name,city,country,address_local,address_latin,contact,active")
    .eq("id", agencyId).eq("active", true).maybeSingle();
  if (!agency?.address_local || !agency?.address_latin) {
    back(orderPath(purchase.order_id), "Agence inactive ou adresse bilingue incomplète.", true);
  }

  const deliveryAddress = {
    kind: "agency_warehouse",
    agency_id: agency.id,
    agency_name: agency.name,
    city: agency.city,
    country: agency.country,
    address_local: agency.address_local,
    address_latin: agency.address_latin,
    contact: agency.contact,
    receiving_code: purchase.purchase_reference,
  };
  const now = new Date().toISOString();
  const { error } = await db.from("purchase_orders").update({
    agency_id: agency.id,
    delivery_address: deliveryAddress,
    supplier_instructions: "Expédier uniquement vers cet entrepôt Assavendo. Le fournisseur ne doit recevoir aucune adresse, aucun téléphone ni aucune information sur le client final.",
    status: "draft",
    updated_at: now,
    internal_notes: "Agence et adresse d'entrepôt affectées. Soumettre à nouveau à l'approbation avant la commande fournisseur.",
  }).eq("id", purchaseId).eq("status", "pending_approval");
  if (error) back(orderPath(purchase.order_id), "Affectation de l'agence impossible.", true);

  await db.from("purchase_order_items").update({ agency_id: agency.id })
    .eq("purchase_order_id", purchaseId);
  await db.from("shipment_packages").upsert({
    order_id: purchase.order_id,
    agency_id: agency.id,
    stage: "supplier_to_agency",
    status: "pending",
    destination_address: deliveryAddress,
    package_reference: "ASV-PKG-" + purchaseId.slice(0, 8).toUpperCase() + "-IN",
    notes: "Destination fournisseur = entrepôt chinois. Aucune adresse client final n'est transmise.",
  }, { onConflict: "package_reference", ignoreDuplicates: true });
  await audit("purchase_agency_assigned", purchaseId, { agency_id: agency.id }, "admin");
  back(orderPath(purchase.order_id), "Agence attribuée. La fiche revient en brouillon et doit être soumise à une nouvelle approbation.");
}



export async function recordPaymentSettlement(f: FormData) {
  await requireAdmin();
  const reference = str(f, "provider_settlement_id").slice(0, 160);
  const currency = str(f, "currency").toUpperCase();
  const statementReference = str(f, "statement_reference").slice(0, 200);
  const bankLabel = str(f, "bank_account_label").slice(0, 120);
  const description = str(f, "description").slice(0, 1000);
  const grossAmount = num(f, "gross_amount");
  const feeAmount = num(f, "fees_amount");
  const netAmount = num(f, "net_amount");
  const confirmReceived = str(f, "statement_confirmed") === "on";
  const rows = str(f, "transactions").split("\n").map((line) => line.trim()).filter(Boolean);

  if (!reference || !statementReference || !/^[A-Z]{3}$/.test(currency)
    || !Number.isFinite(grossAmount) || !Number.isFinite(feeAmount) || !Number.isFinite(netAmount)
    || grossAmount <= 0 || feeAmount < 0 || netAmount < 0) {
    back("/admin/finances", "Référence, devise ou montants du règlement invalides.", true);
  }
  const grossMinor = toMinor(grossAmount, currency);
  const feeMinor = toMinor(feeAmount, currency);
  const netMinor = toMinor(netAmount, currency);
  if (grossMinor - feeMinor !== netMinor) {
    back("/admin/finances", "Le net doit être exactement égal au brut moins les frais.", true);
  }
  if (!rows.length) back("/admin/finances", "Ajoutez les références des transactions incluses dans ce règlement.", true);

  const parsed = rows.map((row) => {
    const [paymentReference, feeText] = row.split(",").map((value) => value.trim());
    return { reference: paymentReference, feeMinor: Number(feeText) };
  });
  if (parsed.some((item) => !item.reference || !Number.isSafeInteger(item.feeMinor) || item.feeMinor < 0)
    || new Set(parsed.map((item) => item.reference)).size !== parsed.length) {
    back("/admin/finances", "Chaque ligne doit suivre le format REFERENCE_PAIEMENT,FRAIS_EN_UNITES_MINEURES, sans doublon.", true);
  }

  const db = supabaseAdmin();
  const { data: payments } = await db.from("payments")
    .select("id,reference,order_id,amount_minor,currency,status,settled_at")
    .in("reference", parsed.map((item) => item.reference));
  if (!payments || payments.length !== parsed.length) {
    back("/admin/finances", "Une ou plusieurs transactions Paystack sont introuvables.", true);
  }
  const byReference = new Map(payments.map((payment) => [payment.reference, payment]));
  let linkedGross = 0;
  let linkedFees = 0;
  const settlementItems: Array<{
    payment_id: string;
    transaction_reference: string;
    amount_minor: number;
    fee_minor: number;
    currency: string;
  }> = [];

  for (const entry of parsed) {
    const payment = byReference.get(entry.reference);
    if (!payment || payment.status !== "paid_verified" || payment.settled_at) {
      back("/admin/finances", "Transaction " + entry.reference + " non vérifiée ou déjà rapprochée.", true);
    }
    if (String(payment.currency).trim().toUpperCase() !== currency) {
      back("/admin/finances", "Devise différente pour la transaction " + entry.reference + ".", true);
    }
    linkedGross += Number(payment.amount_minor);
    linkedFees += entry.feeMinor;
    settlementItems.push({
      payment_id: payment.id,
      transaction_reference: payment.reference,
      amount_minor: Number(payment.amount_minor),
      fee_minor: entry.feeMinor,
      currency,
    });
  }
  if (linkedGross !== grossMinor || linkedFees !== feeMinor) {
    back("/admin/finances", "Les montants rapprochés ne correspondent pas à la somme des transactions et des frais.", true);
  }

  const now = new Date().toISOString();
  const { data: settlement, error } = await db.from("payment_settlements").insert({
    provider: "paystack",
    provider_settlement_id: reference,
    currency,
    gross_amount_minor: grossMinor,
    fees_minor: feeMinor,
    net_amount_minor: netMinor,
    status: confirmReceived ? "paid" : "pending",
    expected_at: str(f, "expected_at") ? new Date(str(f, "expected_at")).toISOString() : null,
    settled_at: confirmReceived ? now : null,
    bank_account_label: bankLabel || null,
    source_payload: {
      statement_reference: statementReference,
      description,
      manually_reconciled: true,
      statement_confirmed: confirmReceived,
      transaction_count: settlementItems.length,
    },
  }).select("id").single();
  if (error || !settlement) {
    back("/admin/finances", "Règlement non enregistré. Vérifiez que sa référence n'existe pas déjà.", true);
  }

  const { error: itemsError } = await db.from("payment_settlement_items").insert(
    settlementItems.map((item) => ({ settlement_id: settlement.id, ...item })),
  );
  if (itemsError) {
    await db.from("payment_settlements").update({
      status: "failed",
      source_payload: { error: itemsError.message.slice(0, 500), reconciliation_failed: true },
    }).eq("id", settlement.id);
    back("/admin/finances", "Le règlement a été créé mais ses transactions n'ont pas été reliées. Statut marqué failed pour investigation.", true);
  }

  if (confirmReceived) {
    await db.from("payments").update({ settled_at: now }).in("id", settlementItems.map((item) => item.payment_id));
  }
  await audit("payment_settlement_recorded", reference, {
    settlement_id: settlement.id,
    currency,
    gross_minor: grossMinor,
    fees_minor: feeMinor,
    net_minor: netMinor,
    statement_confirmed: confirmReceived,
    transactions: settlementItems.length,
  }, "admin");
  revalidatePath("/admin/finances");
  back("/admin/finances", confirmReceived
    ? "Règlement rapproché et reçu selon le relevé bancaire. Les transactions liées sont marquées settled."
    : "Règlement enregistré en attente de confirmation sur le relevé bancaire.");
}

export async function recordFinanceAdjustment(f: FormData) {
  await requireAdmin();
  const kind = str(f, "kind");
  const allowed = ["supplier_cost", "agency_cost", "payment_fee", "fx_fee", "refund", "chargeback", "reserve", "other"];
  const currency = str(f, "currency").toUpperCase();
  const amount = num(f, "amount");
  const description = str(f, "description").slice(0, 1000);
  const orderId = str(f, "order_id") || null;
  if (!allowed.includes(kind) || !/^[A-Z]{3}$/.test(currency)
    || !Number.isFinite(amount) || amount < 0 || !description) {
    back("/admin/finances", "Ajustement financier invalide.", true);
  }

  let amountUsdMinor: number;
  let fxSnapshot: Record<string, unknown>;
  if (currency === "USD") {
    amountUsdMinor = toMinor(amount, "USD");
    fxSnapshot = { base: "USD", currency: "USD", rate: 1, source: "identity", fetched_at: new Date().toISOString() };
  } else {
    const fx = await getFx();
    const usd = toUsd(fx, amount, currency);
    if (usd === null || !fx) {
      back("/admin/finances", "Aucun snapshot FX frais pour la devise " + currency + ". L'ajustement n'a pas été enregistré.", true);
    }
    amountUsdMinor = toMinor(usd, "USD");
    fxSnapshot = {
      base: "USD",
      source_currency: currency,
      source_amount: amount,
      rate_to_usd: fx.rates[currency],
      rate_source: fx.sources[currency] ?? "unknown",
      fetched_at: new Date(fx.fetchedAt).toISOString(),
    };
  }
  if (orderId) {
    const { data: order } = await supabaseAdmin().from("orders").select("id").eq("id", orderId).maybeSingle();
    if (!order) back("/admin/finances", "Commande liée introuvable.", true);
  }
  const { error } = await supabaseAdmin().from("finance_adjustments").insert({
    kind,
    reference: str(f, "reference").slice(0, 160) || null,
    order_id: orderId,
    amount_minor: toMinor(amount, currency),
    currency,
    amount_usd_minor: amountUsdMinor,
    fx_snapshot: fxSnapshot,
    description,
    incurred_at: str(f, "incurred_at") ? new Date(str(f, "incurred_at")).toISOString() : new Date().toISOString(),
  });
  if (error) back("/admin/finances", "Ajustement financier non enregistré.", true);
  await audit("finance_adjustment_recorded", orderId ?? kind, {
    kind, amount, currency, amount_usd_minor: amountUsdMinor,
  }, "admin");
  revalidatePath("/admin/finances");
  back("/admin/finances", "Ajustement financier enregistré avec son montant source et son snapshot FX.");
}
