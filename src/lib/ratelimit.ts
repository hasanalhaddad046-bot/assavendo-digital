import crypto from "node:crypto";
import { supabaseAdmin } from "./supabase";

/**
 * Distributed, fail-closed request limiter.
 * A database outage must not silently disable abuse protection on checkout,
 * support forms or the public AI endpoint.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabaseAdmin().rpc("consume_rate_limit", {
    p_key_hash: digest,
    p_max_requests: max,
    p_window_seconds: Math.ceil(windowMs / 1000),
  });
  if (error || typeof data !== "boolean") {
    throw new Error("Distributed rate limiter unavailable.");
  }
  return data;
}

export function clientIp(req: Request): string {
  // Prefer Vercel-controlled headers; do not trust arbitrary left-most X-Forwarded-For values.
  const candidates = [
    req.headers.get("x-vercel-forwarded-for"),
    req.headers.get("x-real-ip"),
  ];
  for (const value of candidates) {
    const ip = value?.split(",")[0]?.trim();
    if (ip && ip.length <= 64 && /^[a-f0-9:.]+$/i.test(ip)) return ip;
  }
  return "unknown";
}
