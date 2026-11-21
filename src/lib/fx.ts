import { toUsd, usdToLocal, type FxSnapshot } from "./fx-math";
export { toUsd, usdToLocal, type FxSnapshot, type LocalPrice } from "./fx-math";
import { supabaseAdmin, getSettings, audit } from "./supabase";

const PRIMARY = "https://api.frankfurter.dev/v1/latest?base=USD";
const SECONDARY = "https://open.er-api.com/v6/latest/USD";

interface SourceRates {
  rates: Record<string, number>;
  effectiveDate: string | null;
  fetchedAt: string;
  provider: "frankfurter" | "er-api";
}

async function fetchPrimary(): Promise<SourceRates | null> {
  try {
    const response = await fetch(PRIMARY, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const json = await response.json() as { rates?: Record<string, number>; date?: string; base?: string };
    if (!json.rates || json.base !== "USD") return null;
    const rates = Object.fromEntries(Object.entries(json.rates)
      .filter(([, rate]) => Number.isFinite(rate) && Number(rate) > 0)
      .map(([code, rate]) => [code.toUpperCase(), Number(rate)]));
    return { rates, effectiveDate: json.date ?? null, fetchedAt: new Date().toISOString(), provider: "frankfurter" };
  } catch {
    return null;
  }
}

async function fetchSecondary(): Promise<SourceRates | null> {
  try {
    const response = await fetch(SECONDARY, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const json = await response.json() as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    if (json.result !== "success" || !json.rates) return null;
    const rates = Object.fromEntries(Object.entries(json.rates)
      .filter(([, rate]) => Number.isFinite(rate) && Number(rate) > 0)
      .map(([code, rate]) => [code.toUpperCase(), Number(rate)]));
    return {
      rates,
      effectiveDate: json.time_last_update_utc ?? null,
      fetchedAt: new Date().toISOString(),
      provider: "er-api",
    };
  } catch {
    return null;
  }
}

export async function refreshFx(): Promise<boolean> {
  const [primary, secondary] = await Promise.all([fetchPrimary(), fetchSecondary()]);
  const rates: Record<string, number> = {};
  const sources: Record<string, string> = {};
  const fetchedAt = new Date().toISOString();

  for (const [code, value] of Object.entries(primary?.rates ?? {})) {
    if (Number.isFinite(value) && value > 0) {
      rates[code] = value;
      sources[code] = "frankfurter";
    }
  }
  for (const [code, value] of Object.entries(secondary?.rates ?? {})) {
    if (!(code in rates) && Number.isFinite(value) && value > 0) {
      rates[code] = value;
      sources[code] = "er-api";
    }
  }
  rates.USD = 1;
  sources.USD = "identity";
  if (Object.keys(rates).length <= 1) {
    await audit("fx_refresh_failed", "fx", { primary: !!primary, secondary: !!secondary });
    return false;
  }

  const snapshot = {
    id: 1,
    base: "USD",
    rates,
    sources,
    source_metadata: {
      primary: primary ? { provider: primary.provider, effective_date: primary.effectiveDate, fetched_at: primary.fetchedAt } : null,
      secondary: secondary ? { provider: secondary.provider, effective_date: secondary.effectiveDate, fetched_at: secondary.fetchedAt } : null,
      strategy: "primary-preferred-per-currency-secondary-fill",
    },
    fetched_at: fetchedAt,
  };

  const db = supabaseAdmin();
  const { error: snapshotError } = await db.from("fx_snapshot").upsert(snapshot);
  if (snapshotError) {
    await audit("fx_snapshot_write_failed", "fx", { message: snapshotError.message });
    return false;
  }
  const { error: historyError } = await db.from("fx_rate_history").insert({
    base: "USD",
    rates,
    sources,
    source_metadata: snapshot.source_metadata,
    fetched_at: fetchedAt,
  });
  if (historyError) {
    await audit("fx_history_write_failed", "fx", { message: historyError.message });
  }
  await audit("fx_refresh_succeeded", "fx", {
    currencies: Object.keys(rates).length - 1,
    primary: !!primary,
    secondary: !!secondary,
    fetched_at: fetchedAt,
  });
  return true;
}


export async function getFx(): Promise<FxSnapshot | null> {
  const { data, error } = await supabaseAdmin().from("fx_snapshot").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  const settings = await getSettings();
  const staleHours = Number(settings.fx_stale_after_hours || 36);
  const maxMs = (Number.isFinite(staleHours) && staleHours >= 1 ? staleHours : 36) * 3_600_000;
  const fetchedAt = new Date(data.fetched_at as string).getTime();
  const rates = data.rates as Record<string, number>;
  const valid = Number.isFinite(fetchedAt) && Object.entries(rates).some(([code, rate]) =>
    code !== "USD" && Number.isFinite(Number(rate)) && Number(rate) > 0);
  return {
    rates,
    sources: (data.sources ?? {}) as Record<string, string>,
    fetchedAt,
    fresh: valid && Date.now() >= fetchedAt && Date.now() - fetchedAt <= maxMs,
    sourceMetadata: (data.source_metadata ?? {}) as Record<string, unknown>,
  };
}

const COUNTRY_CURRENCY: Record<string, string> = {
  TZ: "TZS", KE: "KES", UG: "UGX", RW: "RWF", US: "USD", GB: "GBP", NG: "NGN", ZA: "ZAR", GH: "GHS",
  CA: "CAD", AU: "AUD", AE: "AED", SA: "SAR", IN: "INR", CN: "CNY", JP: "JPY", CH: "CHF",
  FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", PT: "EUR", IE: "EUR", AT: "EUR",
};

export function currencyForCountry(country?: string | null): string {
  return (country && COUNTRY_CURRENCY[country.toUpperCase()]) || "USD";
}
