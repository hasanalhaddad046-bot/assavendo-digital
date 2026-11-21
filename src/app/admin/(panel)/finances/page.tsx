import { supabaseAdmin } from "@/lib/supabase";
import { toMajor, decimals } from "@/lib/money";
import { Flash } from "../flash";
import { recordPaymentSettlement, recordFinanceAdjustment } from "../../actions";

export const metadata = { title: "Trésorerie et rapprochement", robots: { index: false } };

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: decimals(currency),
  }).format(toMajor(Number(minor), currency));

export default async function Finance({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const query = await searchParams;
  const db = supabaseAdmin();
  const [
    { data: payments },
    { data: settlements },
    { data: adjustments },
  ] = await Promise.all([
    db.from("payments").select("id,reference,order_id,amount_minor,currency,status,provider_status,verified_at,settled_at,orders(number,email)")
      .order("created_at", { ascending: false }).limit(100),
    db.from("payment_settlements").select("*").order("created_at", { ascending: false }).limit(50),
    db.from("finance_adjustments").select("*").order("incurred_at", { ascending: false }).limit(100),
  ]);

  const verified = (payments ?? []).filter((payment) => payment.status === "paid_verified");
  const settled = verified.filter((payment) => !!payment.settled_at);
  const outstanding = verified.filter((payment) => !payment.settled_at);
  const groupByCurrency = (rows: typeof payments) => {
    const totals = new Map<string, number>();
    for (const row of rows ?? []) {
      const currency = String(row.currency).trim().toUpperCase();
      totals.set(currency, (totals.get(currency) ?? 0) + Number(row.amount_minor));
    }
    return [...totals.entries()];
  };

  return (
    <>
      <h1>Trésorerie, règlements et rapprochement</h1>
      <Flash ok={query.ok} err={query.err} />
      <p className="muted">
        Un paiement confirmé par Paystack ne signifie pas que les fonds sont déjà crédités sur le compte bancaire.
        Le statut « settled » n'est enregistré qu'après rapprochement avec un relevé ou justificatif réel.
      </p>

      <div className="grid">
        <div className="notice">
          <strong>Paiements vérifiés</strong>
          {groupByCurrency(verified).map(([currency, total]) => <p key={currency}>{money(total, currency)}</p>)}
          <span className="muted">{verified.length} transaction(s)</span>
        </div>
        <div className="notice">
          <strong>Fonds rapprochés comme reçus</strong>
          {groupByCurrency(settled).map(([currency, total]) => <p key={currency}>{money(total, currency)}</p>)}
          <span className="muted">{settled.length} transaction(s)</span>
        </div>
        <div className="notice">
          <strong>À rapprocher</strong>
          {groupByCurrency(outstanding).map(([currency, total]) => <p key={currency}>{money(total, currency)}</p>)}
          <span className="muted">{outstanding.length} transaction(s)</span>
        </div>
      </div>

      <h2>Transactions</h2>
      <table className="t">
        <thead><tr><th>Référence</th><th>Commande</th><th>Montant</th><th>Statut prestataire</th><th>Vérifié</th><th>Règlement bancaire</th></tr></thead>
        <tbody>
          {(payments ?? []).map((payment) => {
            const order = Array.isArray(payment.orders) ? payment.orders[0] : payment.orders;
            return (
            <tr key={payment.id}>
              <td>{payment.reference}</td>
              <td>{order?.number ?? payment.order_id}</td>
              <td>{money(payment.amount_minor, String(payment.currency).trim())}</td>
              <td><span className="pill">{payment.status}</span> {payment.provider_status ?? ""}</td>
              <td>{payment.verified_at ? new Date(payment.verified_at).toLocaleString("fr-FR") : "—"}</td>
              <td>{payment.settled_at ? new Date(payment.settled_at).toLocaleString("fr-FR") : "En attente"}</td>
            </tr>
          ); })}
        </tbody>
      </table>

      <h2>Enregistrer un règlement Paystack</h2>
      <p className="muted">
        Montants du détail des transactions au format : RÉFÉRENCE_PAIEMENT,FRAIS_EN_UNITÉS_MINEURES
        (par exemple ASV-123,150). Une transaction ne peut être rapprochée qu'une seule fois.
      </p>
      <form className="buy" action={recordPaymentSettlement}>
        <div className="row">
          <label>Référence du règlement / lot<input name="provider_settlement_id" required /></label>
          <label>Devise<input name="currency" defaultValue="USD" maxLength={3} required /></label>
          <label>Compte bancaire (libellé non sensible)<input name="bank_account_label" /></label>
        </div>
        <div className="row">
          <label>Brut<input name="gross_amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Frais<input name="fees_amount" type="number" min="0" step="0.01" required /></label>
          <label>Net<input name="net_amount" type="number" min="0" step="0.01" required /></label>
        </div>
        <label>Référence du relevé bancaire / preuve<input name="statement_reference" required /></label>
        <label>Note<textarea name="description" rows={2} /></label>
        <label>Transactions incluses (une par ligne)
          <textarea name="transactions" rows={5} required placeholder="RÉFÉRENCE_PAIEMENT,FRAIS_EN_UNITÉS_MINEURES" />
        </label>
        <label>Date attendue du règlement<input name="expected_at" type="datetime-local" /></label>
        <label className="check"><input type="checkbox" name="statement_confirmed" /> J'ai vérifié sur le relevé bancaire que le montant net a réellement été reçu</label>
        <button>Enregistrer le rapprochement</button>
      </form>

      <h2>Règlements enregistrés</h2>
      {(settlements ?? []).map((settlement) => (
        <div key={settlement.id} className="notice">
          <strong>{settlement.provider_settlement_id}</strong> · <span className="pill">{settlement.status}</span>
          <p>
            Brut {money(settlement.gross_amount_minor, settlement.currency)}
            {" · "}Frais {money(settlement.fees_minor, settlement.currency)}
            {" · "}Net {money(settlement.net_amount_minor, settlement.currency)}
          </p>
          <p className="muted">
            {settlement.bank_account_label ?? "Compte non précisé"}
            {" · "}Attendu : {settlement.expected_at ? new Date(settlement.expected_at).toLocaleString("fr-FR") : "—"}
            {" · "}Reçu : {settlement.settled_at ? new Date(settlement.settled_at).toLocaleString("fr-FR") : "—"}
          </p>
        </div>
      ))}

      <h2>Frais, coûts et ajustements</h2>
      <form className="buy" action={recordFinanceAdjustment}>
        <div className="row">
          <label>Type
            <select name="kind">
              {["supplier_cost", "agency_cost", "payment_fee", "fx_fee", "refund", "chargeback", "reserve", "other"].map((kind) => <option key={kind}>{kind}</option>)}
            </select>
          </label>
          <label>Référence<input name="reference" /></label>
          <label>Commande ID (facultatif)<input name="order_id" /></label>
        </div>
        <div className="row">
          <label>Montant source<input name="amount" type="number" min="0" step="0.0001" required /></label>
          <label>Devise source<input name="currency" defaultValue="USD" maxLength={3} required /></label>
          <label>Date de réalisation<input name="incurred_at" type="datetime-local" /></label>
        </div>
        <label>Description<input name="description" required maxLength={1000} /></label>
        <button>Enregistrer l'ajustement</button>
      </form>
      {(adjustments ?? []).map((item) => (
        <div key={item.id} className="notice">
          {item.kind} · {money(item.amount_minor, String(item.currency).trim())}
          {" · "}Équivalent comptable : {item.amount_usd_minor !== null ? money(item.amount_usd_minor, "USD") : "FX non disponible"}
          <p>{item.description}</p>
          <p className="muted">{new Date(item.incurred_at).toLocaleString("fr-FR")} · {item.reference ?? "Sans référence"}</p>
        </div>
      ))}
    </>
  );
}
