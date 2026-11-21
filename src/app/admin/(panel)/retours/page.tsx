import { supabaseAdmin } from "@/lib/supabase";
import { updateRma, refundRma } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Retours", robots: { index: false } };

export default async function Rma({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const db = supabaseAdmin();
  const { data } = await db.from("rma_requests")
    .select("*, orders(number,email,total_usd_minor)")
    .order("created_at", { ascending: false }).limit(100);
  const orderIds = [...new Set((data ?? []).map((r) => r.order_id))];
  const { data: payments } = orderIds.length
    ? await db.from("payments").select("order_id,amount_minor,currency,status")
        .in("order_id", orderIds).eq("status", "paid_verified")
    : { data: [] };
  const paymentByOrder = new Map<string, { amount_minor: number; currency: string }>();
  for (const payment of payments ?? []) {
    if (!paymentByOrder.has(payment.order_id)) {
      paymentByOrder.set(payment.order_id, { amount_minor: Number(payment.amount_minor), currency: String(payment.currency).trim() });
    }
  }

  return (
    <>
      <h1>Retours et remboursements</h1>
      <Flash ok={sp.ok} err={sp.err} />
      {(data ?? []).length === 0 && <p>Aucune demande.</p>}
      {(data ?? []).map((r) => {
        const payment = paymentByOrder.get(r.order_id);
        const currency = String(r.refund_currency ?? payment?.currency ?? "USD").trim();
        const terminal = ["refund_pending", "refunded", "closed"].includes(r.status);
        return (
          <div key={r.id} className="notice">
            <strong>Commande {r.orders?.number}</strong> — {r.kind} — <span className="pill">{r.status}</span><br />
            {r.orders?.email}<br />
            {r.reason}
            {!terminal && (
              <form className="buy" action={updateRma}>
                <input type="hidden" name="id" value={r.id} />
                <select name="status" defaultValue={r.status === "requested" ? "approved" : r.status}>
                  {["approved", "rejected", "received", "closed"].map((s) => <option key={s}>{s}</option>)}
                </select>
                <input name="admin_note" placeholder="Réponse au client" defaultValue={r.admin_note} />
                <button className="sec">Mettre à jour</button>
              </form>
            )}
            {["approved", "received"].includes(r.status) && (
              <form className="buy" action={refundRma}>
                <input type="hidden" name="id" value={r.id} />
                <label>
                  Montant à rembourser ({currency})
                  <input name="amount_usd" inputMode="decimal" type="number" step="0.01" min="0.01"
                    max={payment ? payment.amount_minor / (currency === "JPY" ? 1 : 100) : undefined}
                    placeholder={payment ? `Montant (paiement initial : ${(payment.amount_minor / (currency === "JPY" ? 1 : 100)).toFixed(2)} ${currency})` : "Montant"}
                    required />
                </label>
                <button className="danger">Initier le remboursement</button>
              </form>
            )}
            {r.status === "refund_pending" && (
              <p>Remboursement en cours — aucune confirmation client finale avant le retour du prestataire.</p>
            )}
            {r.status === "refunded" && (
              <p>Remboursement confirmé par Paystack : {(Number(r.refund_usd_minor) / (currency === "JPY" ? 1 : 100)).toFixed(2)} {currency} (réf. {r.refund_reference})</p>
            )}
            {r.status === "refund_pending" && r.refund_reference && <p>Référence : {r.refund_reference}</p>}
          </div>
        );
      })}
    </>
  );
}
