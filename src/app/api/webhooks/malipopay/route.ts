import { after } from "next/server";
import {
  claimMalipopayWebhook,
  handleMalipopayWebhook,
  isMalipopayWebhookConfigured,
} from "@/lib/malipopay";
import { verifyMalipopayWebhookSignature } from "@/lib/malipopay-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export async function POST(request: Request) {
  if (!isMalipopayWebhookConfigured()) {
    return Response.json({ error: "Webhook MALIPOPAY non configuré." }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload trop volumineux." }, { status: 413 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload trop volumineux." }, { status: 413 });
  }

  const signature = request.headers.get("x-malipopay-signature");
  if (!verifyMalipopayWebhookSignature(raw, signature, process.env.MALIPOPAY_WEBHOOK_SECRET ?? "")) {
    return Response.json({ error: "Signature MALIPOPAY invalide." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "Payload invalide." }, { status: 400 });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  try {
    const eventKey = await claimMalipopayWebhook(payload);
    if (!eventKey) return Response.json({ received: true, duplicateOrIgnored: true }, { status: 200 });

    // The verified event is durably claimed before acknowledgement. Heavy API verification,
    // side effects and emails continue after the fast 2xx response. The scheduled reconciler
    // recovers payments if the post-response task does not complete.
    after(async () => {
      try {
        await handleMalipopayWebhook(payload, eventKey);
      } catch (error) {
        console.error("MALIPOPAY webhook background processing failed", error);
      }
    });
    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("MALIPOPAY webhook could not be durably claimed", error);
    return Response.json({ error: "Webhook non enregistré ; réessayez." }, { status: 500 });
  }
}
