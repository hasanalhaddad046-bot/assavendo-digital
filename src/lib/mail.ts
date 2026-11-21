import { supabaseAdmin } from "./supabase";

// File d'envoi d'e-mails : chaque message est enregistré, puis envoyé via Resend si configuré
// (RESEND_API_KEY + MAIL_FROM). Sans configuration, le message reste "pending" et visible en admin.
export async function queueEmail(p: { to: string; subject: string; body: string; orderId?: string }) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("email_outbox")
    .insert({ to_email: p.to, subject: p.subject, body: p.body, order_id: p.orderId ?? null })
    .select("id")
    .single();
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!data || !key || !from) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [p.to], subject: p.subject, text: p.body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", data.id);
    } else {
      await db.from("email_outbox").update({ status: "failed", error: `HTTP ${r.status}` }).eq("id", data.id);
    }
  } catch (e) {
    await db.from("email_outbox").update({ status: "failed", error: String(e).slice(0, 200) }).eq("id", data.id);
  }
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://assavendo-shop.vercel.app";
}
