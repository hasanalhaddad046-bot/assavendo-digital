import { getSettings } from "@/lib/supabase";
import { saveSettings } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Paramètres", robots: { index: false } };

const FIELDS: [string, string, string][] = [
  ["paystack_dropshipping_status", "Autorisation Paystack dropshipping", "not_requested | requested | approved | refused"],
  ["paystack_approval_proof", "Preuve de l'autorisation écrite (référence, lien)", "Obligatoire pour « approved »"],
  ["paystack_currencies", "Devises activées sur Paystack", "ex. USD,KES"],
  ["paystack_fee_pct", "Frais Paystack (%) — voir votre contrat", "Obligatoire pour calculer un prix"],
  ["payment_fee_fixed_usd", "Frais fixes par transaction (USD)", ""],
  ["returns_reserve_pct", "Provision retours (%)", ""],
  ["target_margin_pct", "Marge cible (% du prix de vente)", ""],
  ["min_profit_usd", "Bénéfice minimum par article (USD)", ""],
  ["fx_stale_after_hours", "Péremption des taux (heures)", ""],
  ["fx_display_margin_pct", "Marge d'affichage de change (%)", ""],
  ["vpn_policy", "Politique VPN", "monitor | challenge | checkout_block | strict_site_block"],
  ["vat_registered", "Assujetti à la TVA ?", "true | false"],
  ["vat_pct", "Taux de TVA (%)", ""],
  ["legal_name", "Raison sociale / nom du vendeur", ""],
  ["legal_address", "Adresse légale", ""],
  ["support_email", "E-mail de support", ""],
  ["tax_id", "Numéro fiscal (TIN)", ""],
  ["retention_days", "Conservation des données personnelles (jours, min. 365)", ""],
];

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings();
  return (
    <>
      <h1>Paramètres</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form className="buy" action={saveSettings}>
        {FIELDS.map(([k, label, hint]) => (
          <label key={k}>{label}<br /><input name={k} defaultValue={s[k] ?? ""} style={{ width: "100%" }} />{hint && <span className="muted">{hint}</span>}</label>
        ))}
        <button>Enregistrer</button>
      </form>
    </>
  );
}
