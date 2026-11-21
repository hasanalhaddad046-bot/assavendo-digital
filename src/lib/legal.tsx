import { getSettings } from "./supabase";

export async function legalIdentity() {
  let s: Record<string, string> = {};
  try { s = await getSettings(); } catch { /* base indisponible */ }
  return {
    name: s.legal_name || "[Raison sociale / nom du vendeur à renseigner]",
    address: s.legal_address || "[Adresse à renseigner]",
    email: s.support_email || "[E-mail de support à renseigner]",
    taxId: s.tax_id || "",
    vat: s.vat_registered === "true" ? `TVA ${s.vat_pct} %` : "TVA non applicable",
  };
}

export function ReviewNotice() {
  return (
    <p className="notice">
      Version de travail rédigée pour Assavendo Digital : elle doit être relue par un conseil juridique local
      (Tanzanie) et des pays de vente avant l'ouverture commerciale.
    </p>
  );
}
