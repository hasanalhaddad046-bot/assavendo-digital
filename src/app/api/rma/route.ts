import { supabaseAdmin, audit } from "@/lib/supabase";
import { queueEmail } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Demande de retour / échange / colis endommagé ou perdu. Identification : numéro de commande + e-mail.
export async function POST(req: Request) {
  if (!rateLimit(`rma:${clientIp(req)}`, 5, 3600_000)) return Response.json({ error: "Trop de demandes." }, { status: 429 });
  const b = (await req.json().catch(() => null)) as
    | { number?: number | string; email?: string; kind?: string; reason?: string; itemId?: string }
    | null;
  const kinds = ["return", "exchange", "damaged", "lost"];
  const number = Number(b?.number);
  if (!b || !Number.isInteger(number) || !b.email || !kinds.includes(b.kind ?? "") || !(b.reason ?? "").trim()) {
    return Response.json({ error: "Données invalides." }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("id,email,status").eq("number", number).maybeSingle();
  // Réponse identique si la commande n'existe pas ou si l'e-mail diffère (pas d'énumération).
  if (!order || order.email.toLowerCase() !== b.email.trim().toLowerCase() || !["paid_verified", "processing", "shipped", "delivered"].includes(order.status)) {
    return Response.json({ error: "Commande introuvable ou non éligible. Vérifiez le numéro et l'e-mail." }, { status: 404 });
  }
  const { data: rma, error } = await db
    .from("rma_requests")
    .insert({ order_id: order.id, order_item_id: b.itemId || null, kind: b.kind, reason: b.reason.trim().slice(0, 2000) })
    .select("id")
    .single();
  if (error || !rma) return Response.json({ error: "Enregistrement impossible." }, { status: 500 });
  await db.from("order_events").insert({ order_id: order.id, kind: "rma", message: "Demande de retour/assistance reçue." });
  await audit("rma_created", rma.id, { order: number });
  await queueEmail({
    to: order.email, orderId: order.id,
    subject: "Assavendo Digital — demande reçue",
    body: "Nous avons bien reçu votre demande de retour/assistance. Nous la traitons et revenons vers vous. Vous n'avez rien à faire auprès du fournisseur.",
  });
  return Response.json({ ok: true });
}
