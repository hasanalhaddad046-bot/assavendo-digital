import { supabaseAdmin } from "@/lib/supabase";
import { deliverOutboxEmail } from "@/lib/mail";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return Response.json({ ok: true, disabled: true, reason: "Resend non configuré." });
  }
  const db = supabaseAdmin();
  const retryBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const [{ data: due, error: dueError }, { data: stale, error: staleError }] = await Promise.all([
    db.from("email_outbox").select("id")
      .in("status", ["pending", "failed"])
      .lt("attempts", 8)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true }).limit(25),
    db.from("email_outbox").select("id")
      .eq("status", "sending").lt("updated_at", retryBefore)
      .order("updated_at", { ascending: true }).limit(25),
  ]);
  if (dueError || staleError) return Response.json({ ok: false }, { status: 502 });
  const ids = [...new Set([...(due ?? []), ...(stale ?? [])].map((r) => r.id))];
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const ok = await deliverOutboxEmail(id);
    if (ok) sent += 1;
    else failed += 1;
  }
  return Response.json({ ok: failed === 0, considered: ids.length, sent, failed });
}

