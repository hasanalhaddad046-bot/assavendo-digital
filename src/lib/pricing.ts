// Moteur de tarification déterministe (jamais un LLM).
// P = (coûts fixes + frais fixes) / (1 - marge - frais% - provision%)

export interface PricingInput {
  fixedCostsUsd: number;
  marginPct: number;
  /** Frais de paiement en % du prix. Obligatoire : jamais de valeur par défaut. */
  feePct: number | null | undefined;
  feeFixedUsd?: number;
  reservePct?: number;
  minProfitUsd?: number;
}

export interface PricingResult {
  priceUsd: number;
  profitUsd: number;
  marginRealPct: number;
  markupRealPct: number;
  feeUsd: number;
  reserveUsd: number;
}

export type PricingError = { error: "fee_missing" | "bad_denominator"; message: string };

export function salePriceUsd(i: PricingInput): PricingResult | PricingError {
  if (i.feePct === null || i.feePct === undefined || Number.isNaN(i.feePct)) {
    return { error: "fee_missing", message: "Frais de paiement (%) non renseignés : publication bloquée." };
  }
  const feeFixed = i.feeFixedUsd ?? 0;
  const fixed = i.fixedCostsUsd + feeFixed;
  const margin = i.marginPct / 100;
  const fee = i.feePct / 100;
  const reserve = (i.reservePct ?? 0) / 100;

  const den = 1 - margin - fee - reserve;
  if (den <= 0.01) {
    return { error: "bad_denominator", message: "Marge + frais + provision ≥ 99 % du prix." };
  }
  let price = Math.ceil((fixed / den) * 100) / 100;
  let profit = price - fixed - price * (fee + reserve);

  const min = i.minProfitUsd ?? 0;
  if (min > 0 && profit < min) {
    price = Math.ceil(((fixed + min) / (1 - fee - reserve)) * 100) / 100;
    profit = price - fixed - price * (fee + reserve);
  }
  const variable = price * (fee + reserve);
  const totalCost = fixed + variable;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    priceUsd: r2(price),
    profitUsd: r2(profit),
    marginRealPct: price > 0 ? r2((profit / price) * 100) : 0,
    markupRealPct: totalCost > 0 ? r2((profit / totalCost) * 100) : 0,
    feeUsd: r2(price * fee + feeFixed),
    reserveUsd: r2(price * reserve),
  };
}

export function isPricingError(r: PricingResult | PricingError): r is PricingError {
  return "error" in r;
}
