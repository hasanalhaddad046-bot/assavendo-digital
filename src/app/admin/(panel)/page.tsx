import { supabaseAdmin, getSettings } from "@/lib/supabase";
import { getFx } from "@/lib/fx";
import { canCharge } from "@/lib/paystack";

export const metadata = { title: "Tableau de bord", robots: { index: false } };

export default async function Dashboard() {
  const db = supabaseAdmin();
  const s = await getSettings();
  const fx = await getFx().catch(() => null);
  const { data: orders } = await db.from("orders").select("status");
  const counts: Record<string, number> = {};
  for (const o of orders ?? []) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const { count: rma } = await db.from("rma_requests").select("id", { count: "exact", head: true }).eq("status", "requested");
  const { count: mail } = await db.from("email_outbox").select("id", { count: "exact", head: true }).neq("status", "sent");
  const { count: pub } = await db.from("products").select("id", { count: "exact", head: true }).eq("status", "published");
  const env = (k: string) => !!process.env[k];
  const checks: [string, boolean, string][] = [
    ["Autorisation Paystack (dropshipping) + preuve", canCharge(s, true), "Paramètres → statut « approved » avec preuve"],
    ["Clé secrète Paystack", env("PAYSTACK_SECRET_KEY"), "Variable PAYSTACK_SECRET_KEY"],
    ["Frais Paystack (%) renseignés", s.paystack_fee_pct !== "", "Paramètres"],
    ["Taux de change frais", !!fx?.fresh, "Cron /api/cron/fx (ou attendre 05:00 UTC)"],
    ["CRON_SECRET", env("CRON_SECRET"), "Variable CRON_SECRET"],
    ["E-mails (Resend)", env("RESEND_API_KEY") && env("MAIL_FROM"), "RESEND_API_KEY + MAIL_FROM"],
    ["Détection VPN (IPQS)", env("IPQS_API_KEY"), "Optionnel : IPQS_API_KEY"],
    ["IA (au moins un fournisseur)", env("ASV_KEY_OPENROUTER") || env("ASV_KEY_GROQ") || env("ASV_KEY_DEEPSEEK"), "Optionnel : clés ASV_KEY_* + ASV_MODEL_*"],
    ["Identité légale renseignée", !!(s.legal_name && s.legal_address && s.support_email), "Paramètres"],
  ];
  return (
    <>
      <h1>Tableau de bord</h1>
      <p>Produits publiés : <strong>{pub ?? 0}</strong> · Retours à traiter : <strong>{rma ?? 0}</strong> · E-mails non envoyés : <strong>{mail ?? 0}</strong></p>
      <h2>Commandes</h2>
      <p>{Object.keys(counts).length ? Object.entries(counts).map(([k, v]) => <span key={k} className="pill" style={{ marginRight: 8 }}>{k} : {v}</span>) : "Aucune commande."}</p>
      <h2>Mise en service</h2>
      <table className="t"><tbody>
        {checks.map(([label, ok, hint]) => (
          <tr key={label}><td>{ok ? "✅" : "⚠️"}</td><td>{label}</td><td className="muted">{ok ? "" : hint}</td></tr>
        ))}
      </tbody></table>
    </>
  );
}
