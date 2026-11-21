import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowDefinition, simulateWorkflow } from "../workflow-engine.ts";

const valid = {
  name:"Suivi de paiement vérifié",
  description:"Préparer un message de confirmation après paiement.",
  trigger_type:"payment_verified",
  conditions:[{field:"payment_status",operator:"eq",value:"paid_verified"}],
  actions:[{type:"draft_customer_email",subject:"Paiement confirmé",body:"Votre paiement a été vérifié."}],
  autonomy_mode:"automatic_reversible",
  enabled:true,
};

test("workflow accepte un déclencheur et une action bornés",()=>{
  const result=validateWorkflowDefinition(valid);
  assert.equal(result.ok,true);
});

test("workflow rejette toute action de paiement ou d'envoi direct",()=>{
  const bad={...valid,actions:[{type:"send_customer_email",subject:"x",body:"y"}]};
  const result=validateWorkflowDefinition(bad);
  assert.equal(result.ok,false);
  if(!result.ok) assert.match(result.error,/Action interdite/);
});

test("workflow rejette les champs de condition non autorisés",()=>{
  const bad={...valid,conditions:[{field:"customer.password",operator:"eq",value:"x"}]};
  const result=validateWorkflowDefinition(bad);
  assert.equal(result.ok,false);
});

test("simulation identifie les déclencheurs sans exécuter les actions",()=>{
  const parsed=validateWorkflowDefinition(valid);
  assert.equal(parsed.ok,true);
  if(!parsed.ok) return;
  const result=simulateWorkflow(parsed.value,{payment_status:"paid_verified"});
  assert.equal(result.matched,true);
  assert.equal(result.steps[0].requiresApproval,false);
  assert.match(result.steps[0].preview,/Aucun message ne sera envoyé/);
});

test("une note interne exige toujours une approbation, même en mode automatique réversible",()=>{
  const parsed=validateWorkflowDefinition({...valid,actions:[{type:"internal_order_note",message:"Vérifier le dossier."}]});
  assert.equal(parsed.ok,true);
  if(!parsed.ok) return;
  const result=simulateWorkflow(parsed.value,{payment_status:"paid_verified"});
  assert.equal(result.steps[0].requiresApproval,true);
});
