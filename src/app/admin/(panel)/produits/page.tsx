import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { createProduct } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Produits", robots: { index: false } };

export default async function Products({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const db = supabaseAdmin();
  const { data: products } = await db.from("products").select("id,name,sku,kind,status,price_usd_minor").order("created_at", { ascending: false }).limit(200);
  const { data: cats } = await db.from("categories").select("id,name,kind").order("name");
  return (
    <>
      <h1>Produits</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form className="buy" action={createProduct}>
        <input name="name" placeholder="Nom du produit" required />
        <input name="sku" placeholder="SKU (optionnel)" />
        <select name="kind" required defaultValue="physical">
          <option value="physical">Produit physique</option><option value="digital">Numérique</option><option value="service">Service</option>
        </select>
        <select name="category_id"><option value="">Catégorie</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select>
        <button>Créer (brouillon)</button>
      </form>
      <table className="t">
        <thead><tr><th>Nom</th><th>SKU</th><th>Type</th><th>Statut</th><th>Prix USD</th></tr></thead>
        <tbody>
          {(products ?? []).map((p) => (
            <tr key={p.id}><td><Link href={`/admin/produits/${p.id}`}>{p.name}</Link></td><td>{p.sku}</td><td>{p.kind}</td><td><span className="pill">{p.status}</span></td><td>{p.price_usd_minor ? (Number(p.price_usd_minor) / 100).toFixed(2) : "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
