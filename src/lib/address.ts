// Validation d'adresse de base : cohérence pays/téléphone, formats de code postal connus.
const DIAL: Record<string, string> = {
  TZ: "255", KE: "254", UG: "256", RW: "250", US: "1", CA: "1", GB: "44", NG: "234", ZA: "27", GH: "233",
  AE: "971", SA: "966", IN: "91", CN: "86", JP: "81", CH: "41", FR: "33", DE: "49", ES: "34", IT: "39",
  NL: "31", BE: "32", PT: "351", IE: "353", AT: "43", AU: "61",
};
const POSTAL: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/, GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, FR: /^\d{5}$/, DE: /^\d{5}$/,
  ES: /^\d{5}$/, IT: /^\d{5}$/, NL: /^\d{4} ?[A-Z]{2}$/i, CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
};

export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

/** Retourne un message d'erreur, ou null si l'adresse semble cohérente. */
export function validateAddress(country: string, phone: string, postal?: string): string | null {
  const c = country.toUpperCase();
  const p = normalizePhone(phone);
  if (!/^\+\d{8,15}$/.test(p)) return "Téléphone invalide : utilisez le format international, ex. +255712345678.";
  const dial = DIAL[c];
  if (dial && !p.startsWith("+" + dial)) return `Le téléphone doit commencer par +${dial} pour ce pays.`;
  const re = POSTAL[c];
  if (re && !(postal && re.test(postal.trim()))) return "Code postal invalide pour ce pays.";
  return null;
}
