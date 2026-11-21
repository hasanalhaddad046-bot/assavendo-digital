import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { format, toMajor } from "@/lib/money";

export const metadata = { title: "Ma commande", robots: { index: false } };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  awaiting_payment: "En attente de paiement", manual_review: "Vérification en cours", paid_verified: "Payée",
  processing: "En préparation", shipped: "Expédiée", delivered: "Livrée", cancelled: "Annulée", refunded: "Remboursée",
};

export default async function Order({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("*").eq("public_token", token).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: events }] = await Promise.all([
    db.from("order_items").select("id,product_name,qty,unit_usd_minor,carrier,tracking_number,duty_mode").eq("order_id", o.id),
    db.from("order_events").select("message,created_at").eq("order_id", o.id).eq("is_public", true).order("created_at", { ascending: false }),
  ]);
  const usd = (m: number) => format(toMajor(Number(m), "USD"), "USD");
  return (
    <section style={{ padding: "32px 0" }}>
      <h1>Commande n° {o.number}</h1>
      <p><span className="pill">{LABEL[o.status] ?? o.status}</span></p>
      <table className="t">
        <thead><tr><th>Article</th><th>Qté</th><th>Prix</th><th>Suivi colis</th></tr></thead>
        <tbody>
          {(items ?? []).map((i) => (
            <tr key={i.id}>
              <td>{i.product_name}</td><td>{i.qty}</td><td>{usd(i.unit_usd_minor)}</td>
              <td>{i.tracking_number ? `${i.carrier ?? ""} ${i.tracking_number}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Livraison : {usd(o.shipping_usd_minor)} · Total : <strong>{usd(o.total_usd_minor)}</strong></p>
      {(items ?? []).some((i) => i.duty_mode === "DAP") && <p className="muted">Mode DAP : droits et taxes d'importation éventuels à régler à la réception.</p>}
      <h2>Historique</h2>
      <ul>{(events ?? []).map((e, k) => <li key={k}>{new Date(e.created_at).toLocaleString("fr-FR")} — {e.message}</li>)}</ul>
      <p className="row noprint">
        {o.invoice_number && <Link href={`/facture/${token}`}>Voir la facture</Link>}
        <Link href="/retours/demande">Demander un retour ou de l'aide</Link>
      </p>
    </section>
  );
}
