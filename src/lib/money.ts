// Montants en unités mineures entières ; décimales selon ISO 4217.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "UGX", "RWF", "VND", "XAF", "XOF"]);

export function decimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** decimals(currency));
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** decimals(currency);
}

/** Arrondi commercial au pas supérieur (ex. 100 TZS). Ne modifie jamais le montant source. */
export function roundUpStep(amountMajor: number, step: number): number {
  return step > 0 ? Math.ceil(amountMajor / step) * step : amountMajor;
}

export function format(amountMajor: number, currency: string, locale = "fr-FR"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: decimals(currency),
    }).format(amountMajor);
  } catch {
    return `${amountMajor.toFixed(decimals(currency))} ${currency}`;
  }
}
