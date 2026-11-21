import crypto from "node:crypto";
import { supabaseAdmin } from "./supabase";

const API = "https://api.manus.ai";

function apiKey(): string {
  return process.env.MANUS_API_KEY ?? "";
}

async function manusRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("MANUS_API_KEY non configurée.");
  const response = await fetch(API + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-manus-api-key": key,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || `Manus API HTTP ${response.status}`);
  }
  return payload as T;
}

export interface ManusTask {
  task_id: string;
  task_title?: string;
  task_url?: string;
  request_id?: string;
  share_url?: string;
}

export async function createManusTask(input: {
  title: string;
  prompt: string;
  agentProfile?: "standard" | "lite" | "max" | "max-medium" | "max-high" | "max-extra" | "max-ultra";
  clearConnectors?: boolean;
  structuredOutputSchema?: Record<string, unknown>;
}): Promise<ManusTask> {
  const title = input.title.trim().slice(0, 160);
  const prompt = input.prompt.trim();
  if (!title || !prompt || prompt.length > 24_000) throw new Error("Titre ou consigne Manus invalide.");
  const result = await manusRequest<{ ok: boolean } & ManusTask>("/v2/task.create", {
    method: "POST",
    body: JSON.stringify({
      title,
      message: { content: [{ type: "text", text: prompt, visibility: "visible" }] },
      agent_profile: input.agentProfile ?? "standard",
      clear_connectors: input.clearConnectors ?? true,
      ...(input.structuredOutputSchema ? { structured_output_schema: input.structuredOutputSchema } : {}),
    }),
  });
  if (!result.ok || !result.task_id) throw new Error("Manus n'a pas retourné d'identifiant de tâche.");
  return result;
}

export async function sendManusMessage(taskId: string, message: string): Promise<{ request_id?: string; task_id: string }> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(taskId) || !message.trim() || message.length > 24_000) {
    throw new Error("Tâche Manus ou message invalide.");
  }
  const result = await manusRequest<{ ok: boolean; request_id?: string; task_id: string }>("/v2/task.sendMessage", {
    method: "POST",
    body: JSON.stringify({
      task_id: taskId,
      message: { content: [{ type: "text", text: message.trim(), visibility: "visible" }] },
    }),
  });
  if (!result.ok || !result.task_id) throw new Error("Manus n'a pas accepté le message.");
  return result;
}

export async function listManusMessages(taskId: string, limit = 20): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(taskId)) throw new Error("Identifiant de tâche Manus invalide.");
  const query = new URLSearchParams({ task_id: taskId, order: "desc", limit: String(Math.min(50, Math.max(1, Math.floor(limit)))) });
  return manusRequest<unknown>(`/v2/task.listMessages?${query.toString()}`, { method: "GET" });
}

let cachedPublicKey: { pem: string; expiresAt: number } | null = null;

async function getWebhookPublicKey(): Promise<string | null> {
  const configured = process.env.MANUS_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n").trim();
  if (configured?.includes("BEGIN PUBLIC KEY")) return configured;
  if (cachedPublicKey && cachedPublicKey.expiresAt > Date.now()) return cachedPublicKey.pem;
  try {
    const result = await manusRequest<{ ok: boolean; public_key?: string }>("/v2/webhook.publicKey", { method: "GET" });
    if (!result.ok || !result.public_key?.includes("BEGIN PUBLIC KEY")) return null;
    cachedPublicKey = { pem: result.public_key, expiresAt: Date.now() + 60 * 60_000 };
    return result.public_key;
  } catch {
    return null;
  }
}

export async function verifyManusWebhook(input: {
  rawBody: string;
  url: string;
  signature: string | null;
  timestamp: string | null;
}): Promise<boolean> {
  const { rawBody, url, signature, timestamp } = input;
  if (!signature || !timestamp || !/^\d{10}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) return false;
  const publicKey = await getWebhookPublicKey();
  if (!publicKey) return false;
  const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  const signedContent = `${timestamp}.${url}.${bodyHash}`;
  try {
    return crypto.verify(
      "RSA-SHA256",
      Buffer.from(signedContent, "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export async function recordManusWebhook(payload: Record<string, unknown>): Promise<boolean> {
  const eventId = String(payload.event_id ?? "");
  const eventType = String(payload.event_type ?? "");
  const detail = payload.task_detail && typeof payload.task_detail === "object"
    ? payload.task_detail as Record<string, unknown>
    : {};
  const taskId = String(detail.task_id ?? "");
  if (!eventId || !eventType || !taskId) throw new Error("Webhook Manus incomplet.");

  const db = supabaseAdmin();
  const { error: insertError } = await db.from("manus_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    task_id: taskId,
    payload,
    status: "received",
  });
  if (insertError?.code === "23505") return false;
  if (insertError) throw new Error(`Webhook Manus non enregistré: ${insertError.message}`);

  const update: Record<string, unknown> = {
    provider_status: eventType,
    last_event_at: new Date().toISOString(),
    provider_task_url: typeof detail.task_url === "string" ? detail.task_url : null,
  };
  if (eventType === "task_created") {
    update.status = "running";
  } else if (eventType === "task_stopped") {
    const stopReason = String(detail.stop_reason ?? "");
    update.status = stopReason === "finish" ? "succeeded" : "awaiting_approval";
    update.result_text = typeof detail.message === "string" ? detail.message.slice(0, 40_000) : null;
    update.result_json = detail.structured_output ?? null;
  }

  const { error: updateError } = await db.from("ai_tool_runs")
    .update(update).eq("provider", "manus").eq("provider_task_id", taskId);
  if (updateError) {
    await db.from("manus_webhook_events").update({
      status: "failed",
      last_error: updateError.message.slice(0, 1000),
    }).eq("event_id", eventId);
    throw new Error(`Tâche Manus non mise à jour: ${updateError.message}`);
  }
  await db.from("manus_webhook_events").update({
    status: "processed",
    processed_at: new Date().toISOString(),
  }).eq("event_id", eventId);
  return true;
}

