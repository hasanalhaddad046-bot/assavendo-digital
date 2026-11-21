import { requireAdmin } from "@/lib/admin-auth";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Commandes", robots: { index: false } };

export default async function Orders({
  searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireAdmin("orders:read");
  const sp = await searchParams;
  let q = supabaseAdmin().from("orders").select("id,number,email,status,total_usd_minor,ship_country,risk_score,created_at").order("created_at", { ascending: false }).limit(200);
  if (sp.s) q = q.eq("status", sp.s);
  const { data } = await q;
  return (
    <>
      <h1>Commandes</h1>
      <form className="row" method="get">
        <select name="s" defaultValue={sp.s ?? ""}><option value="">Tous statuts</option>
          {["awaiting_payment", "manual_review", "paid_verified", "processing", "shipped", "delivered", "cancelled", "refunded"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="sec">Filtrer</button>
      </form>
      <table className="t">
        <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Pays</th><th>Total USD</th><th>Risque</th><th>Statut</th></tr></thead>
        <tbody>{(data ?? []).map((o) => (
          <tr key={o.id}><td><Link href={`/admin/commandes/${o.id}`}>{o.number}</Link></td><td>{new Date(o.created_at).toLocaleString("fr-FR")}</td><td>{o.email}</td><td>{o.ship_country}</td>
            <td>{(Number(o.total_usd_minor) / 100).toFixed(2)}</td><td>{o.risk_score}</td><td><span className="pill">{o.status}</span></td></tr>
        ))}</tbody>
      </table>
    </>
  );
}
