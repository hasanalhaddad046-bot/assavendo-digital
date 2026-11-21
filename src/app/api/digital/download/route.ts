import { supabaseAdmin } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderToken = url.searchParams.get("order") ?? "";
  const deliveryId = url.searchParams.get("delivery") ?? "";

  if (!/^[a-f0-9]{32}$/.test(orderToken) || !/^[0-9a-f-]{36}$/i.test(deliveryId)) {
    return Response.json({ error: "Lien de téléchargement invalide ou expiré." }, { status: 404 });
  }

  try {
    if (!(await rateLimit(`digital-download:${clientIp(req)}`, 30, 60 * 60_000))) {
      return Response.json({ error: "Trop de tentatives de téléchargement." }, { status: 429 });
    }
  } catch {
    return Response.json({ error: "Le contrôle de sécurité est temporairement indisponible." }, { status: 503 });
  }

  const db = supabaseAdmin();
  const { data: asset, error } = await db.rpc("consume_digital_delivery", {
    p_order_token: orderToken,
    p_delivery_id: deliveryId,
  });
  if (error || !asset || typeof asset !== "object") {
    return Response.json({ error: "Le lien de téléchargement n'est pas disponible. Vérifiez le paiement, les droits et la période d'accès." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const item = asset as Record<string, unknown>;
  const bucket = String(item.bucket ?? "");
  const path = String(item.path ?? "");
  const fileName = String(item.file_name ?? "download");
  if (!bucket || !path || bucket !== "digital-assets") {
    return Response.json({ error: "Le fichier protégé est introuvable." }, { status: 404 });
  }

  const { data: signed, error: signedError } = await db.storage
    .from(bucket)
    .createSignedUrl(path, 90, { download: fileName });
  if (signedError || !signed?.signedUrl) {
    return Response.json({ error: "Le téléchargement est temporairement indisponible. Contactez le support." }, { status: 503 });
  }

  return Response.redirect(signed.signedUrl, 302);
}

