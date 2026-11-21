import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { toMajor } from "@/lib/money";
import { updateProduct, addOffer, setOfferStatus, deleteOffer, computePrice, upsertDeliveryRule, deleteDeliveryRule, aiDescription } from "../../../actions";
import { Flash } from "../../flash";

export const metadata = { title: "Produit", robots: { index: false } };

export default async function Product({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = supabaseAdmin();
  const { data: p } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: cats }, { data: offers }, { data: sups }, { data: rules }] = await Promise.all([
    db.from("categories").select("id,name").order("name"),
    db.from("offers").select("*, suppliers(code,name,trust_level)").eq("product_id", id),
    db.from("suppliers").select("id,code,name,trust_level,billing_currency").order("code"),
    db.from("delivery_rules").select("*").eq("product_id", id).order("country"),
  ]);
  const physical = p.kind === "physical";
  return (
    <>
      <h1>{p.name}</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">Prix actuel : {p.price_usd_minor ? `${(Number(p.price_usd_minor) / 100).toFixed(2)} USD` : "non calculé"}</p>

      <h2>Fiche</h2>
      <form className="buy" action={updateProduct}>
        <input type="hidden" name="id" value={p.id} />
        <input name="name" defaultValue={p.name} required />
        <textarea name="description" defaultValue={p.description} placeholder="Description" />
        <input name="image_url" defaultValue={p.image_url ?? ""} placeholder="URL de l'image (https://…)" />
        <select name="category_id" defaultValue={p.category_id ?? ""}><option value="">Catégorie</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="row"><input name="lead_min" type="number" placeholder="Délai min (j)" defaultValue={p.lead_time_days_min ?? ""} /><input name="lead_max" type="number" placeholder="Délai max (j)" defaultValue={p.lead_time_days_max ?? ""} /></div>
        <select name="status" defaultValue={p.status}>
          {["draft", "review", "published", "suspended", "archived"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button>Enregistrer</button>
      </form>
      <form className="buy" action={aiDescription}>
        <input type="hidden" name="product_id" value={p.id} />
        <input name="notes" placeholder="Notes pour l'IA (caractéristiques vérifiées)" />
        <button className="sec">Générer un brouillon de description (IA)</button>
      </form>

      {physical && (
        <>
          <h2>Offres fournisseurs</h2>
          <table className="t">
            <thead><tr><th>Fournisseur</th><th>Prix source</th><th>MOQ</th><th>Mode</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {(offers ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.suppliers?.code} <span className="muted">({o.suppliers?.trust_level})</span></td>
                  <td>{toMajor(Number(o.price_minor), o.currency)} {o.currency}</td><td>{o.moq}</td><td>{o.fulfilment_mode}</td><td><span className="pill">{o.status}</span></td>
                  <td className="row">
                    <form action={setOfferStatus}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="product_id" value={p.id} /><input type="hidden" name="status" value={o.status === "verified" ? "draft" : "verified"} /><button className="sec">{o.status === "verified" ? "Repasser en brouillon" : "Marquer vérifiée"}</button></form>
                    <form action={deleteOffer}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="product_id" value={p.id} /><button className="danger">Supprimer</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="buy" action={addOffer}>
            <input type="hidden" name="product_id" value={p.id} />
            <select name="supplier_id" required><option value="">Fournisseur</option>{(sups ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.trust_level})</option>)}</select>
            <input name="source_url" placeholder="URL source" />
            <input name="supplier_sku" placeholder="SKU fournisseur" /><input name="variant" placeholder="Variante" />
            <div className="row"><input name="price" placeholder="Prix source" required /><input name="currency" placeholder="Devise (CNY)" maxLength={3} defaultValue="CNY" required /><input name="moq" type="number" placeholder="MOQ" defaultValue={1} /></div>
            <select name="mode" defaultValue="B"><option value="A">A — expédition directe</option><option value="B">B — via entrepôt/agence</option><option value="C">C — autre</option></select>
            <input name="destinations" placeholder="Pays desservis (TZ,KE,…) ; vide = tous" />
            <button>Ajouter l'offre</button>
          </form>

          <h2>Calcul du prix (moteur déterministe)</h2>
          <form className="buy" action={computePrice}>
            <input type="hidden" name="product_id" value={p.id} />
            <input name="extra_cost_usd" placeholder="Frais fixes supplémentaires USD (emballage, transport interne…)" defaultValue="0" />
            <input name="margin_pct" placeholder="Marge cible % (vide = paramètre global)" />
            <button>Calculer et enregistrer le prix</button>
          </form>

          <h2>Pays desservis, livraison, DDP/DAP</h2>
          <table className="t">
            <thead><tr><th>Pays</th><th>Mode</th><th>Livraison USD</th><th>Délai</th><th></th></tr></thead>
            <tbody>{(rules ?? []).map((r) => (
              <tr key={r.id}><td>{r.country}</td><td>{r.duty_mode}</td><td>{(Number(r.shipping_usd_minor) / 100).toFixed(2)}</td><td>{r.days_min ?? "—"}–{r.days_max ?? "—"}</td>
                <td><form action={deleteDeliveryRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="product_id" value={p.id} /><button className="danger">Supprimer</button></form></td></tr>
            ))}</tbody>
          </table>
          <form className="buy" action={upsertDeliveryRule}>
            <input type="hidden" name="product_id" value={p.id} />
            <input name="country" placeholder="Pays (ex. TZ)" maxLength={2} required />
            <select name="duty_mode"><option value="DAP">DAP (taxes à la réception)</option><option value="DDP">DDP (taxes incluses)</option></select>
            <input name="shipping_usd" placeholder="Livraison USD" required />
            <div className="row"><input name="days_min" type="number" placeholder="Jours min" /><input name="days_max" type="number" placeholder="Jours max" /></div>
            <button>Ajouter / modifier</button>
          </form>
        </>
      )}
    </>
  );
}
