import { supabaseAdmin } from "@/lib/supabase";
import { handlePaystackEvent } from "@/lib/paystack";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const db = supabaseAdmin();
  const retryBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const [{ data: retryable, error: retryError }, { data: stale, error: staleError }] = await Promise.all([
    db.from("webhook_events").select("event_key,event_type,payload")
      .in("status", ["received", "failed"])
      .order("received_at", { ascending: true }).limit(25),
    db.from("webhook_events").select("event_key,event_type,payload")
      .eq("status", "processing").lt("updated_at", retryBefore)
      .order("updated_at", { ascending: true }).limit(25),
  ]);
  if (retryError || staleError) {
    return Response.json({ ok: false, error: "Lecture de la file webhook impossible." }, { status: 502 });
  }

  const items = new Map<string, { event_key: string; event_type: string; payload: Record<string, unknown> }>();
  for (const row of [...(retryable ?? []), ...(stale ?? [])]) {
    items.set(row.event_key, {
      event_key: row.event_key,
      event_type: row.event_type,
      payload: (row.payload ?? {}) as Record<string, unknown>,
    });
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const event of items.values()) {
    try {
      const result = await handlePaystackEvent(event.event_key, event.event_type, event.payload);
      if (result.claimed) processed += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }
  return Response.json({ ok: failed === 0, processed, skipped, failed, considered: items.size }, { status: failed ? 207 : 200 });
}

