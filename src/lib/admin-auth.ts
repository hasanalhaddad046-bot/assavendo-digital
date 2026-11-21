import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Session admin : cookie HttpOnly signé (HMAC-SHA256), durée 8 h.
// Variables : ADMIN_PASSWORD (mot de passe long) et ADMIN_SESSION_SECRET (>= 32 caractères).
const COOKIE = "asv_admin";
const TTL_MS = 8 * 3600 * 1000;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET ?? "";
  if (s.length < 32) throw new Error("ADMIN_SESSION_SECRET manquant ou trop court (32 caractères minimum).");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

export function adminConfigured(): boolean {
  return (process.env.ADMIN_PASSWORD ?? "").length >= 12 && (process.env.ADMIN_SESSION_SECRET ?? "").length >= 32;
}

export function checkPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  return pw.length >= 12 && safeEqual(input, pw);
}

export async function startSession(): Promise<void> {
  const exp = String(Date.now() + TTL_MS);
  const jar = await cookies();
  jar.set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/admin",
    maxAge: TTL_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
}

export async function isAdmin(): Promise<boolean> {
  try {
    const v = (await cookies()).get(COOKIE)?.value;
    if (!v) return false;
    const [exp, mac] = v.split(".");
    if (!exp || !mac || Number(exp) < Date.now()) return false;
    return safeEqual(mac, sign(exp));
  } catch {
    return false;
  }
}

/** À appeler en tête de chaque page et de chaque action admin. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
