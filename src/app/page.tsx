import Link from "next/link";
import { headers } from "next/headers";
import { supabasePublic } from "@/lib/supabase";
import { getFx, usdToLocal, currencyForCountry } from "@/lib/fx";
import { format, toMajor } from "@/lib/money";

export const revalidate = 300;

export default async function Home() {
  let products: { slug: string; name: string; image_url: string | null; price_usd_minor: number; kind: string }[] = [];
  try {
    const { data } = await supabasePublic()
      .from("products")
      .select("slug,name,image_url,price_usd_minor,kind")
      .order("created_at", { ascending: false })
      .limit(24);
    products = (data ?? []) as typeof products;
  } catch {
    /* base non configurée : page vide plutôt qu'erreur */
  }

  const country = (await headers()).get("x-vercel-ip-country");
  const cur = currencyForCountry(country);
  let fx = null;
  try { fx = await getFx(); } catch { /* conversion indicative seulement */ }

  return (
    <>
      <section className="hero">
        <h1>Des produits, des solutions numériques et des services, livrés chez vous.</h1>
        <p>Prix clairs, paiement sécurisé, suivi de commande. Nous indiquons toujours si un article est commandé auprès d'un partenaire.</p>
      </section>
      {products.length === 0 ? (
        <p className="notice">Le catalogue est en cours de préparation.</p>
      ) : (
        <section className="grid">
          {products.map((p) => {
            const usd = toMajor(p.price_usd_minor, "USD");
            const local = cur !== "USD" ? usdToLocal(fx, usd, cur) : null;
            return (
              <Link key={p.slug} href={`/produits/${p.slug}`} className="card">
                {p.image_url ? <img className="img" src={p.image_url} alt={p.name} loading="lazy" /> : <div className="img" />}
                <div className="body">
                  <div>{p.name}</div>
                  <div className="price">{format(usd, "USD")}</div>
                  {local && <div className="muted">≈ {format(local.amount, local.currency)} (estimation)</div>}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </>
  );
}
