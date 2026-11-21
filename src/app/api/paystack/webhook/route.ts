import crypto from "node:crypto";
import { after } from "next/server";
import { handlePaystackEvent, persistWebhookEvent, verifySignature } from "@/lib/paystack";

export const runtime = "nodejs";

type PaystackEvent = {
  event?: string;
  data?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const raw = await req.text();
  const modernSignature = req.headers.get("paystack-signature");
  const legacySignature = req.headers.get("x-paystack-signature");
  const headerName = modernSignature ? "paystack-signature" : "x-paystack-signature";
  const signature = modernSignature ?? legacySignature;
  if (!verifySignature(raw, signature, headerName)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let payload: PaystackEvent;
  try {
    payload = JSON.parse(raw) as PaystackEvent;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!payload.event || typeof payload.event !== "string" || !payload.data) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const eventKey = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  // Persist the raw signed event before acknowledging it. Failed/stale processing
  // remains durable and is retried by /api/cron/process-webhooks.
  try {
    await persistWebhookEvent(eventKey, payload.event, payload as Record<string, unknown>);
  } catch (error) {
    console.error("Could not persist Paystack webhook", error);
    return Response.json({ ok: false }, { status: 503 });
  }

  after(async () => {
    try {
      await handlePaystackEvent(eventKey, payload.event!, payload as Record<string, unknown>);
    } catch (error) {
      console.error("Paystack webhook processing failed", {
        event: payload.event,
        eventKey,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return Response.json({ ok: true, accepted: true });
}
