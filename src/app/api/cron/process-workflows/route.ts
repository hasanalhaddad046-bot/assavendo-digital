import { supabaseAdmin } from "@/lib/supabase";
import { processWorkflowRun } from "@/lib/workflow-service";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(req:Request) {
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`) {
    return Response.json({ok:false},{status:401});
  }
  const db=supabaseAdmin();
  const now=new Date().toISOString();
  const staleBefore=new Date(Date.now()-5*60_000).toISOString();
  const {data:stale,error:staleError}=await db.from("workflow_runs")
    .select("id,attempts,max_attempts")
    .eq("status","running").lt("updated_at",staleBefore).limit(25);
  if(staleError) return Response.json({ok:false,error:"Lecture des exécutions bloquées impossible."},{status:502});
  let recovered=0;
  for(const run of stale??[]) {
    const attempts=Number(run.attempts??0);
    const max=Number(run.max_attempts??5);
    await db.from("workflow_runs").update({
      status:"failed",
      error:"Exécution interrompue avant la fin ; reprise contrôlée.",
      next_retry_at:attempts<max?now:null,
      updated_at:now,
    }).eq("id",run.id).eq("status","running").lt("updated_at",staleBefore);
    await db.from("workflow_run_steps").update({status:"failed"})
      .eq("run_id",run.id).eq("status","running");
    recovered++;
  }

  const {data:runs,error}=await db.from("workflow_runs")
    .select("id")
    .in("status",["queued","failed"])
    .lt("attempts",5)
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order("created_at",{ascending:true}).limit(25);
  if(error) return Response.json({ok:false,error:"Lecture de la file workflow impossible."},{status:502});
  let processed=0,failed=0,skipped=0;
  for(const run of runs??[]) {
    const result=await processWorkflowRun(db,run.id);
    if(result==="processed") processed++;
    else if(result==="failed") failed++;
    else skipped++;
  }
  return Response.json({
    ok:failed===0,considered:runs?.length??0,processed,failed,skipped,recovered,
  },{status:failed?207:200});
}
