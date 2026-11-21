import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { launchManusTask, refreshManusTask, sendManusTaskMessage } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Copilote IA", robots: { index: false } };

export default async function AI({
  searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin("ai:read");
  const query = await searchParams;
  const db = supabaseAdmin();
  const [{ data: runs }, { data: usage }] = await Promise.all([
    db.from("ai_tool_runs").select("*").eq("provider", "manus").order("created_at", { ascending: false }).limit(50),
    db.from("ai_usage_records").select("provider,model_key,tokens_input,tokens_output,cost_usd_micro,cost_known,succeeded,created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  const totalTokens = (usage ?? []).reduce((sum, row) => sum + Number(row.tokens_input) + Number(row.tokens_output), 0);
  const knownCost = (usage ?? []).filter((row) => row.cost_known)
    .reduce((sum, row) => sum + Number(row.cost_usd_micro), 0);

  return (
    <>
      <h1>Copilote IA et tâches Manus</h1>
      <Flash ok={query.ok} err={query.err} />
      <p className="muted">Les tâches sont créées à la demande d'un administrateur. Manus peut analyser et préparer des recommandations, mais aucune dépense, aucun remboursement et aucune modification critique du catalogue n'est exécutée automatiquement.</p>
      <div className="notice">
        <strong>Consommation IA enregistrée</strong>
        <p>{totalTokens.toLocaleString("fr-FR")} tokens sur les 100 derniers appels ; coût configuré : {(knownCost / 1_000_000).toFixed(4)} USD.</p>
        <p className="muted">Une ligne dont le tarif modèle n'est pas renseigné est comptée en tokens, mais son coût reste explicitement inconnu.</p>
      </div>

      <h2>Nouvelle tâche Manus</h2>
      <form className="buy" action={launchManusTask}>
        <label>Titre<input name="title" maxLength={160} required /></label>
        <label>Consigne<textarea name="prompt" rows={8} maxLength={24000} required placeholder="Décrire la recherche ou l'analyse, le résultat attendu et les limites. Ne pas inclure de données personnelles ou de secret." /></label>
        <button>Créer la tâche Manus</button>
      </form>

      <h2>Historique des tâches</h2>
      {(runs ?? []).length === 0 && <p className="muted">Aucune tâche Manus enregistrée.</p>}
      {(runs ?? []).map((run) => (
        <section key={run.id} className="notice">
          <strong>{(run.arguments_redacted as Record<string, string>)?.title ?? run.tool_name}</strong>
          <span className="pill">{run.status}</span>
          <p className="muted">
            {run.provider_task_id ?? "Tâche non transmise"} · {run.provider_status ?? "—"} · {new Date(run.created_at).toLocaleString("fr-FR")}
          </p>
          {run.provider_task_url && <p><a href={run.provider_task_url} target="_blank" rel="noreferrer">Ouvrir dans Manus</a></p>}
          {run.result_text && <p>{run.result_text}</p>}
          {run.error && <p className="err">{run.error}</p>}
          {run.provider_task_id && (
            <>
              <form className="buy" action={refreshManusTask}>
                <input type="hidden" name="id" value={run.id} />
                <input type="hidden" name="task_id" value={run.provider_task_id} />
                <button className="sec">Actualiser le résultat</button>
              </form>
              {["running", "awaiting_approval"].includes(run.status) && (
                <form className="buy" action={sendManusTaskMessage}>
                  <input type="hidden" name="id" value={run.id} />
                  <input type="hidden" name="task_id" value={run.provider_task_id} />
                  <label>Répondre à Manus<textarea name="message" required rows={3} maxLength={24000} /></label>
                  <button className="sec">Envoyer le message</button>
                </form>
              )}
            </>
          )}
        </section>
      ))}
    </>
  );
}
