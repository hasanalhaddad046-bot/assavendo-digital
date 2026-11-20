import { roundUpStep, decimals } from "./money";
import { supabaseAdmin, getSettings, audit } from "./supabase";

// Source principale + secours. Jamais de taux inventé.
const PRIMARY = "https://api.frankfurter.dev/v1/latest?base=USD";
const SECONDARY = "https://open.er-api.com/v6/latest/USD";

async function fetchRates(url: string): Promise<Record<string, number> | null> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: Record<string, number> };
    return j.rates && typeof j.rates === "object" ? j.rates : null;
  } catch {
    return null;
  }
}

/** Actualise le snapshot. Complète les devises absentes de la source principale avec la secondaire. */
export async function refreshFx(): Promise<boolean> {
  const rates: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const [name, url] of [["primary", PRIMARY], ["secondary", SECONDARY]] as const) {
    const got = await fetchRates(url);
    if (!got) continue;
    for (const [cur, rate] of Object.entries(got)) {
      if (!(cur in rates) && Number(rate) > 0) {
        rates[cur] = Number(rate);
        sources[cur] = name;
      }
    }
  }
  if (Object.keys(rates).length === 0) {
    await audit("fx_refresh_failed", "fx", "Aucune source disponible");
    return false;
  }
  rates.USD = 1;
  await supabaseAdmin()
    .from("fx_snapshot")
    .upsert({ id: 1, base: "USD", rates, sources, fetched_at: new Date().toISOString() });
  return true;
}

export interface FxSnapshot {
  rates: Record<string, number>;
  fetchedAt: number;
  fresh: boolean;
}

export async function getFx(): Promise<FxSnapshot | null> {
  const { data } = await supabaseAdmin().from("fx_snapshot").select("*").eq("id", 1).maybeSingle();
  if (!data) return null;
  const s = await getSettings();
  const maxMs = Number(s.fx_stale_after_hours || 36) * 3_600_000;
  const fetchedAt = new Date(data.fetched_at as string).getTime();
  return { rates: data.rates as Record<string, number>, fetchedAt, fresh: Date.now() - fetchedAt <= maxMs };
}

/** Montant dans la devise source -> USD (non arrondi). null si taux indisponible ou périmé. */
export function toUsd(fx: FxSnapshot | null, amountMajor: number, currency: string): number | null {
  const r = fx?.fresh ? fx.rates[currency.toUpperCase()] : undefined;
  return r ? amountMajor / r : null;
}

export interface LocalPrice {
  amount: number;
  currency: string;
  rate: number;
  fetchedAt: number;
}

/** Prix USD -> devise locale d'affichage (indicatif). null si le taux manque : pas de conversion inventée. */
export function usdToLocal(
  fx: FxSnapshot | null,
  usd: number,
  currency: string,
  opts: { marginPct?: number; step?: number } = {},
): LocalPrice | null {
  const cur = currency.toUpperCase();
  const r = fx?.fresh ? fx.rates[cur] : undefined;
  if (!r || !fx) return null;
  let local = usd * r * (1 + (opts.marginPct ?? 0) / 100);
  local = opts.step ? roundUpStep(local, opts.step) : Number(local.toFixed(decimals(cur)));
  return { amount: local, currency: cur, rate: r, fetchedAt: fx.fetchedAt };
}

const COUNTRY_CURRENCY: Record<string, string> = {
  TZ: "TZS", KE: "KES", UG: "UGX", RW: "RWF", US: "USD", GB: "GBP", NG: "NGN", ZA: "ZAR", GH: "GHS",
  CA: "CAD", AU: "AUD", AE: "AED", SA: "SAR", IN: "INR", CN: "CNY", JP: "JPY", CH: "CHF",
  FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", PT: "EUR", IE: "EUR", AT: "EUR",
};

/** Suggestion de devise depuis le pays IP approximatif ; le visiteur peut toujours changer. */
export function currencyForCountry(country?: string | null): string {
  return (country && COUNTRY_CURRENCY[country.toUpperCase()]) || "USD";
}
