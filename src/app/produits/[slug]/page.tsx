import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase";
import { getFx, usdToLocal, currencyForCountry } from "@/lib/fx";
import { format, toMajor } from "@/lib/money";
import { AddToCart } from "@/components/cart";
import { supabaseAdmin } from "@/lib/supabase";

export const revalidate = 300;

async function load(slug: string) {
  const { data } = await supabasePublic()
    .from("products")
    .select("id,slug,name,description,image_url,price_usd_minor,kind,lead_time_days_min,lead_time_days_max")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug).catch(() => null);
  return p ? { title: p.name, description: String(p.description).slice(0, 150) } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await load((await params).slug).catch(() => null);
  if (!p) notFound();

  const usd = toMajor(Number(p.price_usd_minor), "USD");
  const cur = currencyForCountry((await headers()).get("x-vercel-ip-country"));
  let local = null;
  try {
    local = cur !== "USD" ? usdToLocal(await getFx(), usd, cur) : null;
  } catch { /* indicatif */ }

  return (
    <article style={{ padding: "32px 0" }}>
      <h1>{p.name}</h1>
      {p.image_url && <img src={p.image_url} alt={p.name} style={{ maxWidth: "100%", borderRadius: 12 }} />}
      <p className="price" style={{ fontSize: 24 }}>{format(usd, "USD")}</p>
      {local && (
        <p className="muted">
          ≈ {format(local.amount, local.currency)} — estimation convertie ; le montant débité est affiché en USD au paiement.
          Votre banque peut appliquer son propre taux.
        </p>
      )}
      <p>{p.description}</p>
      {p.kind === "physical" && (
        <p className="notice">
          Article commandé auprès d'un partenaire après votre commande
          {p.lead_time_days_min ? ` — délai estimé ${p.lead_time_days_min}–${p.lead_time_days_max} jours` : ""}.
          Les droits et taxes à l'importation éventuels vous sont indiqués avant paiement lorsqu'ils sont connus.
        </p>
      )}
      <DeliveryTable productId={p.id} kind={p.kind} />
      <div className="row"><AddToCart product={{ id: p.id, slug: p.slug, name: p.name, priceMinor: Number(p.price_usd_minor) }} /></div>
    </article>
  );
}

async function DeliveryTable({ productId, kind }: { productId: string; kind: string }) {
  if (kind !== "physical") return <p className="muted">Livraison numérique ou prestation : aucun envoi physique.</p>;
  let rules: { country: string; duty_mode: string; shipping_usd_minor: number; days_min: number | null; days_max: number | null }[] = [];
  try {
    const { data } = await supabaseAdmin().from("delivery_rules").select("country,duty_mode,shipping_usd_minor,days_min,days_max").eq("product_id", productId).order("country");
    rules = (data ?? []) as typeof rules;
  } catch { /* indisponible */ }
  if (rules.length === 0) return <p className="notice">Livraison pas encore ouverte pour cet article.</p>;
  return (
    <table className="t">
      <thead><tr><th>Pays</th><th>Livraison</th><th>Délai</th><th>Droits et taxes</th></tr></thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.country}>
            <td>{r.country}</td>
            <td>{format(toMajor(Number(r.shipping_usd_minor), "USD"), "USD")}</td>
            <td>{r.days_min ? `${r.days_min}–${r.days_max} j` : "—"}</td>
            <td>{r.duty_mode === "DDP" ? "Inclus (DDP)" : "Possiblement à votre charge à la réception (DAP)"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
