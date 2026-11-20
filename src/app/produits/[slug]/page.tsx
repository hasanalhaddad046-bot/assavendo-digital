import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase";
import { getFx, usdToLocal, currencyForCountry } from "@/lib/fx";
import { format, toMajor } from "@/lib/money";
import BuyForm from "./buy-form";

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
      <BuyForm productId={p.id} />
    </article>
  );
}
