import { requireAdmin } from "@/lib/admin-auth";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { toMajor } from "@/lib/money";
import {
  updateProduct, addOffer, setOfferStatus, deleteOffer, computePrice,
  upsertDeliveryRule, deleteDeliveryRule, aiDescription,
  createVariant, toggleVariant, addOfferTier, deleteOfferTier,
  addOfferCostComponent, deleteOfferCostComponent,
} from "../../../actions";
import { Flash } from "../../flash";

export const metadata = { title: "Produit", robots: { index: false } };

export default async function Product({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAdmin("catalog:read");
  const { id } = await params;
  const search = await searchParams;
  const db = supabaseAdmin();
  const { data: product } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (!product) notFound();

  const [
    { data: categories },
    { data: offers },
    { data: suppliers },
    { data: rules },
    { data: variants },
    { data: agencies },
  ] = await Promise.all([
    db.from("categories").select("id,name").order("name"),
    db.from("offers").select("*, suppliers(code,name,trust_level)").eq("product_id", id).order("created_at", { ascending: false }),
    db.from("suppliers").select("id,code,name,trust_level,billing_currency").order("code"),
    db.from("delivery_rules").select("*").eq("product_id", id).order("country"),
    db.from("product_variants").select("*").eq("product_id", id).order("sort_order").order("name"),
    db.from("agencies").select("id,name,city,country,active").eq("active", true).order("name"),
  ]);

  const offerIds = (offers ?? []).map((offer) => offer.id);
  const [{ data: tiers }, { data: components }] = offerIds.length
    ? await Promise.all([
        db.from("offer_price_tiers").select("*").in("offer_id", offerIds).order("min_qty"),
        db.from("offer_cost_components").select("*").in("offer_id", offerIds).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const formatSource = (minor: number, currency: string) =>
    `${toMajor(Number(minor), currency).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} ${currency}`;

  return (
    <>
      <h1>{product.name}</h1>
      <Flash ok={search.ok} err={search.err} />
      <p className="muted">
        Prix public : {product.price_usd_minor ? `${(Number(product.price_usd_minor) / 100).toFixed(2)} USD` : "non calculé"}
        {" · "}Coût rendu de référence : {product.landed_cost_usd_minor ? `${(Number(product.landed_cost_usd_minor) / 100).toFixed(2)} USD` : "non calculé"}
        {" · "}Offre : {product.selected_offer_id ? String(product.selected_offer_id).slice(0, 8) : "non sélectionnée"}
        {" · "}Calcul : {product.price_calculated_at ? new Date(product.price_calculated_at).toLocaleString("fr-FR") : "—"}
      </p>

      <h2>Fiche produit</h2>
      <form className="buy" action={updateProduct}>
        <input type="hidden" name="id" value={product.id} />
        <label>Nom<input name="name" defaultValue={product.name} required /></label>
        <div className="row">
          <label>Marque<input name="brand" defaultValue={product.brand ?? ""} /></label>
          <label>Nom/source d'origine<input name="source_name" defaultValue={product.source_name ?? ""} /></label>
        </div>
        <label>Description<textarea name="description" defaultValue={product.description} /></label>
        <label>Image (URL HTTPS)<input name="image_url" defaultValue={product.image_url ?? ""} placeholder="https://…" /></label>
        <label>Catégorie
          <select name="category_id" defaultValue={product.category_id ?? ""}>
            <option value="">Sélectionner</option>
            {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>Contenu du colis<textarea name="package_contents" defaultValue={product.package_contents ?? ""} /></label>
        <label>Garantie / conditions<textarea name="warranty_terms" defaultValue={product.warranty_terms ?? ""} /></label>
        <div className="row">
          <label>Délai fournisseur min (jours)<input name="lead_min" type="number" min="0" defaultValue={product.lead_time_days_min ?? ""} /></label>
          <label>Délai fournisseur max (jours)<input name="lead_max" type="number" min="0" defaultValue={product.lead_time_days_max ?? ""} /></label>
        </div>
        <label>Publication
          <select name="status" defaultValue={product.status}>
            {["draft", "review", "published", "suspended", "archived"].map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <button>Enregistrer la fiche</button>
      </form>

      <form className="buy" action={aiDescription}>
        <input type="hidden" name="product_id" value={product.id} />
        <label>Notes factuelles pour l'IA<input name="notes" placeholder="Caractéristiques vérifiées, sans donnée client" /></label>
        <button className="sec">Générer un brouillon de description</button>
      </form>

      {product.kind === "physical" && (
        <>
          <h2>Variantes du produit</h2>
          {(variants ?? []).length === 0 && <p className="muted">Aucune variante enregistrée.</p>}
          <table className="t">
            <thead><tr><th>SKU interne</th><th>Variante</th><th>Attributs</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {(variants ?? []).map((variant) => (
                <tr key={variant.id}>
                  <td>{variant.sku}</td>
                  <td>{variant.name}</td>
                  <td><code>{JSON.stringify(variant.attributes)}</code></td>
                  <td>{variant.active ? "Active" : "Inactive"}</td>
                  <td>
                    <form action={toggleVariant}>
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="id" value={variant.id} />
                      <input type="hidden" name="active" value={variant.active ? "false" : "true"} />
                      <button className="sec">{variant.active ? "Désactiver" : "Activer"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="buy" action={createVariant}>
            <input type="hidden" name="product_id" value={product.id} />
            <h3>Ajouter une variante</h3>
            <div className="row">
              <label>SKU interne<input name="sku" required placeholder="ASV-PROD-BLACK-M" /></label>
              <label>Nom<input name="name" required placeholder="Noir · Taille M" /></label>
            </div>
            <label>Attributs JSON<input name="attributes" placeholder='{"color":"black","size":"M"}' /></label>
            <label>Ordre<input name="sort_order" type="number" min="0" defaultValue="0" /></label>
            <button>Enregistrer la variante</button>
          </form>

          <h2>Offres fournisseurs</h2>
          <p className="muted">Le prix source et sa devise sont conservés tels que fournis. Une offre n'entre dans le calcul que si le fournisseur est approuvé, le stock connu et l'offre vérifiée récemment.</p>
          <table className="t">
            <thead><tr><th>Fournisseur / SKU</th><th>Prix source</th><th>MOQ</th><th>Disponibilité</th><th>Qualité</th><th>Logistique</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {(offers ?? []).map((offer) => (
                <tr key={offer.id}>
                  <td>
                    {offer.suppliers?.code} <span className="muted">({offer.suppliers?.trust_level})</span>
                    <div className="muted">{offer.supplier_sku || "SKU non renseigné"}</div>
                  </td>
                  <td>{formatSource(offer.price_minor, offer.currency)}</td>
                  <td>{offer.moq}</td>
                  <td>{offer.availability_status}{offer.available_qty !== null ? ` · ${offer.available_qty}` : ""}</td>
                  <td>{offer.quality_score ?? "—"}/100</td>
                  <td>{offer.fulfilment_mode}{offer.agency_id ? " · agence" : ""}</td>
                  <td><span className="pill">{offer.status}</span></td>
                  <td>
                    <form action={setOfferStatus}>
                      <input type="hidden" name="id" value={offer.id} />
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="status" value={offer.status === "verified" ? "draft" : "verified"} />
                      <button className="sec">{offer.status === "verified" ? "Repasser en brouillon" : "Vérifier"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="buy" action={addOffer}>
            <input type="hidden" name="product_id" value={product.id} />
            <h3>Enregistrer une offre fournisseur</h3>
            <label>Fournisseur
              <select name="supplier_id" required>
                <option value="">Sélectionner</option>
                {(suppliers ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name} ({supplier.trust_level})</option>
                ))}
              </select>
            </label>
            <label>URL source<input name="source_url" placeholder="https://…" /></label>
            <div className="row">
              <label>SKU fournisseur<input name="supplier_sku" /></label>
              <label>Variante fournisseur
                <select name="variant_id" defaultValue="">
                  <option value="">À associer plus tard</option>
                  {(variants ?? []).filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku} — {variant.name}</option>)}
                </select>
              </label>
            </div>
            <div className="row">
              <label>Prix unitaire source<input name="price" type="number" min="0" step="0.0001" required /></label>
              <label>Devise source<input name="currency" maxLength={3} defaultValue="CNY" required /></label>
              <label>MOQ<input name="moq" type="number" min="1" defaultValue="1" required /></label>
            </div>
            <div className="row">
              <label>Disponibilité
                <select name="availability_status" defaultValue="unknown">
                  {["available","low_stock","preorder","unknown","out_of_stock","discontinued"].map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label>Quantité disponible<input name="available_qty" type="number" min="0" /></label>
              <label>Qualité (0–100)<input name="quality_score" type="number" min="0" max="100" step="1" /></label>
            </div>
            <div className="row">
              <label>Mode
                <select name="mode" defaultValue="B">
                  <option value="A">A — expédition directe</option>
                  <option value="B">B — via entrepôt/agence</option>
                  <option value="C">C — fulfilment partenaire</option>
                </select>
              </label>
              <label>Agence (mode B)
                <select name="agency_id" defaultValue="">
                  <option value="">Aucune sélection</option>
                  {(agencies ?? []).map((agency) => <option key={agency.id} value={agency.id}>{agency.name} — {agency.city}, {agency.country}</option>)}
                </select>
              </label>
              <label>Validité jusqu'au<input name="valid_until" type="date" /></label>
            </div>
            <label>Destinations (codes pays, séparés par virgules)<input name="destinations" placeholder="TZ,KE,UG ; vide = toutes" /></label>
            <button>Enregistrer l'offre (non vérifiée)</button>
          </form>

          <h2>Paliers de quantité et frais par offre</h2>
          {(offers ?? []).map((offer) => (
            <section key={offer.id} className="notice">
              <strong>{offer.suppliers?.code} — {offer.variant || offer.supplier_sku || offer.id.slice(0, 8)}</strong>
              <h4>Paliers de prix source</h4>
              {(tiers ?? []).filter((tier) => tier.offer_id === offer.id).map((tier) => (
                <div key={tier.id} className="row">
                  <span>{tier.min_qty}–{tier.max_qty ?? "∞"} : {formatSource(tier.price_minor, tier.currency)}</span>
                  <form action={deleteOfferTier}>
                    <input type="hidden" name="product_id" value={product.id} />
                    <input type="hidden" name="offer_id" value={offer.id} />
                    <input type="hidden" name="id" value={tier.id} />
                    <button className="danger">Supprimer</button>
                  </form>
                </div>
              ))}
              <form className="buy" action={addOfferTier}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="offer_id" value={offer.id} />
                <div className="row">
                  <label>Quantité min<input name="min_qty" type="number" min="1" required /></label>
                  <label>Quantité max (vide = illimité)<input name="max_qty" type="number" min="1" /></label>
                  <label>Prix source<input name="price" type="number" min="0" step="0.0001" required /></label>
                  <label>Devise<input name="currency" maxLength={3} defaultValue={offer.currency} required /></label>
                </div>
                <button>Ajouter palier</button>
              </form>

              <h4>Composants de coût</h4>
              {(components ?? []).filter((component) => component.offer_id === offer.id).map((component) => (
                <div key={component.id} className="row">
                  <span>{component.label} · {component.cost_stage} · {formatSource(component.amount_minor, component.currency)} · {component.per_unit ? "par unité" : "par commande"} · {component.included_in_supplier_price ? "inclus" : "à ajouter"}</span>
                  <form action={deleteOfferCostComponent}>
                    <input type="hidden" name="product_id" value={product.id} />
                    <input type="hidden" name="offer_id" value={offer.id} />
                    <input type="hidden" name="id" value={component.id} />
                    <button className="danger">Supprimer</button>
                  </form>
                </div>
              ))}
              <form className="buy" action={addOfferCostComponent}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="offer_id" value={offer.id} />
                <div className="row">
                  <label>Type
                    <select name="kind">
                      {["supplier_fee","packaging","customization","sample","domestic_shipping","insurance","handling","bank_fee","fx_fee","other"].map((kind) => <option key={kind}>{kind}</option>)}
                    </select>
                  </label>
                  <label>Libellé<input name="label" required /></label>
                  <label>Montant<input name="amount" type="number" min="0" step="0.0001" required /></label>
                  <label>Devise<input name="currency" maxLength={3} defaultValue={offer.currency} required /></label>
                </div>
                <div className="row">
                  <label>Étape
                    <select name="cost_stage">
                      {["supplier","china_domestic","agency_receiving","inspection","repackaging","export","international","destination","other"].map((stage) => <option key={stage}>{stage}</option>)}
                    </select>
                  </label>
                  <label className="check"><input type="checkbox" name="per_unit" defaultChecked /> Coût par unité</label>
                  <label className="check"><input type="checkbox" name="included_in_supplier_price" /> Déjà inclus dans le prix source</label>
                </div>
                <button>Ajouter composant</button>
              </form>
            </section>
          ))}

          <h2>Calcul du prix public</h2>
          <p className="muted">Chaque prix est calculé au niveau du produit ou de sa variante. Le système sélectionne une offre vérifiée selon le coût rendu, les paliers, les frais, la fraîcheur, la confiance et la qualité. Un taux FX frais et le taux réel des frais de paiement sont obligatoires. Le détail de chaque calcul est archivé.</p>
          <section className="notice">
            <h3>Prix de base du produit</h3>
            <p>Actuel : {product.price_usd_minor ? formatSource(product.price_usd_minor, "USD") : "non calculé"} · Coût rendu : {product.landed_cost_usd_minor ? formatSource(product.landed_cost_usd_minor, "USD") : "—"}</p>
            <form className="buy" action={computePrice}>
              <input type="hidden" name="product_id" value={product.id} />
              <label>Autres frais USD par unité<input name="extra_cost_usd" type="number" min="0" step="0.01" defaultValue="0" /></label>
              <label>Marge cible sur prix de vente (%)<input name="margin_pct" type="number" min="1" max="90" step="0.1" placeholder="Paramètre global" /></label>
              <button>Calculer le prix de base</button>
            </form>
          </section>
          {(variants ?? []).map((variant) => (
            <section key={variant.id} className="notice">
              <h3>Variante {variant.sku} — {variant.name}</h3>
              <p>Prix actuel : {variant.price_usd_minor ? formatSource(variant.price_usd_minor, "USD") : "non calculé"} · Coût rendu : {variant.landed_cost_usd_minor ? formatSource(variant.landed_cost_usd_minor, "USD") : "—"}</p>
              <form className="buy" action={computePrice}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="variant_id" value={variant.id} />
                <label>Autres frais USD par unité<input name="extra_cost_usd" type="number" min="0" step="0.01" defaultValue="0" /></label>
                <label>Marge cible sur prix de vente (%)<input name="margin_pct" type="number" min="1" max="90" step="0.1" placeholder="Paramètre global" /></label>
                <button>Calculer le prix de cette variante</button>
              </form>
            </section>
          ))}

          <h2>Livraison produit × pays (DDP/DAP)</h2>
          <table className="t">
            <thead><tr><th>Pays</th><th>Mode</th><th>Livraison USD</th><th>Délai</th><th></th></tr></thead>
            <tbody>
              {(rules ?? []).map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.country}</td>
                  <td>{rule.duty_mode}</td>
                  <td>{(Number(rule.shipping_usd_minor) / 100).toFixed(2)}</td>
                  <td>{rule.days_min ?? "—"}–{rule.days_max ?? "—"} j</td>
                  <td>
                    <form action={deleteDeliveryRule}>
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="id" value={rule.id} />
                      <button className="danger">Supprimer</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="buy" action={upsertDeliveryRule}>
            <input type="hidden" name="product_id" value={product.id} />
            <div className="row">
              <label>Code pays<input name="country" maxLength={2} placeholder="TZ" required /></label>
              <label>Livraison USD (coût facturé)<input name="shipping_usd" type="number" min="0" step="0.01" required /></label>
              <label>Mode droits
                <select name="duty_mode"><option value="DAP">DAP</option><option value="DDP">DDP</option></select>
              </label>
            </div>
            <div className="row">
              <label>Délai min (jours)<input name="days_min" type="number" min="0" /></label>
              <label>Délai max (jours)<input name="days_max" type="number" min="0" /></label>
            </div>
            <button>Enregistrer la règle</button>
          </form>
        </>
      )}
    </>
  );
}
