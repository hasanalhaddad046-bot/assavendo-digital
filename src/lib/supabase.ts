import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Client serveur (service_role) : contourne la RLS. Ne jamais importer côté navigateur. */
let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Variables Supabase serveur manquantes.");
    admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return admin;
}

/** Client public (clé anon) : soumis à la RLS, lecture des produits publiés uniquement. */
export function supabasePublic(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Variables Supabase publiques manquantes.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getSettings(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin().from("settings").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
}

export async function audit(action: string, target = "", detail: unknown = null, actor = "system") {
  await supabaseAdmin().from("audit_log").insert({ action, target, detail, actor });
}
