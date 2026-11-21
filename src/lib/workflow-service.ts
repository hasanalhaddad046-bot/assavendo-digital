import type { SupabaseClient } from "@supabase/supabase-js";
import { redact } from "./ai-gateway";
import {
  simulateWorkflow,
  type WorkflowActionConfig,
  type WorkflowDefinitionInput,
  type WorkflowTrigger,
} from "./workflow-engine";

type JsonObject = Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redactedObject(value:JsonObject):JsonObject {
  try { return JSON.parse(redact(JSON.stringify(value))) as JsonObject; }
  catch { return {redaction_error:true}; }
}

export async function dispatchWorkflowEvent(
  db:SupabaseClient,
  trigger:WorkflowTrigger,
  payload:JsonObject,
  eventKey:string,
):Promise<{created:number;awaitingApproval:number}> {
  const {data:definitions,error}=await db.from("workflow_definitions").select("*")
    .eq("trigger_type",trigger).eq("enabled",true).limit(100);
  if(error) throw new Error("Lecture des workflows impossible.");
  const safePayload=redactedObject(payload);
  let created=0;
  let awaitingApproval=0;

  for(const raw of definitions??[]) {
    const definition:WorkflowDefinitionInput={
      name:raw.name,description:raw.description??"",trigger_type:raw.trigger_type,
      conditions:raw.conditions??[],actions:raw.actions??[],
      autonomy_mode:raw.autonomy_mode,enabled:raw.enabled,
    };
    const simulation=simulateWorkflow(definition,safePayload);
    if(!simulation.matched) continue;

    const requiresApproval=simulation.steps.some(step=>step.requiresApproval);
    const key=`${raw.id}:${eventKey}`.slice(0,240);
    const {data:run,error:runError}=await db.from("workflow_runs").upsert({
      workflow_id:raw.id,
      trigger_event:trigger,
      trigger_payload_redacted:safePayload,
      status:requiresApproval?"awaiting_approval":"queued",
      idempotency_key:key,
      max_attempts:5,
      updated_at:new Date().toISOString(),
    },{onConflict:"idempotency_key",ignoreDuplicates:true}).select("id").maybeSingle();
    if(runError) throw new Error("Création du journal workflow impossible.");
    if(!run) continue; // Already dispatched for this event: idempotent duplicate.
    created+=1;
    if(requiresApproval) awaitingApproval+=1;

    const steps=definition.actions.map((action:WorkflowActionConfig,index:number)=>{
      const requires=simulation.steps[index].requiresApproval;
      return {
        run_id:run.id,
        step_index:index,
        action_type:action.type,
        status:requires?"awaiting_approval":"pending",
        input_redacted:redactedObject(action as unknown as JsonObject),
        requires_approval:requires,
      };
    });
    const {error:stepError}=await db.from("workflow_run_steps").insert(steps);
    if(stepError) {
      await db.from("workflow_runs").update({
        status:"failed",error:"Impossible de créer les étapes du workflow.",
        updated_at:new Date().toISOString(),
      }).eq("id",run.id);
      throw new Error("Création des étapes workflow impossible.");
    }
    if (!requiresApproval && definition.autonomy_mode === "automatic_reversible") {
      // The only automatic actions are internal drafts. No email is sent and
      // no money, supplier, price, order status or publication is changed.
      await processWorkflowRun(db,String(run.id));
    }
  }
  return {created,awaitingApproval};
}

export async function processWorkflowRun(
  db:SupabaseClient,
  runId:string,
):Promise<"processed"|"skipped"|"failed"> {
  if(!UUID.test(runId)) return "skipped";
  const {data:run}=await db.from("workflow_runs")
    .select("id,status,attempts,max_attempts,workflow_id,trigger_payload_redacted,approved_at,workflow_definitions(autonomy_mode)")
    .eq("id",runId).maybeSingle();
  if(!run||!["queued","failed"].includes(run.status)||!run.workflow_id) return "skipped";
  const definition=Array.isArray(run.workflow_definitions)?run.workflow_definitions[0]:run.workflow_definitions;
  if(!definition) return "skipped";
  if(definition.autonomy_mode!=="automatic_reversible"&&!run.approved_at) return "skipped";

  const attempts=Number(run.attempts??0);
  const maxAttempts=Number(run.max_attempts??5);
  if(attempts>=maxAttempts) return "skipped";
  const now=new Date().toISOString();
  const {data:claimed,error:claimError}=await db.from("workflow_runs").update({
    status:"running",attempts:attempts+1,claimed_at:now,started_at:run.status==="queued"?now:undefined,
    updated_at:now,error:null,
  }).eq("id",runId).eq("status",run.status).select("id").maybeSingle();
  if(claimError||!claimed) return "skipped";

  try {
    const {data:steps,error}=await db.from("workflow_run_steps").select("*")
      .eq("run_id",runId).order("step_index");
    if(error||!steps?.length) throw new Error("Aucune étape workflow exploitable.");
    for(const step of steps) {
      if(step.status==="succeeded"||step.status==="skipped") continue;
      if(step.requires_approval&&!run.approved_at) {
        throw new Error("Une étape nécessite une approbation humaine.");
      }
      const input=(step.input_redacted??{}) as JsonObject;
      if(step.action_type==="draft_customer_email") {
        const subject=String(input.subject??"");
        const body=String(input.body??"");
        if(!subject||!body) throw new Error("Brouillon d'e-mail incomplet.");
        const output={draft:{subject,body},sent:false,external_side_effect:false};
        const {error:stepError}=await db.from("workflow_run_steps").update({
          status:"succeeded",output_redacted:output,completed_at:new Date().toISOString(),
        }).eq("id",step.id).in("status",["pending","failed"]);
        if(stepError) throw new Error("Enregistrement du brouillon impossible.");
      } else if(step.action_type==="internal_order_note") {
        const orderId=String((run.trigger_payload_redacted as JsonObject)?.order_id??"");
        const message=String(input.message??"").slice(0,1000);
        if(!UUID.test(orderId)||!message) throw new Error("Commande ou note interne invalide.");
        const eventKey=`workflow:${runId}:${step.step_index}`;
        const {error:eventError}=await db.from("order_events").upsert({
          order_id:orderId,kind:"workflow_internal_note",event_key:eventKey,
          message:message,is_public:false,
        },{onConflict:"event_key",ignoreDuplicates:true});
        if(eventError) throw new Error("Écriture de la note interne impossible.");
        const {error:stepError}=await db.from("workflow_run_steps").update({
          status:"succeeded",output_redacted:{order_event_created:true,event_key:eventKey},completed_at:new Date().toISOString(),
        }).eq("id",step.id).in("status",["pending","failed"]);
        if(stepError) throw new Error("Finalisation de la note impossible.");
      } else {
        throw new Error("Type d'action absent de la liste blanche.");
      }
    }
    await db.from("workflow_runs").update({
      status:"succeeded",completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),
      error:null,next_retry_at:null,
    }).eq("id",runId).eq("status","running");
    return "processed";
  } catch(error) {
    const message=error instanceof Error?error.message:"Erreur workflow inconnue.";
    const nextAttempt=attempts+1;
    const nextRetry=nextAttempt<maxAttempts
      ? new Date(Date.now()+Math.min(60,2**nextAttempt)*60_000).toISOString()
      : null;
    await db.from("workflow_run_steps").update({
      status:"failed",output_redacted:{error:redact(message).slice(0,500)},
    }).eq("run_id",runId).eq("status","running");
    await db.from("workflow_runs").update({
      status:"failed",error:redact(message).slice(0,1000),next_retry_at:nextRetry,
      updated_at:new Date().toISOString(),
    }).eq("id",runId).eq("status","running");
    return "failed";
  }
}
