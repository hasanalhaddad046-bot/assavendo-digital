import { requireAdmin } from "@/lib/admin-auth";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { toMajor, decimals } from "@/lib/money";
import {
  setOrderStatus, addOrderNote, requestPurchaseApproval, approvePurchaseOrder,
  markPurchaseOrderOrdered, recordPurchaseReceipt, createAgencyReshipment, updateShipmentPackage,
  assignPurchaseAgency,
} from "../../../actions";
import { Flash } from "../../flash";

export const metadata = { title: "Commande", robots: { index: false } };

const amount = (minor: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency", currency, maximumFractionDigits: decimals(currency),
  }).format(toMajor(Number(minor), currency));

function addressLine(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Destination non renseignée";
  const item = value as Record<string, unknown>;
  const fields = item.kind === "agency_warehouse"
    ? [item.agency_name, item.address_local, item.address_latin, item.city, item.country, item.receiving_code ? "Code réception : " + String(item.receiving_code) : null]
    : [item.name, item.line1, item.line2, item.district, item.city, item.region, item.postal, item.country];
  return fields.filter(Boolean).map(String).join(" · ");
}

export default async function Order({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAdmin("orders:read");
  const { id } = await params;
  const query = await searchParams;
  const db = supabaseAdmin();

  const [
    { data: order },
    { data: items },
    { data: events },
    { data: payments },
    { data: purchases },
    { data: packages },
    { data: activeAgencies },
  ] = await Promise.all([
    db.from("orders").select("*").eq("id", id).maybeSingle(),
    db.from("order_items").select("*").eq("order_id", id),
    db.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    db.from("payments").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    db.from("purchase_orders").select("*, suppliers(code,name,trust_level), agencies(name,city,country)")
      .eq("order_id", id).order("created_at", { ascending: false }),
    db.from("shipment_packages").select("*").eq("order_id", id).order("created_at", { ascending: true }),
    db.from("agencies").select("id,name,city,country,address_local,address_latin").eq("active", true).order("name"),
  ]);
  if (!order) notFound();

  const purchaseIds = (purchases ?? []).map((purchase) => purchase.id);
  const packageIds = (packages ?? []).map((parcel) => parcel.id);
  const [{ data: purchaseItems }, { data: shipmentEvents }] = await Promise.all([
    purchaseIds.length
      ? db.from("purchase_order_items").select("*").in("purchase_order_id", purchaseIds).order("created_at")
      : Promise.resolve({ data: [] }),
    packageIds.length
      ? db.from("shipment_events").select("*").in("package_id", packageIds).order("event_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const linesByPurchase = new Map<string, Array<Record<string, any>>>();
  for (const line of purchaseItems ?? []) {
    const group = linesByPurchase.get(line.purchase_order_id) ?? [];
    group.push(line);
    linesByPurchase.set(line.purchase_order_id, group);
  }
  const eventsByPackage = new Map<string, Array<Record<string, any>>>();
  for (const event of shipmentEvents ?? []) {
    const group = eventsByPackage.get(event.package_id) ?? [];
    group.push(event);
    eventsByPackage.set(event.package_id, group);
  }

  const clientAddress = (order.ship_address ?? {}) as Record<string, string>;
  const verifiedPayment = (payments ?? []).some((payment) => payment.status === "paid_verified");
  const customerPackages = (packages ?? []).filter((parcel) =>
    ["supplier_direct", "provider_fulfillment", "agency_to_customer"].includes(parcel.stage));
  const allDelivered = customerPackages.length > 0 && customerPackages.every((parcel) => parcel.status === "delivered");

  return (
    <>
      <h1>Commande n° {order.number} <span className="pill">{order.status}</span></h1>
      <Flash ok={query.ok} err={query.err} />

      <section className="notice">
        <h2>Client et adresse finale</h2>
        <p><strong>{clientAddress.name}</strong> — {order.email} · {clientAddress.phone}</p>
        <p>{addressLine(clientAddress)}</p>
        <p>
          Total : <strong>{amount(order.total_usd_minor, "USD")}</strong>
          {" · "}Livraison : {amount(order.shipping_usd_minor, "USD")}
          {" · "}Devise d'affichage : {order.display_currency}
        </p>
        <p>Risque : {order.risk_score} · {(order.risk_reasons as string[] ?? []).join(" ; ") || "Aucun signal documenté"}</p>
        <p>Facture : {order.invoice_number ?? "—"} · CGV acceptées : {order.terms_accepted_at ? new Date(order.terms_accepted_at).toLocaleString("fr-FR") : "—"}</p>
        <p className="muted">L'adresse finale reste réservée aux opérations Assavendo et au transporteur de la dernière étape. Ne pas la recopier dans une fiche fournisseur si la commande passe par une agence.</p>
      </section>

      <h2>Paiements</h2>
      {(payments ?? []).length === 0 && <p className="muted">Aucun paiement enregistré.</p>}
      {(payments ?? []).map((payment) => (
        <div key={payment.id} className="notice">
          <strong>{payment.reference}</strong> · <span className="pill">{payment.status}</span>
          <p>{amount(payment.amount_minor, String(payment.currency).trim())} · {payment.provider_status ?? "Statut prestataire —"}</p>
          {payment.verified_at && <p className="muted">Vérifié : {new Date(payment.verified_at).toLocaleString("fr-FR")}</p>}
          {payment.settled_at && <p className="muted">Règlement : {new Date(payment.settled_at).toLocaleString("fr-FR")}</p>}
        </div>
      ))}
      <form className="buy" action={setOrderStatus}>
        <input type="hidden" name="id" value={id} />
        <label>Statut administratif (les statuts expédié/livré sont calculés depuis les colis)
          <select name="status" defaultValue={order.status === "manual_review" ? "manual_review" : "processing"}>
            <option value="manual_review">manual_review — revue manuelle</option>
            <option value="processing">processing — préparation</option>
            <option value="cancelled">cancelled — annulation</option>
          </select>
        </label>
        <label>Note client<input name="message" placeholder="Message de suivi facultatif" /></label>
        <button className="sec">Mettre à jour le statut administratif</button>
      </form>

      <h2>Articles commandés</h2>
      {(items ?? []).map((item) => {
        const snapshot = (item.offer_snapshot ?? {}) as Record<string, unknown>;
        return (
          <div key={item.id} className="notice">
            <strong>{item.product_name}</strong>
            {item.variant_id && <span className="muted"> · Variante {String(snapshot.variant ?? snapshot.supplier_sku ?? item.variant_id)}</span>}
            <p>Quantité : {item.qty} · Prix unitaire : {amount(item.unit_usd_minor, "USD")} · Achat : {item.purchase_status}</p>
            {snapshot.supplier_sku && <p className="muted">SKU fournisseur : {String(snapshot.supplier_sku)}</p>}
            {snapshot.price_minor !== undefined && <p className="muted">Prix source : {amount(Number(snapshot.price_minor), String(snapshot.currency ?? "USD"))}</p>}
          </div>
        );
      })}

      <h2>Approvisionnement fournisseur</h2>
      {(purchases ?? []).length === 0 && <p className="muted">Aucune fiche d'achat. Elle est créée après confirmation serveur du paiement.</p>}
      {(purchases ?? []).map((purchase) => {
        const purchaseLines = linesByPurchase.get(purchase.id) ?? [];
        const destination = addressLine(purchase.delivery_address);
        const delivery = purchase.delivery_address as Record<string, unknown> | null;
        const isAgency = delivery?.kind === "agency_warehouse";
        return (
          <section key={purchase.id} className="notice">
            <h3>{purchase.purchase_reference} <span className="pill">{purchase.status}</span></h3>
            <p>
              Fournisseur : {purchase.suppliers?.name ?? "Non attribué"}
              {" · "}Confiance : {purchase.suppliers?.trust_level ?? "—"}
              {" · "}Agence : {purchase.agencies?.name ?? "Aucune"}
            </p>
            <p>Destination fournisseur : {destination}</p>
            {isAgency && <p><strong>Mode agence :</strong> l'adresse fournie ici est celle de l'entrepôt chinois, pas celle du client final.</p>}
            {purchase.status === "pending_approval" && !purchase.delivery_address
              && purchaseLines.length > 0 && purchaseLines.every((line) => line.fulfilment_mode === "B") && (
              <form className="buy" action={assignPurchaseAgency}>
                <input type="hidden" name="purchase_order_id" value={purchase.id} />
                <label>Agence / entrepôt Chine
                  <select name="agency_id" required defaultValue="">
                    <option value="">Sélectionner une agence active</option>
                    {(activeAgencies ?? []).map((agency) => (
                      <option key={agency.id} value={agency.id}>
                        {agency.name} — {agency.city}, {agency.country}
                        {agency.address_local && agency.address_latin ? "" : " (adresse incomplète)"}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="sec">Affecter l'agence et réviser le brouillon</button>
              </form>
            )}
            {purchase.supplier_order_reference && <p>Référence fournisseur : {purchase.supplier_order_reference}</p>}
            {purchase.supplier_instructions && <p className="muted">{purchase.supplier_instructions}</p>}
            {purchase.internal_notes && <p className="muted">{purchase.internal_notes}</p>}

            <h4>Lignes et réception qualité</h4>
            {purchaseLines.map((line) => (
              <div key={line.id} className="notice">
                <p>
                  {line.supplier_sku || line.order_item_id}
                  {" · "}Commandé : {line.qty}
                  {" · "}Source : {amount(line.source_unit_price_minor, String(line.source_currency).trim())}
                  {" · "}Reçu : {line.received_qty}/{line.qty}
                  {" · "}Endommagé : {line.damaged_qty}
                  {" · "}QC : {line.qc_status}
                </p>
                <form className="buy" action={recordPurchaseReceipt}>
                  <input type="hidden" name="purchase_order_id" value={purchase.id} />
                  <input type="hidden" name="purchase_item_id" value={line.id} />
                  <div className="row">
                    <label>Quantité reçue cumulative
                      <input name="received_qty" type="number" min={line.received_qty} max={line.qty} defaultValue={line.received_qty} required />
                    </label>
                    <label>Quantité endommagée
                      <input name="damaged_qty" type="number" min="0" max={line.qty} defaultValue={line.damaged_qty} required />
                    </label>
                    <label>Qualité
                      <select name="qc_status" defaultValue={line.qc_status}>
                        {["pending", "passed", "partial", "failed", "not_required"].map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </label>
                  </div>
                  <label>Note QC<input name="qc_notes" defaultValue={line.qc_notes} maxLength={1000} /></label>
                  <button className="sec">Enregistrer réception et qualité</button>
                </form>
              </div>
            ))}

            {purchase.status === "draft" && (
              <form className="buy" action={requestPurchaseApproval}>
                <input type="hidden" name="purchase_order_id" value={purchase.id} />
                <button className="sec" disabled={!verifiedPayment}>Soumettre à validation humaine</button>
              </form>
            )}
            {purchase.status === "pending_approval" && (
              <form className="buy" action={approvePurchaseOrder}>
                <input type="hidden" name="purchase_order_id" value={purchase.id} />
                <button disabled={!verifiedPayment}>Approuver (aucun paiement fournisseur automatique)</button>
              </form>
            )}
            {purchase.status === "approved" && (
              <form className="buy" action={markPurchaseOrderOrdered}>
                <input type="hidden" name="purchase_order_id" value={purchase.id} />
                <label>Référence de commande fournisseur<input name="supplier_order_reference" required /></label>
                <button>Confirmer la commande passée au fournisseur</button>
              </form>
            )}
            {purchase.status === "received" && isAgency && (
              <form className="buy" action={createAgencyReshipment}>
                <input type="hidden" name="purchase_order_id" value={purchase.id} />
                <div className="row">
                  <label>Nombre de colis<input name="pieces" type="number" min="1" max="100" defaultValue="1" required /></label>
                  <label>Poids mesuré (grammes)<input name="weight_grams" type="number" min="1" /></label>
                </div>
                <button>Créer la seconde étape : agence vers client</button>
              </form>
            )}
          </section>
        );
      })}

      <h2>Colis et suivi multi-étapes</h2>
      {(packages ?? []).length === 0 && <p className="muted">Aucun colis enregistré.</p>}
      {(packages ?? []).map((parcel) => {
        const parcelEvents = eventsByPackage.get(parcel.id) ?? [];
        return (
          <section key={parcel.id} className="notice">
            <h3>{parcel.package_reference ?? parcel.id.slice(0, 8)} <span className="pill">{parcel.status}</span></h3>
            <p>Étape : {parcel.stage} · Colis : {parcel.pieces} · Agence : {parcel.agency_id ?? "—"}</p>
            <p>Transporteur : {parcel.carrier ?? "—"} · Suivi : {parcel.tracking_number ?? "—"}</p>
            {parcel.tracking_url && <p><a href={parcel.tracking_url} target="_blank" rel="noreferrer">Ouvrir le suivi transporteur</a></p>}
            <p>Origine : {addressLine(parcel.origin_address)}</p>
            <p>Destination : {addressLine(parcel.destination_address)}</p>
            {parcel.weight_grams && <p>Poids : {parcel.weight_grams} g</p>}
            {parcel.exception_reason && <p className="err">Incident : {parcel.exception_reason}</p>}
            <form className="buy" action={updateShipmentPackage}>
              <input type="hidden" name="package_id" value={parcel.id} />
              <div className="row">
                <label>Transporteur<input name="carrier" defaultValue={parcel.carrier ?? ""} /></label>
                <label>Numéro de suivi<input name="tracking_number" defaultValue={parcel.tracking_number ?? ""} /></label>
                <label>Lien de suivi<input name="tracking_url" type="url" defaultValue={parcel.tracking_url ?? ""} /></label>
              </div>
              <label>Statut
                <select name="status" defaultValue={parcel.status}>
                  {["pending", "label_created", "in_transit", "arrived_at_agency", "received", "processing", "reship_requested", "out_for_delivery", "delivered", "lost", "damaged", "exception", "cancelled"].map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label>Motif d'incident<input name="exception_reason" defaultValue={parcel.exception_reason ?? ""} /></label>
              <button className="sec">Enregistrer l'événement de suivi</button>
            </form>
            {parcelEvents.length > 0 && (
              <details>
                <summary>Historique ({parcelEvents.length})</summary>
                {parcelEvents.map((event) => (
                  <p key={event.id} className="muted">
                    {event.event_at ? new Date(event.event_at).toLocaleString("fr-FR") : "—"} · {event.status} · {event.description}
                  </p>
                ))}
              </details>
            )}
          </section>
        );
      })}
      {allDelivered && <p className="notice">Tous les colis de cette commande ont été marqués comme livrés.</p>}

      <h2>Journal de la commande</h2>
      <form className="buy" action={addOrderNote}>
        <input type="hidden" name="id" value={id} />
        <label>Note interne<textarea name="message" rows={3} required /></label>
        <button className="sec">Ajouter au journal</button>
      </form>
      {(events ?? []).map((event) => (
        <div key={event.id} className="notice">
          <span className="pill">{event.kind}</span> · {new Date(event.created_at).toLocaleString("fr-FR")}
          <p>{event.message}</p>
          <p className="muted">{event.is_public ? "Visible client" : "Interne uniquement"}</p>
        </div>
      ))}
    </>
  );
}
