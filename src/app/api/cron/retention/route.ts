import { supabaseAdmin, getSettings, audit } from "@/lib/supabase";

export const runtime = "nodejs";

// Conservation limitée : anonymise les commandes terminées/annulées au-delà de retention_days.
// Les montants et numéros de facture sont conservés (obligations comptables), pas les données personnelles.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  const s = await getSettings();
  const days = Math.max(Number(s.retention_days || 1095), 365);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabaseAdmin()
    .from("orders")
    .update({ email: "anonymise@invalid", ship_address: null, anonymized_at: new Date().toISOString() })
    .lt("created_at", cutoff)
    .in("status", ["delivered", "cancelled", "refunded", "awaiting_payment"])
    .is("anonymized_at", null)
    .select("id");
  await audit("retention_run", "orders", { anonymized: data?.length ?? 0, days });
  return Response.json({ ok: true, anonymized: data?.length ?? 0 });
}
