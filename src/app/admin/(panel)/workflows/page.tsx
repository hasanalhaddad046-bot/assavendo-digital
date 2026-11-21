import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  saveWorkflowDefinition,simulateWorkflowDefinition,approveWorkflowRun,cancelWorkflowRun,
} from "../../actions";
import { Flash } from "../flash";
import { WORKFLOW_TRIGGERS } from "@/lib/workflow-engine";

export const metadata={title:"Automatisations et workflows",robots:{index:false}};

const ACTION_EXAMPLE=JSON.stringify([
  {type:"draft_customer_email",subject:"Mise à jour de votre commande",body:"Bonjour, votre commande est en cours de traitement."}
],null,2);
const CONDITION_EXAMPLE=JSON.stringify([
  {field:"payment_status",operator:"eq",value:"paid_verified"}
],null,2);
const SAMPLE_EXAMPLE=JSON.stringify({
  order_id:"00000000-0000-4000-8000-000000000001",
  payment_status:"paid_verified",
  order_status:"paid_verified",
  risk_score:0,
  ship_country:"TZ",
  event_type:"payment_verified",
  total_usd_minor:12500
},null,2);

export default async function Workflows({searchParams}:{searchParams:Promise<{ok?:string;err?:string}>}) {
  await requireAdmin("workflows:read");
  const q=await searchParams;
  const db=supabaseAdmin();
  const [{data:definitions},{data:runs}]=await Promise.all([
    db.from("workflow_definitions").select("*").order("updated_at",{ascending:false}).limit(100),
    db.from("workflow_runs").select("*,workflow_definitions(name,autonomy_mode)").order("created_at",{ascending:false}).limit(100),
  ]);
  const runIds=(runs??[]).map(r=>r.id);
  const {data:steps}=runIds.length
    ? await db.from("workflow_run_steps").select("*").in("run_id",runIds).order("step_index")
    : {data:[]};
  const byRun=new Map<string,typeof steps>();
  for(const step of steps??[]) {const items=byRun.get(step.run_id)??[];items.push(step);byRun.set(step.run_id,items);}

  return <>
    <h1>Workflows et automatisations</h1>
    <Flash ok={q.ok} err={q.err}/>
    <p className="muted">
      Déclencheurs et conditions déterministes. La liste blanche ne permet que les notes internes et les brouillons de messages.
      Aucun achat fournisseur, paiement, remboursement, changement de prix, publication ou envoi d'e-mail n'est exécuté par un workflow.
      Toute action autre qu'un brouillon d'e-mail passe par une approbation humaine.
    </p>
    <h2>Créer un workflow</h2>
    <form className="buy" action={saveWorkflowDefinition}>
      <label>Nom<input name="name" maxLength={120} required/></label>
      <label>Description<input name="description" maxLength={600}/></label>
      <div className="row">
        <label>Déclencheur<select name="trigger_type" defaultValue="payment_verified">
          {WORKFLOW_TRIGGERS.map(t=><option key={t}>{t}</option>)}
        </select></label>
        <label>Mode d'autonomie<select name="autonomy_mode" defaultValue="approval_required">
          <option value="suggest">suggest — proposer seulement</option>
          <option value="draft">draft — préparer un brouillon</option>
          <option value="approval_required">approval_required — approbation préalable</option>
          <option value="automatic_reversible">automatic_reversible — brouillons internes uniquement</option>
        </select></label>
      </div>
      <label>Paramètres du déclencheur (JSON)<textarea name="trigger_config_json" rows={2} defaultValue="{}"/></label>
      <label>Conditions (JSON)<textarea name="conditions_json" rows={5} defaultValue={CONDITION_EXAMPLE}/></label>
      <label>Actions autorisées (JSON)<textarea name="actions_json" rows={5} defaultValue={ACTION_EXAMPLE}/></label>
      <label className="check"><input type="checkbox" name="enabled"/> Activer ce déclencheur pour les événements réels</label>
      <button>Enregistrer le workflow</button>
    </form>

    <h2>Définitions ({definitions?.length??0})</h2>
    {(definitions??[]).map(workflow=><section key={workflow.id} className="notice">
      <h3>{workflow.name} <span className="pill">{workflow.enabled?"activé":"désactivé"}</span></h3>
      <p>{workflow.description}</p>
      <p>Événement : {workflow.trigger_type} · Mode : {workflow.autonomy_mode} · Actions : {(workflow.actions??[]).map((a:{type:string})=>a.type).join(", ")}</p>
      <details>
        <summary>Modifier la définition</summary>
        <form className="buy" action={saveWorkflowDefinition}>
          <input type="hidden" name="workflow_id" value={workflow.id}/>
          <label>Nom<input name="name" defaultValue={workflow.name} maxLength={120} required/></label>
          <label>Description<input name="description" defaultValue={workflow.description??""} maxLength={600}/></label>
          <div className="row">
            <label>Déclencheur<select name="trigger_type" defaultValue={workflow.trigger_type}>{WORKFLOW_TRIGGERS.map(t=><option key={t}>{t}</option>)}</select></label>
            <label>Mode<select name="autonomy_mode" defaultValue={workflow.autonomy_mode}>
              <option value="suggest">suggest</option><option value="draft">draft</option>
              <option value="approval_required">approval_required</option><option value="automatic_reversible">automatic_reversible</option>
            </select></label>
          </div>
          <label>Paramètres JSON<textarea name="trigger_config_json" rows={2} defaultValue={JSON.stringify(workflow.trigger_config??{},null,2)}/></label>
          <label>Conditions JSON<textarea name="conditions_json" rows={4} defaultValue={JSON.stringify(workflow.conditions??[],null,2)}/></label>
          <label>Actions JSON<textarea name="actions_json" rows={4} defaultValue={JSON.stringify(workflow.actions??[],null,2)}/></label>
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={workflow.enabled}/> Activé</label>
          <button>Enregistrer la définition</button>
        </form>
      </details>
      <form className="buy" action={simulateWorkflowDefinition}>
        <input type="hidden" name="workflow_id" value={workflow.id}/>
        <label>Payload de simulation (JSON)<textarea name="sample_payload_json" rows={5} defaultValue={SAMPLE_EXAMPLE}/></label>
        <button className="sec">Tester sans exécuter les actions</button>
      </form>
    </section>)}

    <h2>Journal d'exécution ({runs?.length??0})</h2>
    {(runs??[]).map(run=>{
      const related=byRun.get(run.id)??[];
      const workflow=Array.isArray(run.workflow_definitions)?run.workflow_definitions[0]:run.workflow_definitions;
      const simulation=String(run.trigger_event).startsWith("simulation:");
      return <section key={run.id} className="notice">
        <h3>{workflow?.name??"Workflow"} <span className="pill">{simulation?"simulation":run.status}</span></h3>
        <p>Déclencheur : {run.trigger_event} · Créé : {new Date(run.created_at).toLocaleString("fr-FR")} · Tentatives : {run.attempts??0}/{run.max_attempts??5}</p>
        {run.error&&<p className="muted">{run.error}</p>}
        <p>{related.length} étape(s) · Approbation : {run.approved_at?run.approved_by+" — "+new Date(run.approved_at).toLocaleString("fr-FR"):"non enregistrée"}</p>
        {related.map(step=><div key={step.id} className="muted">
          <p>{step.step_index+1}. {step.action_type} · {step.status}{step.requires_approval?" · Approbation requise":""}</p>
          {step.output_redacted&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(step.output_redacted,null,2)}</pre>}
        </div>)}
        {!simulation&&run.status==="awaiting_approval"&&<form className="row" action={approveWorkflowRun}>
          <input type="hidden" name="run_id" value={run.id}/>
          <button>Approuver l'exécution</button>
        </form>}
        {!simulation&&["queued","awaiting_approval","failed"].includes(run.status)&&<form className="row" action={cancelWorkflowRun}>
          <input type="hidden" name="run_id" value={run.id}/>
          <button className="sec">Annuler</button>
        </form>}
      </section>;
    })}
  </>;
}
