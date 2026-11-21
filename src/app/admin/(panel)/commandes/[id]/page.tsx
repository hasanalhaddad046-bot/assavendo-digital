import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { updateOrderItem, setOrderStatus, addOrderNote } from "../../../actions";
import { Flash } from "../../flash";

export const metadata = { title: "Commande", robots: { index: false } };

export default async function Order({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: events }, { data: pays }, { data: ags }] = await Promise.all([
    db.from("order_items").select("*").eq("order_id", id),
    db.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    db.from("payments").select("reference,status,amount_minor,currency").eq("order_id", id),
    db.from("agencies").select("id,name").eq("active", true),
  ]);
  const a = (o.ship_address ?? {}) as Record<string, string>;
  return (
    <>
      <h1>Commande n° {o.number} <span className="pill">{o.status}</span></h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p>{o.email} — {a.name}, {a.phone}<br />{a.line1}, {a.city} {a.region} {a.postal} ({o.ship_country})<br />
        Total {(Number(o.total_usd_minor) / 100).toFixed(2)} USD dont livraison {(Number(o.shipping_usd_minor) / 100).toFixed(2)} · Risque {o.risk_score} {(o.risk_reasons as string[] ?? []).join(" ; ")}<br />
        Facture : {o.invoice_number ?? "—"}</p>
      <p className="muted">Paiements : {(pays ?? []).map((p) => `${p.reference} ${p.status} ${Number(p.amount_minor) / 100} ${p.currency}`).join(" | ") || "—"}</p>

      <h2>Fiche d'achat fournisseur</h2>
      {(items ?? []).map((i) => {
        const off = (i.offer_snapshot ?? {}) as Record<string, unknown>;
        return (
          <form key={i.id} className="buy" action={updateOrderItem} style={{ maxWidth: 720, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
            <input type="hidden" name="id" value={i.id} /><input type="hidden" name="order_id" value={id} />
            <strong>{i.product_name} × {i.qty} ({i.duty_mode ?? "n/a"})</strong>
            <span className="muted">Offre figée : SKU {String(off.supplier_sku ?? "")} {String(off.variant ?? "")} — {off.price_minor ? `${Number(off.price_minor) / 100} ${off.currency}` : "—"} — {String(off.source_url ?? "")}</span>
            <select name="purchase_status" defaultValue={i.purchase_status}>{["to_buy", "ordered", "at_agency", "shipped", "delivered", "problem"].map((s) => <option key={s}>{s}</option>)}</select>
            <input name="supplier_order_ref" placeholder="N° de commande fournisseur" defaultValue={i.supplier_order_ref ?? ""} />
            <select name="agency_id" defaultValue={i.agency_id ?? ""}><option value="">Agence / entrepôt</option>{(ags ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <div className="row"><input name="carrier" placeholder="Transporteur" defaultValue={i.carrier ?? ""} /><input name="tracking_number" placeholder="N° de suivi" defaultValue={i.tracking_number ?? ""} /></div>
            <button>Enregistrer la ligne</button>
          </form>
        );
      })}

      <h2>Statut</h2>
      <form className="buy" action={setOrderStatus}>
        <input type="hidden" name="id" value={id} />
        <select name="status" defaultValue={o.status}>{["manual_review", "paid_verified", "processing", "shipped", "delivered", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select>
        <input name="message" placeholder="Message au client (optionnel, sinon message standard)" />
        <button>Changer le statut (notifie le client)</button>
      </form>
      <form className="buy" action={addOrderNote}>
        <input type="hidden" name="id" value={id} /><input name="message" placeholder="Note" required />
        <label><input type="checkbox" name="public" /> Visible par le client</label><button className="sec">Ajouter une note</button>
      </form>
      <h2>Historique</h2>
      <ul>{(events ?? []).map((e) => <li key={e.id}>{new Date(e.created_at).toLocaleString("fr-FR")} [{e.kind}{e.is_public ? "" : ", interne"}] {e.message}</li>)}</ul>
    </>
  );
}
