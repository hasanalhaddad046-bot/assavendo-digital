import { getFx, usdToLocal } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENCIES = new Set([
  "USD","TZS","KES","UGX","RWF","EUR","GBP","CNY","JPY","NGN","ZAR","GHS","CAD","AUD","AED","SAR","INR","CHF",
]);

export async function GET(req: Request) {
  const currency = new URL(req.url).searchParams.get("currency")?.toUpperCase() ?? "";
  if (!CURRENCIES.has(currency)) {
    return Response.json({ error: "Devise non prise en charge." }, { status: 400 });
  }
  const fx = await getFx();
  if (!fx?.fresh) {
    return Response.json({ error: "Taux de change temporairement indisponible.", available: false }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const converted = usdToLocal(fx, 1, currency);
  if (!converted) {
    return Response.json({ error: "Aucun taux fiable n'est disponible pour cette devise.", available: false }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({
    currency,
    rate: converted.rate,
    fetchedAt: new Date(fx.fetchedAt).toISOString(),
    source: converted.source,
    indicative: true,
  }, { headers: { "Cache-Control": "no-store" } });
}

