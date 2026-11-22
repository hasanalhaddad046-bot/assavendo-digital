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
  const [{ data: runs }, { data: usage }, { data: providerConfigs }, { data: modelRows }] = await Promise.all([
    db.from("ai_tool_runs").select("*").eq("provider", "manus").order("created_at", { ascending: false }).limit(50),
    db.from("ai_usage_records").select("provider,model_key,tokens_input,tokens_output,cost_usd_micro,cost_known,succeeded,created_at")
      .order("created_at", { ascending: false }).limit(100),
    db.from("ai_provider_configs").select("provider,enabled,secret_env_name,base_url").order("provider"),
    db.from("ai_models").select("provider,model_key,enabled").order("provider"),
  ]);
  const modelCounts = new Map<string, number>();
  for (const model of modelRows ?? []) {
    if (model.enabled) modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
  }
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

      <h2>État des fournisseurs IA</h2>
      <p className="muted">Les valeurs des clés ne sont jamais affichées. Seule leur présence côté serveur est vérifiée ; aucune connexion n'est déclarée opérationnelle sans modèle configuré et appel de test réussi.</p>
      <table className="t">
        <thead><tr><th>Fournisseur</th><th>Activation</th><th>Clé serveur</th><th>Modèle</th><th>État</th></tr></thead>
        <tbody>
          {(providerConfigs ?? []).map((provider) => {
            const keyName = provider.secret_env_name;
            const keyReady = Boolean(keyName && process.env[keyName]?.trim());
            const modelEnv = provider.provider === "manus" ? null : "ASV_MODEL_" + String(provider.provider).toUpperCase();
            const modelReady = modelEnv ? Boolean(process.env[modelEnv]?.trim()) : true;
            const registeredModels = modelCounts.get(provider.provider) ?? 0;
            const canRun = provider.enabled && keyReady && modelReady;
            return (
              <tr key={provider.provider}>
                <td>{String(provider.provider).toUpperCase()}</td>
                <td>{provider.enabled ? "Activé en base" : "Désactivé"}</td>
                <td>{keyReady ? "Présente" : "Manquante"} <span className="muted">({keyName})</span></td>
                <td>{provider.provider === "manus" ? "Agent à sélectionner" : (modelReady ? "ID modèle présent" : "ID modèle manquant")} · {registeredModels} entrée(s) en registre</td>
                <td><span className="pill">{canRun ? "Configuration présente — test requis" : "Non opérationnel"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Le registre de modèles est vide. Ne renseignez que des IDs proposés dans vos propres comptes fournisseurs et vérifiés sur leurs API. Les tarifs inconnus restent non chiffrés.</p>

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
