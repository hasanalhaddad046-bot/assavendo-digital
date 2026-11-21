import { roundUpStep, decimals } from "./money.ts";

export interface FxSnapshot {
  rates: Record<string, number>;
  sources: Record<string, string>;
  fetchedAt: number;
  fresh: boolean;
  sourceMetadata: Record<string, unknown>;
}

export function toUsd(fx: FxSnapshot | null, amountMajor: number, currency: string): number | null {
  if (!fx?.fresh || !Number.isFinite(amountMajor) || amountMajor < 0) return null;
  const code = currency.toUpperCase();
  const rate = fx.rates[code];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return code === "USD" ? amountMajor : amountMajor / rate;
}

export interface LocalPrice {
  amount: number;
  currency: string;
  rate: number;
  fetchedAt: number;
  source: string;
}

export function usdToLocal(
  fx: FxSnapshot | null,
  usd: number,
  currency: string,
  opts: { marginPct?: number; step?: number } = {},
): LocalPrice | null {
  const code = currency.toUpperCase();
  const rate = fx?.fresh ? fx.rates[code] : undefined;
  if (!fx || !Number.isFinite(usd) || usd < 0 || !Number.isFinite(rate) || !rate || rate <= 0) return null;
  const margin = opts.marginPct ?? 0;
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) return null;
  const converted = usd * rate * (1 + margin / 100);
  const amount = opts.step ? roundUpStep(converted, opts.step) : Number(converted.toFixed(decimals(code)));
  return {
    amount,
    currency: code,
    rate,
    fetchedAt: fx.fetchedAt,
    source: fx.sources[code] ?? "unknown",
  };
}

