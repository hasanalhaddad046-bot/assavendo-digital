import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Devis de livraison par pays pour des articles du panier (aucune donnée personnelle).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { country?: string; productIds?: string[] } | null;
  const country = (b?.country ?? "").toUpperCase();
  const ids = (b?.productIds ?? []).slice(0, 20);
  if (!/^[A-Z]{2}$/.test(country) || ids.length === 0) return Response.json({ error: "Données invalides." }, { status: 400 });
  const db = supabaseAdmin();
  const { data: products } = await db.from("products").select("id,kind").in("id", ids).eq("status", "published");
  const { data: rules } = await db.from("delivery_rules").select("*").in("product_id", ids).eq("country", country);
  const out = (products ?? []).map((p) => {
    if (p.kind !== "physical") return { productId: p.id, available: true, shippingUsdMinor: 0, dutyMode: null, daysMin: null, daysMax: null };
    const r = (rules ?? []).find((x) => x.product_id === p.id);
    return r
      ? { productId: p.id, available: true, shippingUsdMinor: Number(r.shipping_usd_minor), dutyMode: r.duty_mode, daysMin: r.days_min, daysMax: r.days_max }
      : { productId: p.id, available: false, shippingUsdMinor: 0, dutyMode: null, daysMin: null, daysMax: null };
  });
  return Response.json({ items: out });
}
