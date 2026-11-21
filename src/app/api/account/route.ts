import { supabaseAdmin } from "@/lib/supabase";
import { getCustomerFromRequest } from "@/lib/customer-auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function auth(req: Request) {
  try {
    if (!(await rateLimit(`account:${clientIp(req)}`, 60, 60 * 60_000))) return { error: 429 as const };
  } catch {
    return { error: 503 as const };
  }
  try {
    const user = await getCustomerFromRequest(req);
    return user ? { user } : { error: 401 as const };
  } catch {
    return { error: 503 as const };
  }
}

export async function GET(req: Request) {
  const result = await auth(req);
  if ("error" in result) return Response.json({ error: "Authentification requise ou service indisponible." }, { status: result.error });
  const db = supabaseAdmin();
  const [{ data: profile }, { data: addresses }, { data: orders }] = await Promise.all([
    db.from("customer_profiles").select("full_name,phone,preferred_language,preferred_country,preferred_currency,marketing_consent_at")
      .eq("user_id", result.user.id).maybeSingle(),
    db.from("customer_addresses").select("id,label,recipient_name,phone,country,region,district,city,line1,line2,landmark,postal_code,is_default,created_at")
      .eq("user_id", result.user.id).order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    db.from("orders").select("id,number,status,total_usd_minor,display_currency,ship_country,created_at,public_token,invoice_number")
      .eq("user_id", result.user.id).order("created_at", { ascending: false }).limit(50),
  ]);
  return Response.json({
    email: result.user.email,
    profile: profile ?? {},
    addresses: addresses ?? [],
    orders: (orders ?? []).map((order) => ({
      id: order.id, number: order.number, status: order.status,
      total_usd_minor: order.total_usd_minor, display_currency: order.display_currency,
      ship_country: order.ship_country, created_at: order.created_at,
      tracking_url: `/suivi/${order.public_token}`,
      invoice_url: `/facture/${order.public_token}`,
      invoice_number: order.invoice_number,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const result = await auth(req);
  if ("error" in result) return Response.json({ error: "Authentification requise ou service indisponible." }, { status: result.error });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Données invalides." }, { status: 400 });
  const fullName = String(body.full_name ?? "").trim().slice(0, 160);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const language = String(body.preferred_language ?? "fr").toLowerCase();
  const country = String(body.preferred_country ?? "").toUpperCase();
  const currency = String(body.preferred_currency ?? "USD").toUpperCase();
  if (!fullName || !["fr","en","sw"].includes(language)
    || (country && !/^[A-Z]{2}$/.test(country)) || !/^[A-Z]{3}$/.test(currency)) {
    return Response.json({ error: "Profil invalide." }, { status: 422 });
  }
  const { error } = await supabaseAdmin().from("customer_profiles").upsert({
    user_id: result.user.id, full_name: fullName, phone: phone || null,
    preferred_language: language, preferred_country: country || null,
    preferred_currency: currency, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return Response.json({ error: "Enregistrement du profil impossible." }, { status: 500 });
  return Response.json({ ok: true });
}
