export const WORKFLOW_TRIGGERS = [
  "payment_verified",
  "order_manual_review",
  "shipment_status_changed",
  "return_requested",
  "digital_delivery_failed",
] as const;
export type WorkflowTrigger = typeof WORKFLOW_TRIGGERS[number];

export const WORKFLOW_ACTIONS = [
  "internal_order_note",
  "draft_customer_email",
] as const;
export type WorkflowAction = typeof WORKFLOW_ACTIONS[number];
export type WorkflowAutonomy = "suggest"|"draft"|"approval_required"|"automatic_reversible";

export type WorkflowCondition = {
  field:"order_status"|"payment_status"|"risk_score"|"ship_country"|"shipment_status"|"rma_status"|"event_type"|"total_usd_minor";
  operator:"eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"contains";
  value:string|number|string[];
};
export type WorkflowActionConfig = {
  type:WorkflowAction;
  message?:string;
  subject?:string;
  body?:string;
};
export interface WorkflowDefinitionInput {
  name:string;
  description:string;
  trigger_type:WorkflowTrigger;
  conditions:WorkflowCondition[];
  actions:WorkflowActionConfig[];
  autonomy_mode:WorkflowAutonomy;
  enabled:boolean;
}
export interface WorkflowSimulation {
  matched:boolean;
  reason:string;
  steps:Array<{index:number;type:WorkflowAction;requiresApproval:boolean;safeAutomatic:boolean;preview:string}>;
}

const conditionFields = new Set([
  "order_status","payment_status","risk_score","ship_country","shipment_status",
  "rma_status","event_type","total_usd_minor",
]);
const actionTypes = new Set<string>(WORKFLOW_ACTIONS);
const operators = new Set(["eq","neq","gt","gte","lt","lte","in","contains"]);

export function validateWorkflowDefinition(input:unknown):{ok:true;value:WorkflowDefinitionInput}|{ok:false;error:string} {
  if(!input||typeof input!=="object"||Array.isArray(input)) return {ok:false,error:"Définition invalide."};
  const row=input as Record<string,unknown>;
  const name=String(row.name??"").trim();
  const description=String(row.description??"").trim();
  const trigger=String(row.trigger_type??"") as WorkflowTrigger;
  const autonomy=String(row.autonomy_mode??"suggest") as WorkflowAutonomy;
  if(name.length<3||name.length>120) return {ok:false,error:"Le nom doit contenir entre 3 et 120 caractères."};
  if(description.length>600) return {ok:false,error:"La description dépasse 600 caractères."};
  if(!WORKFLOW_TRIGGERS.includes(trigger)) return {ok:false,error:"Déclencheur non autorisé."};
  if(!["suggest","draft","approval_required","automatic_reversible"].includes(autonomy)) return {ok:false,error:"Mode d'autonomie non autorisé."};
  if(!Array.isArray(row.conditions)||row.conditions.length>12) return {ok:false,error:"Maximum 12 conditions."};
  const conditions:WorkflowCondition[]=[];
  for(const c of row.conditions){
    if(!c||typeof c!=="object"||Array.isArray(c)) return {ok:false,error:"Condition mal formée."};
    const v=c as Record<string,unknown>;
    const field=String(v.field??"");
    const operator=String(v.operator??"");
    const value=v.value;
    if(!conditionFields.has(field)||!operators.has(operator)) return {ok:false,error:"Champ ou opérateur de condition interdit."};
    if(!(typeof value==="string"||typeof value==="number"||(Array.isArray(value)&&value.every(x=>typeof x==="string")))) return {ok:false,error:"Valeur de condition invalide."};
    if(typeof value==="string"&&value.length>160) return {ok:false,error:"Valeur trop longue."};
    if(typeof value==="number"&&!Number.isFinite(value)) return {ok:false,error:"Valeur numérique non finie."};
    if(Array.isArray(value)&&value.length>20) return {ok:false,error:"Maximum 20 valeurs par condition."};
    conditions.push({field:field as WorkflowCondition["field"],operator:operator as WorkflowCondition["operator"],value:value as WorkflowCondition["value"]});
  }
  if(!Array.isArray(row.actions)||row.actions.length<1||row.actions.length>8) return {ok:false,error:"Un workflow doit contenir de 1 à 8 actions autorisées."};
  const actions:WorkflowActionConfig[]=[];
  for(const a of row.actions){
    if(!a||typeof a!=="object"||Array.isArray(a)) return {ok:false,error:"Action mal formée."};
    const v=a as Record<string,unknown>;
    const type=String(v.type??"");
    if(!actionTypes.has(type)) return {ok:false,error:"Action interdite. Aucun envoi, paiement, remboursement ou achat direct n'est autorisé."};
    const message=String(v.message??"").trim();
    const subject=String(v.subject??"").trim();
    const body=String(v.body??"").trim();
    if(type==="internal_order_note"&&(!message||message.length>1000)) return {ok:false,error:"La note interne doit contenir entre 1 et 1000 caractères."};
    if(type==="draft_customer_email"&&(!subject||!body||subject.length>180||body.length>4000)) return {ok:false,error:"Le brouillon d'e-mail doit avoir un objet et un contenu (max 4000 caractères)."};
    actions.push({type:type as WorkflowAction,message,subject,body});
  }
  return {ok:true,value:{
    name,description,trigger_type:trigger,conditions,actions,autonomy_mode:autonomy,enabled:row.enabled===true,
  }};
}

function fieldValue(payload:Record<string,unknown>,field:WorkflowCondition["field"]):unknown {
  return payload[field];
}
function compare(actual:unknown,condition:WorkflowCondition):boolean {
  const expected=condition.value;
  switch(condition.operator){
    case "eq": return String(actual??"")===String(expected);
    case "neq": return String(actual??"")!==String(expected);
    case "gt": return typeof actual==="number"&&typeof expected==="number"&&actual>expected;
    case "gte": return typeof actual==="number"&&typeof expected==="number"&&actual>=expected;
    case "lt": return typeof actual==="number"&&typeof expected==="number"&&actual<expected;
    case "lte": return typeof actual==="number"&&typeof expected==="number"&&actual<=expected;
    case "in": return Array.isArray(expected)&&expected.map(String).includes(String(actual??""));
    case "contains": return typeof actual==="string"&&typeof expected==="string"&&actual.toLowerCase().includes(expected.toLowerCase());
  }
}
export function simulateWorkflow(
  definition:Pick<WorkflowDefinitionInput,"conditions"|"actions"|"autonomy_mode">,
  payload:Record<string,unknown>,
):WorkflowSimulation {
  const failures=definition.conditions.filter(c=>!compare(fieldValue(payload,c.field),c));
  const matched=failures.length===0;
  const steps=definition.actions.map((action,index)=>{
    const safeAutomatic=action.type==="draft_customer_email";
    const requiresApproval=definition.autonomy_mode!=="automatic_reversible"||!safeAutomatic;
    const preview=action.type==="draft_customer_email"
      ? "Créer un brouillon d'e-mail. Aucun message ne sera envoyé."
      : "Ajouter une note interne à la commande. Validation humaine obligatoire.";
    return {index,type:action.type,requiresApproval,safeAutomatic,preview};
  });
  return {
    matched,
    reason:matched?"Toutes les conditions sont satisfaites.":`Conditions non satisfaites : ${failures.map(c=>c.field).join(", ")}.`,
    steps,
  };
}
