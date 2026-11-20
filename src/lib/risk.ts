// Score de risque explicable et politique VPN graduée (cahier §45).
// Aucun signal seul ne bannit un visiteur.

export type VpnPolicy = "monitor" | "challenge" | "checkout_block" | "strict_site_block";

export interface RiskSignals {
  anonymizer?: boolean;
  anonymizerConfidence?: number; // 0-100
  ipCountry?: string;
  shipCountry?: string;
  paymentAttempts?: number;
  ordersLastHour?: number;
  addressInconsistent?: boolean;
  highValue?: boolean;
}

export interface RiskScore {
  score: number;
  reasons: string[];
  version: 1;
}

export type RiskAction = "allow" | "log" | "challenge" | "manual_review" | "block_checkout" | "block_site";

export function scoreRisk(s: RiskSignals): RiskScore {
  let pts = 0;
  const why: string[] = [];
  if (s.anonymizer) {
    const p = Math.round((10 * (s.anonymizerConfidence ?? 50)) / 100);
    pts += p;
    why.push(`VPN/proxy détecté (+${p})`);
  }
  if (s.ipCountry && s.shipCountry && s.ipCountry !== s.shipCountry) {
    pts += 10;
    why.push("Pays IP différent du pays de livraison (+10)");
  }
  if ((s.paymentAttempts ?? 0) >= 3) {
    pts += 25;
    why.push("Tentatives de paiement répétées (+25)");
  }
  if ((s.ordersLastHour ?? 0) >= 3) {
    pts += 25;
    why.push("Commandes rapprochées (+25)");
  }
  if (s.addressInconsistent) {
    pts += 20;
    why.push("Adresse/téléphone incohérents (+20)");
  }
  if (s.highValue) {
    pts += 10;
    why.push("Commande de valeur élevée (+10)");
  }
  return { score: Math.min(100, pts), reasons: why, version: 1 };
}

export function decideRisk(
  r: RiskScore,
  s: RiskSignals,
  policy: VpnPolicy = "challenge",
): { level: 0 | 1 | 2 | 3 | 4; action: RiskAction } {
  const anonHigh = !!s.anonymizer && (s.anonymizerConfidence ?? 0) >= 80;
  if (policy === "strict_site_block" && anonHigh) return { level: 4, action: "block_site" };
  if (r.score >= 70) {
    const block = policy === "checkout_block" || policy === "strict_site_block";
    return { level: 3, action: block ? "block_checkout" : "manual_review" };
  }
  if (policy === "checkout_block" && anonHigh && r.score >= 40) return { level: 3, action: "block_checkout" };
  if (r.score >= 30 && policy !== "monitor") return { level: 2, action: "challenge" };
  if (s.anonymizer) return { level: 1, action: "log" };
  return { level: 0, action: "allow" };
}
