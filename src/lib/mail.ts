import { supabaseAdmin } from "./supabase";

type QueueEmailInput = {
  to: string;
  subject: string;
  body: string;
  orderId?: string;
  idempotencyKey?: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function deliverOutboxEmail(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("email_outbox")
    .select("id,to_email,subject,body,status,attempts,next_attempt_at,idempotency_key,updated_at")
    .eq("id", id).maybeSingle();
  if (!row || row.status === "sent") return false;
  const staleSending = row.status === "sending"
    && Date.now() - new Date(row.updated_at).getTime() >= 5 * 60_000;
  if (row.status === "sending" && !staleSending) return false;
  if (row.status !== "sending" && row.next_attempt_at
    && new Date(row.next_attempt_at).getTime() > Date.now()) return false;
  if (!EMAIL_REGEX.test(String(row.to_email))) {
    await db.from("email_outbox").update({
      status: "failed",
      error: "Adresse e-mail invalide.",
      updated_at: new Date().toISOString(),
    }).eq("id", id).in("status", ["pending", "failed"]);
    return false;
  }

  const attempt = Number(row.attempts ?? 0) + 1;
  const { data: claimed, error: claimError } = await db.from("email_outbox")
    .update({ status: "sending", attempts: attempt, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .select("id").maybeSingle();
  if (claimError || !claimed) return false;

  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    await db.from("email_outbox").update({
      status: "pending",
      error: "RESEND_API_KEY ou MAIL_FROM non configuré.",
      next_attempt_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "sending");
    return false;
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (row.idempotency_key) headers["Idempotency-Key"] = row.idempotency_key;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [row.to_email],
        subject: row.subject,
        text: row.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const result = await response.json().catch(() => ({})) as { id?: string };
      const { error } = await db.from("email_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        error: null,
        next_attempt_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "sending");
      return !error;
    }

    const details = await response.text().catch(() => "");
    const retryDelay = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(attempt - 1, 8));
    await db.from("email_outbox").update({
      status: "failed",
      error: `Resend HTTP ${response.status}: ${details.slice(0, 300)}`,
      next_attempt_at: attempt < 8 ? new Date(Date.now() + retryDelay).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "sending");
    return false;
  } catch (error) {
    const retryDelay = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(attempt - 1, 8));
    await db.from("email_outbox").update({
      status: "failed",
      error: String(error).slice(0, 300),
      next_attempt_at: attempt < 8 ? new Date(Date.now() + retryDelay).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "sending");
    return false;
  }
}

export async function queueEmail(p: QueueEmailInput): Promise<void> {
  const db = supabaseAdmin();
  if (!p.to || !EMAIL_REGEX.test(p.to.trim()) || !p.subject.trim() || !p.body.trim()) return;

  const payload = {
    to_email: p.to.trim().toLowerCase(),
    subject: p.subject.trim().slice(0, 250),
    body: p.body.slice(0, 20_000),
    order_id: p.orderId ?? null,
    idempotency_key: p.idempotencyKey ?? null,
    status: "pending",
  };

  let id: string | null = null;
  if (p.idempotencyKey) {
    const { data, error } = await db.from("email_outbox")
      .upsert(payload, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id").maybeSingle();
    if (error) return;
    id = data?.id ?? null;
    if (!id) {
      const { data: existing } = await db.from("email_outbox")
        .select("id,status").eq("idempotency_key", p.idempotencyKey).maybeSingle();
      if (!existing || existing.status === "sent") return;
      id = existing.id;
    }
  } else {
    const { data, error } = await db.from("email_outbox").insert(payload).select("id").single();
    if (error || !data) return;
    id = data.id;
  }
  if (id) await deliverOutboxEmail(id);
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://assavendo-shop.vercel.app";
}
