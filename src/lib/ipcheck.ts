// Détection VPN/proxy optionnelle via IPQualityScore (IPQS_API_KEY). Sans clé : aucun signal, aucun blocage.
export async function checkAnonymizer(ip: string | null): Promise<{ anonymizer: boolean; confidence: number } | null> {
  const key = process.env.IPQS_API_KEY;
  if (!key || !ip) return null;
  try {
    const r = await fetch(
      `https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}?strictness=1`,
      { signal: AbortSignal.timeout(3_000), cache: "no-store" },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { vpn?: boolean; proxy?: boolean; tor?: boolean; fraud_score?: number };
    const anon = !!(j.vpn || j.proxy || j.tor);
    return { anonymizer: anon, confidence: anon ? Math.max(50, Math.min(100, j.fraud_score ?? 60)) : 0 };
  } catch {
    return null; // panne du fournisseur : jamais de blocage
  }
}
