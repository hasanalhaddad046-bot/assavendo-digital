import Link from "next/link";
import { headers } from "next/headers";
import { supabasePublic } from "@/lib/supabase";
import { getFx, usdToLocal, currencyForCountry } from "@/lib/fx";
import { format, toMajor } from "@/lib/money";

export const metadata = { title: "Catalogue" };
export const dynamic = "force-dynamic";

type P = { slug: string; name: string; image_url: string | null; price_usd_minor: number; kind: string; category_id: string | null };

export default async function Catalogue({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; kind?: string }> }) {
  const sp = await searchParams;
  const sb = supabasePublic();
  const { data: cats } = await sb.from("categories").select("id,slug,name,kind").eq("active", true).order("name");
  let q = sb.from("products").select("slug,name,image_url,price_usd_minor,kind,category_id").order("created_at", { ascending: false }).limit(60);
  const term = (sp.q ?? "").replace(/[%_,()]/g, " ").trim().slice(0, 60);
  if (term) q = q.ilike("name", `%${term}%`);
  if (sp.kind && ["physical", "digital", "service"].includes(sp.kind)) q = q.eq("kind", sp.kind);
  const cat = (cats ?? []).find((c) => c.slug === sp.cat);
  if (cat) q = q.eq("category_id", cat.id);
  const { data } = await q;
  const products = (data ?? []) as P[];

  const cur = currencyForCountry((await headers()).get("x-vercel-ip-country"));
  let fx = null;
  try { fx = await getFx(); } catch { /* indicatif */ }

  return (
    <>
      <section className="hero"><h1>Catalogue</h1></section>
      <form method="get" className="row" style={{ marginBottom: 16 }}>
        <input name="q" defaultValue={term} placeholder="Rechercher un produit" aria-label="Recherche" />
        <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Type">
          <option value="">Tous types</option><option value="physical">Produits</option>
          <option value="digital">Numérique</option><option value="service">Services</option>
        </select>
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {(cats ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <button>Filtrer</button>
      </form>
      {products.length === 0 ? <p className="notice">Aucun produit pour cette recherche.</p> : (
        <section className="grid">
          {products.map((p) => {
            const usd = toMajor(Number(p.price_usd_minor), "USD");
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
