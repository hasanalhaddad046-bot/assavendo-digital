import { supabaseAdmin } from "@/lib/supabase";
import { updateRma, refundRma } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Retours", robots: { index: false } };

export default async function Rma({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { data } = await supabaseAdmin().from("rma_requests").select("*, orders(number,email,total_usd_minor)").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <h1>Retours et remboursements</h1>
      <Flash ok={sp.ok} err={sp.err} />
      {(data ?? []).length === 0 && <p>Aucune demande.</p>}
      {(data ?? []).map((r) => (
        <div key={r.id} className="notice">
          <strong>Commande {r.orders?.number}</strong> — {r.kind} — <span className="pill">{r.status}</span><br />
          {r.orders?.email}<br />{r.reason}
          <form className="buy" action={updateRma}>
            <input type="hidden" name="id" value={r.id} />
            <select name="status" defaultValue={r.status === "requested" ? "approved" : r.status}>{["approved", "rejected", "received", "closed"].map((s) => <option key={s}>{s}</option>)}</select>
            <input name="admin_note" placeholder="Réponse au client" defaultValue={r.admin_note} />
            <button className="sec">Mettre à jour</button>
          </form>
          {["approved", "received"].includes(r.status) && (
            <form className="buy" action={refundRma}>
              <input type="hidden" name="id" value={r.id} />
              <input name="amount_usd" placeholder={`Montant USD (max ${(Number(r.orders?.total_usd_minor) / 100).toFixed(2)})`} required />
              <button className="danger">Rembourser via Paystack</button>
            </form>
          )}
          {r.status === "refunded" && <p>Remboursé : {(Number(r.refund_usd_minor) / 100).toFixed(2)} USD (réf. {r.refund_reference})</p>}
        </div>
      ))}
    </>
  );
}
