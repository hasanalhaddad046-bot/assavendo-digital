import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "./supabase";

const COOKIE = "asv_admin";
const TTL_MS = 8 * 3600 * 1000;

import { hasPermission } from "./admin-permissions";
import type { AdminRole, AdminPermission } from "./admin-permissions";
export type { AdminRole, AdminPermission } from "./admin-permissions";
export { hasPermission, permissionsForRole } from "./admin-permissions";

export interface AdminIdentity {
  id: string;
  email: string | null;
  displayName: string;
  role: AdminRole;
  source: "legacy_owner" | "supabase_auth";
}

function secret(): string {
  const value = process.env.ADMIN_SESSION_SECRET ?? "";
  if (value.length < 32) throw new Error("ADMIN_SESSION_SECRET manquant ou trop court.");
  return value;
}
function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}
function safeEqual(a: string,b: string): boolean {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left,right);
}

export function adminConfigured(): boolean {
  return (process.env.ADMIN_PASSWORD ?? "").length >= 12
    && (process.env.ADMIN_SESSION_SECRET ?? "").length >= 32;
}
export function checkPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return password.length >= 12 && safeEqual(input,password);
}
export async function startSession(): Promise<void> {
  const exp = String(Date.now()+TTL_MS);
  const jar = await cookies();
  jar.set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly:true,secure:true,sameSite:"strict",path:"/admin",maxAge:TTL_MS/1000,
  });
}
export async function endSession(): Promise<void> {
  (await cookies()).delete({name:COOKIE,path:"/admin"});
  try { await (await createAdminServerClient()).auth.signOut(); } catch {}
}

async function hasLegacySession(): Promise<boolean> {
  try {
    const value = (await cookies()).get(COOKIE)?.value;
    if (!value) return false;
    const [exp,mac] = value.split(".");
    if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp)<Date.now()) return false;
    return safeEqual(mac,sign(exp));
  } catch { return false; }
}

/** Request-scoped Supabase Auth client; tokens are held in secure HTTP-only cookies. */
export async function createAdminServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configuration Supabase Auth absente.");
  const jar = await cookies();
  return createServerClient(url,key,{
    cookies:{
      getAll(){ return jar.getAll(); },
      setAll(values){
        try { values.forEach(({name,value,options})=>jar.set(name,value,options)); }
        catch { /* Server Components are read-only; middleware refreshes the cookies. */ }
      },
    },
  });
}

export async function currentAdmin(): Promise<AdminIdentity | null> {
  if (await hasLegacySession()) {
    return {id:"legacy-owner",email:null,displayName:"Propriétaire (session historique)",role:"owner",source:"legacy_owner"};
  }
  try {
    const auth = await createAdminServerClient();
    const {data:{user},error} = await auth.auth.getUser();
    if (error || !user?.email) return null;
    const {data:member,error:memberError} = await supabaseAdmin().from("admin_members")
      .select("user_id,email,display_name,role,active")
      .eq("user_id",user.id).maybeSingle();
    if (memberError || !member || !member.active || member.email.toLowerCase()!==user.email.toLowerCase()) return null;
    return {
      id:user.id,email:user.email,displayName:member.display_name || user.email,
      role:member.role as AdminRole,source:"supabase_auth",
    };
  } catch { return null; }
}

export async function requireAdmin(permission: AdminPermission = "dashboard:read"): Promise<AdminIdentity> {
  const identity = await currentAdmin();
  if (!identity) redirect("/admin/login");
  if (!hasPermission(identity.role,permission)) redirect("/admin/interdit");
  return identity;
}
