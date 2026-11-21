import type { FxSnapshot } from "./fx-math.ts";
import { toUsd } from "./fx-math.ts";
import { toMajor } from "./money.ts";

export interface OfferTier {
  min_qty: number;
  max_qty: number | null;
  price_minor: number;
  currency: string;
}
export interface OfferCostComponent {
  kind: string;
  label: string;
  amount_minor: number;
  currency: string;
  per_unit: boolean;
  included_in_supplier_price: boolean;
  cost_stage: string;
}
export interface OfferCostInput {
  offerId: string;
  priceMinor: number;
  currency: string;
  moq: number;
  tiers?: OfferTier[];
  components?: OfferCostComponent[];
}
export interface LandedCostLine {
  kind: string;
  label: string;
  costStage: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  usdPerSellableUnit: number;
}
export interface LandedCostResult {
  offerId: string;
  quantityBasis: number;
  sourceUnitPriceMinor: number;
  sourceCurrency: string;
  selectedTier: OfferTier | null;
  sourceUnitPriceUsd: number;
  componentsUsd: number;
  landedCostUsd: number;
  qualityAdjustedCostUsd: number;
  breakdown: LandedCostLine[];
  fxSnapshot: {
    fetchedAt: string;
    rates: Record<string, number>;
    sources: Record<string, string>;
  };
}
export type LandedCostError =
  | { error: "invalid_offer"; message: string }
  | { error: "invalid_moq"; message: string }
  | { error: "missing_fx"; message: string; currency: string }
  | { error: "missing_tier"; message: string };

export function calculateOfferLandedCost(
  offer: OfferCostInput,
  fx: FxSnapshot | null,
  qualityScore: number | null,
  qualityPenaltyPct: number,
): LandedCostResult | LandedCostError {
  if (!Number.isSafeInteger(offer.priceMinor) || offer.priceMinor < 0 || !/^[A-Z]{3}$/.test(offer.currency.toUpperCase())) {
    return { error: "invalid_offer", message: "Prix fournisseur ou devise source invalide." };
  }
  const moq = Math.max(1, Math.ceil(Number(offer.moq)));
  if (!Number.isSafeInteger(moq) || !Number.isFinite(offer.moq)) {
    return { error: "invalid_moq", message: "Quantité minimale fournisseur invalide." };
  }
  if (!fx?.fresh) return { error: "missing_fx", message: "Snapshot FX absent ou périmé.", currency: offer.currency };

  const tiers = [...(offer.tiers ?? [])].sort((a, b) => a.min_qty - b.min_qty);
  let selectedTier: OfferTier | null = null;
  if (tiers.length) {
    selectedTier = tiers.find((tier) => tier.min_qty <= moq && (tier.max_qty === null || tier.max_qty >= moq)) ?? null;
    if (!selectedTier) {
      const next = tiers.find((tier) => tier.min_qty > moq);
      if (next) selectedTier = next;
      else return { error: "missing_tier", message: "Aucun palier fournisseur ne couvre la quantité minimale." };
    }
  }
  const sourceUnitPriceMinor = selectedTier?.price_minor ?? offer.priceMinor;
  const sourceCurrency = (selectedTier?.currency ?? offer.currency).toUpperCase();
  const sourceUnitMajor = toMajor(sourceUnitPriceMinor, sourceCurrency);
  const sourceUnitPriceUsd = toUsd(fx, sourceUnitMajor, sourceCurrency);
  if (sourceUnitPriceUsd === null) {
    return { error: "missing_fx", message: `Taux manquant pour ${sourceCurrency}.`, currency: sourceCurrency };
  }

  let componentsUsd = 0;
  const breakdown: LandedCostLine[] = [];
  for (const component of offer.components ?? []) {
    if (component.included_in_supplier_price) continue;
    if (!Number.isSafeInteger(component.amount_minor) || component.amount_minor < 0) {
      return { error: "invalid_offer", message: `Composant de coût invalide : ${component.label}.` };
    }
    const currency = component.currency.toUpperCase();
    const amountMajor = toMajor(component.amount_minor, currency);
    const totalMajor = component.per_unit ? amountMajor * moq : amountMajor;
    const totalUsd = toUsd(fx, totalMajor, currency);
    if (totalUsd === null) {
      return { error: "missing_fx", message: `Taux manquant pour le coût « ${component.label} » en ${currency}.`, currency };
    }
    const perUnitUsd = totalUsd / moq;
    componentsUsd += perUnitUsd;
    breakdown.push({
      kind: component.kind,
      label: component.label,
      costStage: component.cost_stage,
      sourceAmountMinor: component.amount_minor,
      sourceCurrency: currency,
      usdPerSellableUnit: perUnitUsd,
    });
  }

  const landedCostUsd = sourceUnitPriceUsd + componentsUsd;
  const score = qualityScore === null || !Number.isFinite(qualityScore)
    ? 0
    : Math.max(0, Math.min(100, qualityScore));
  const penalty = Number.isFinite(qualityPenaltyPct) && qualityPenaltyPct > 0
    ? qualityPenaltyPct
    : 0;
  const qualityAdjustedCostUsd = landedCostUsd * (1 + ((100 - score) / 100) * penalty / 100);

  return {
    offerId: offer.offerId,
    quantityBasis: moq,
    sourceUnitPriceMinor,
    sourceCurrency,
    selectedTier,
    sourceUnitPriceUsd,
    componentsUsd,
    landedCostUsd,
    qualityAdjustedCostUsd,
    breakdown,
    fxSnapshot: {
      fetchedAt: new Date(fx.fetchedAt).toISOString(),
      rates: fx.rates,
      sources: fx.sources,
    },
  };
}

export function chooseBestLandedOffer<T extends { priority?: number; isPreferred?: boolean; result: LandedCostResult }>(
  offers: T[],
): T | null {
  return [...offers].sort((a, b) =>
    a.result.qualityAdjustedCostUsd - b.result.qualityAdjustedCostUsd
    || Number(b.isPreferred ?? false) - Number(a.isPreferred ?? false)
    || (a.priority ?? 100) - (b.priority ?? 100)
    || a.result.offerId.localeCompare(b.result.offerId),
  )[0] ?? null;
}

