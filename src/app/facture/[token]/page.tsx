import { notFound } from "next/navigation";
import { supabaseAdmin, getSettings } from "@/lib/supabase";
import { format, toMajor } from "@/lib/money";

export const metadata = { title: "Facture", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Invoice({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("*").eq("public_token", token).maybeSingle();
  if (!o || !o.invoice_number) notFound();
  const { data: items } = await db.from("order_items").select("product_name,qty,unit_usd_minor").eq("order_id", o.id);
  const s = await getSettings();
  const usd = (m: number) => format(toMajor(Number(m), "USD"), "USD");
  const vat = Number(o.vat_usd_minor);
  const a = (o.ship_address ?? {}) as Record<string, string>;
  return (
    <section style={{ padding: "32px 0" }} className="prose">
      <h1>Facture {o.invoice_number}</h1>
      <p>
        <strong>{s.legal_name || "Assavendo Digital"}</strong><br />
        {s.legal_address}<br />{s.tax_id ? `N° fiscal : ${s.tax_id}` : ""}
      </p>
      <p>Date : {new Date(o.paid_at ?? o.created_at).toLocaleDateString("fr-FR")} · Commande n° {o.number}<br />
        Client : {a.name ?? ""} — {a.line1 ?? ""}, {a.city ?? ""} ({o.ship_country})</p>
      <table className="t">
        <thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Total</th></tr></thead>
        <tbody>
          {(items ?? []).map((i, k) => (
            <tr key={k}><td>{i.product_name}</td><td>{i.qty}</td><td>{usd(i.unit_usd_minor)}</td><td>{usd(Number(i.unit_usd_minor) * i.qty)}</td></tr>
          ))}
          <tr><td>Livraison</td><td></td><td></td><td>{usd(o.shipping_usd_minor)}</td></tr>
        </tbody>
      </table>
      <p><strong>Total payé : {usd(o.total_usd_minor)}</strong>{vat > 0 ? ` dont TVA ${s.vat_pct} % : ${usd(vat)}` : " — TVA non applicable (vendeur non assujetti)"}</p>
      <p className="muted noprint">Utilisez la fonction « Imprimer » de votre navigateur pour enregistrer en PDF.</p>
    </section>
  );
}
