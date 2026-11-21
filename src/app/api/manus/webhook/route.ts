import { recordManusWebhook, verifyManusWebhook } from "@/lib/manus";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const valid = await verifyManusWebhook({
    rawBody,
    url: req.url,
    signature: req.headers.get("x-webhook-signature"),
    timestamp: req.headers.get("x-webhook-timestamp"),
  });
  if (!valid) return Response.json({ ok: false }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const processed = await recordManusWebhook(payload);
    return Response.json({ ok: true, duplicate: !processed });
  } catch (error) {
    console.error("Manus webhook processing failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ ok: false }, { status: 503 });
  }
}

