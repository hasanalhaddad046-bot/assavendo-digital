// Limiteur simple en mémoire (par instance serverless) : frein de base contre les abus.
// La protection complète doit être complétée par les règles du pare-feu Vercel.
const hits = new Map<string, { n: number; t: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    if (hits.size > 5000) hits.clear();
    return true;
  }
  h.n += 1;
  return h.n <= max;
}
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
