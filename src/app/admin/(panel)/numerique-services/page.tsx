import { supabaseAdmin } from "@/lib/supabase";
import {
  reviewDigitalAsset,
  updateServiceTask,
  createServiceMilestone,
} from "../../actions";
import { Flash } from "../flash";
import { DigitalAssetUpload } from "@/components/digital-asset-upload";

export const metadata = { title: "Produits numériques et prestations", robots: { index: false } };

export default async function DigitalServices({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const query = await searchParams;
  const db = supabaseAdmin();
  const [
    { data: assets },
    { data: products },
    { data: tasks },
    { data: suppliers },
  ] = await Promise.all([
    db.from("digital_assets").select("*, products(name,slug)")
      .order("created_at", { ascending: false }).limit(100),
    db.from("products").select("id,name,slug").eq("kind", "digital").order("name"),
    db.from("service_tasks").select("*, order_items(product_name,order_id,qty,orders(number,email))")
      .order("created_at", { ascending: false }).limit(100),
    db.from("suppliers").select("id,name,code,trust_level")
      .eq("trust_level", "approved").order("name"),
  ]);
  const taskIds = (tasks ?? []).map((task) => task.id);
  const { data: milestones } = taskIds.length
    ? await db.from("service_milestones").select("*").in("service_task_id", taskIds).order("sort_order")
    : { data: [] };
  const milestonesByTask = new Map<string, typeof milestones>();
  for (const milestone of milestones ?? []) {
    const list = milestonesByTask.get(milestone.service_task_id) ?? [];
    list.push(milestone);
    milestonesByTask.set(milestone.service_task_id, list);
  }

  return (
    <>
      <h1>Produits numériques et prestations</h1>
      <Flash ok={query.ok} err={query.err} />
      <p className="muted">
        Les fichiers sont stockés dans un bucket privé. Un téléchargement n'est disponible qu'après paiement vérifié,
        validation humaine des droits, contrôle de sécurité réussi et tant que la limite d'accès n'est pas atteinte.
      </p>

      <h2>Enregistrer un fichier numérique</h2>
      <p className="muted">Choisissez le produit numérique ci-dessous pour déposer son fichier associé.</p>
      {(products ?? []).map((product) => (
        <section key={product.id} className="notice">
          <strong>{product.name}</strong> · <span className="muted">{product.slug}</span>
          <DigitalAssetUpload productId={product.id} />
        </section>
      ))}

      <h2>Registre des fichiers numériques</h2>
      {(assets ?? []).length === 0 && <p className="muted">Aucun fichier enregistré.</p>}
      {(assets ?? []).map((asset) => (
        <section key={asset.id} className="notice">
          <h3>{asset.file_name} <span className="pill">{asset.active ? "actif" : "non publiable"}</span></h3>
          <p>
            Produit : {asset.products?.name ?? asset.product_id}
            {" · "}Version : {asset.version}
            {" · "}Taille : {(Number(asset.size_bytes) / 1024 / 1024).toFixed(2)} Mo
          </p>
          <p>
            Type : {asset.mime_type}
            {" · "}Scan : {asset.scan_status}
            {" · "}Droits : {asset.distribution_rights}
          </p>
          <p className="muted">Stockage privé : {asset.storage_bucket}/{asset.storage_path}</p>
          <p className="muted">SHA-256 : {asset.checksum_sha256 ?? "—"} · Accès : {asset.access_days ?? 30} jours · Maximum : {asset.max_downloads ?? 5} téléchargements</p>
          <form className="buy" action={reviewDigitalAsset}>
            <input type="hidden" name="asset_id" value={asset.id} />
            <div className="row">
              <label>Résultat du contrôle de fichier
                <select name="scan_status" defaultValue={asset.scan_status}>
                  {["pending", "clean", "infected", "failed"].map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label>Droits de distribution
                <select name="distribution_rights" defaultValue={asset.distribution_rights}>
                  {["unverified", "owned", "licensed", "authorized", "rejected"].map((right) => <option key={right}>{right}</option>)}
                </select>
              </label>
            </div>
            <button>Enregistrer le contrôle et les droits</button>
          </form>
        </section>
      ))}

      <h2>Prestations commandées</h2>
      {(tasks ?? []).length === 0 && <p className="muted">Aucune prestation en cours.</p>}
      {(tasks ?? []).map((task) => {
        const orderItem = task.order_items as Record<string, any> | null;
        const milestonesForTask = milestonesByTask.get(task.id) ?? [];
        return (
          <section key={task.id} className="notice">
            <h3>{orderItem?.product_name ?? "Prestation"} <span className="pill">{task.status}</span></h3>
            <p>
              Commande : {orderItem?.orders?.number ?? "—"}
              {" · "}Client : {orderItem?.orders?.email ?? "—"}
              {" · "}Qté : {orderItem?.qty ?? "—"}
            </p>
            <form className="buy" action={updateServiceTask}>
              <input type="hidden" name="task_id" value={task.id} />
              <div className="row">
                <label>Statut
                  <select name="status" defaultValue={task.status}>
                    {["awaiting_brief", "ready", "assigned", "in_progress", "review", "revision_requested", "accepted", "completed", "cancelled", "disputed"].map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label>Prestataire approuvé
                  <select name="assigned_supplier_id" defaultValue={task.assigned_supplier_id ?? ""}>
                    <option value="">Non affecté</option>
                    {(suppliers ?? []).map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>
                    ))}
                  </select>
                </label>
                <label>Échéance<input name="due_at" type="datetime-local" defaultValue={task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : ""} /></label>
              </div>
              <label>Brief JSON<textarea name="brief_json" rows={4} defaultValue={JSON.stringify(task.brief ?? {}, null, 2)} /></label>
              <label>Périmètre / livrable<textarea name="scope" rows={3} defaultValue={task.scope ?? ""} /></label>
              <label>Critères d'acceptation<textarea name="acceptance_criteria" rows={2} defaultValue={task.acceptance_criteria ?? ""} /></label>
              <label>Notes internes<textarea name="internal_notes" rows={2} defaultValue={task.internal_notes ?? ""} /></label>
              <button>Enregistrer la prestation</button>
            </form>

            <h4>Jalons ({milestonesForTask.length})</h4>
            {milestonesForTask.map((milestone) => (
              <p key={milestone.id} className="muted">
                {milestone.sort_order + 1}. {milestone.title} · {milestone.status}
                {milestone.due_at ? " · " + new Date(milestone.due_at).toLocaleString("fr-FR") : ""}
              </p>
            ))}
            <form className="buy" action={createServiceMilestone}>
              <input type="hidden" name="task_id" value={task.id} />
              <label>Nouveau jalon<input name="title" required maxLength={180} /></label>
              <label>Description<input name="description" maxLength={2000} /></label>
              <label>Échéance<input name="due_at" type="datetime-local" /></label>
              <button className="sec">Ajouter un jalon</button>
            </form>
          </section>
        );
      })}
    </>
  );
}
