import { after } from "next/server";
import { registerWebhookEvent, verifySignature, processVerifiedPayment } from "@/lib/paystack";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Corps BRUT obligatoire pour la signature.
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-paystack-signature"))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let ev: { event?: string; data?: { id?: number | string; reference?: string } };
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!ev.event) return Response.json({ ok: false }, { status: 400 });

  const ref = ev.data?.reference ?? "";
  const key = `${ev.event}:${ev.data?.id ?? ref}`;
  const isNew = await registerWebhookEvent(key, ev.event);
  if (!isNew) return Response.json({ ok: true, duplicate: true });

  if (ev.event === "charge.success" && ref) {
    // Réponse rapide ; vérification API en arrière-plan.
    after(() => processVerifiedPayment(ref));
  }
  return Response.json({ ok: true });
}
