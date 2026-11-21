import { supabaseAdmin } from "@/lib/supabase";
import { getCustomerFromRequest } from "@/lib/customer-auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`account-address:${clientIp(req)}`, 20, 60 * 60_000))) {
      return Response.json({ error: "Trop de demandes." }, { status: 429 });
    }
  } catch {
    return Response.json({ error: "Service indisponible." }, { status: 503 });
  }
  let user;
  try { user = await getCustomerFromRequest(req); } catch { user = null; }
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Données invalides." }, { status: 400 });
  const value = (key: string, max: number) => String(body[key] ?? "").trim().slice(0, max);
  const row = {
    user_id: user.id,
    label: value("label",80) || "Adresse",
    recipient_name: value("recipient_name",160),
    phone: value("phone",40),
    country: value("country",2).toUpperCase(),
    region: value("region",120),
    district: value("district",120),
    city: value("city",120),
    line1: value("line1",240),
    line2: value("line2",240) || null,
    landmark: value("landmark",240) || null,
    postal_code: value("postal_code",32) || null,
    is_default: body.is_default === true,
  };
  if (!row.recipient_name || !row.phone || !/^[A-Z]{2}$/.test(row.country)
    || !row.region || !row.district || !row.city || !row.line1) {
    return Response.json({ error: "Destinataire, téléphone, pays, région, district, ville et adresse sont obligatoires." }, { status: 422 });
  }
  const db = supabaseAdmin();
  if (row.is_default) {
    const { error } = await db.from("customer_addresses").update({ is_default: false }).eq("user_id", user.id);
    if (error) return Response.json({ error: "Impossible de mettre à jour l'adresse par défaut." }, { status: 500 });
  }
  const { data, error } = await db.from("customer_addresses").insert(row).select("id").single();
  if (error || !data) return Response.json({ error: "Enregistrement de l'adresse impossible." }, { status: 500 });
  return Response.json({ ok: true, id: data.id });
}

export async function DELETE(req: Request) {
  let user;
  try { user = await getCustomerFromRequest(req); } catch { user = null; }
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Adresse introuvable." }, { status: 404 });
  const { error } = await supabaseAdmin().from("customer_addresses").delete().eq("id", id).eq("user_id", user.id);
  if (error) return Response.json({ error: "Suppression impossible." }, { status: 500 });
  return Response.json({ ok: true });
}
