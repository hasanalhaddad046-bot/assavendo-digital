import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

export async function getCustomerFromRequest(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 4096) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const authClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const db = supabaseAdmin();
  const { error: profileError } = await db.from("customer_profiles").upsert({
    user_id: data.user.id,
    full_name: String(data.user.user_metadata?.full_name ?? "").slice(0, 160),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id", ignoreDuplicates: true });
  if (profileError) throw new Error("Profil client non disponible.");
  return { id: data.user.id, email: data.user.email };
}
