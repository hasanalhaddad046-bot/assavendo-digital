import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase";
import { format, toMajor } from "@/lib/money";
import { AddToCart, type CartVariant } from "@/components/cart";

export const revalidate = 300;

async function load(slug: string) {
  const db = supabasePublic();
  const { data } = await db.from("products")
    .select("id,slug,name,brand,description,image_url,price_usd_minor,kind,lead_time_days_min,lead_time_days_max,features,package_contents,warranty_terms")
    .eq("slug", slug).eq("status", "published").maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = await load((await params).slug).catch(() => null);
  return product ? {
    title: product.name,
    description: String(product.description).slice(0, 155),
    openGraph: { title: product.name, description: String(product.description).slice(0, 155), images: product.image_url ? [product.image_url] : [] },
  } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = await load((await params).slug).catch(() => null);
  if (!product) notFound();

  const { data: variants } = product.kind === "physical"
    ? await supabasePublic().from("public_product_variants")
        .select("id,name,attributes,price_usd_minor,sort_order")
        .eq("product_id", product.id).order("sort_order").order("name")
    : { data: [] };

  const cartVariants: CartVariant[] = (variants ?? []).map((variant) => ({
    id: variant.id,
    name: variant.name,
    priceMinor: variant.price_usd_minor === null ? null : Number(variant.price_usd_minor),
  }));
  const activePrices = cartVariants.map((variant) => variant.priceMinor)
    .filter((price): price is number => price !== null && price > 0);
  const lowestPriceMinor = activePrices.length
    ? Math.min(...activePrices)
    : Number(product.price_usd_minor ?? 0);
  const priceLabel = cartVariants.length && activePrices.length
    ? `À partir de ${format(toMajor(lowestPriceMinor, "USD"), "USD")}`
    : format(toMajor(lowestPriceMinor, "USD"), "USD");

  const features = product.features && typeof product.features === "object" && !Array.isArray(product.features)
    ? Object.entries(product.features as Record<string, unknown>)
    : [];

  return (
    <article style={{ padding: "32px 0" }}>
      <h1>{product.name}</h1>
      {product.brand && <p className="muted">{product.brand}</p>}
      {product.image_url && <img src={product.image_url} alt={product.name} style={{ maxWidth: "100%", borderRadius: 12 }} />}
      <p className="price" style={{ fontSize: 24 }}>{priceLabel}</p>
      <p className="muted">Prix de vente affiché en USD. La devise d'affichage locale se choisit manuellement dans le panier ; le montant d'encaissement dépend des devises réellement activées par le prestataire.</p>
      <p>{product.description}</p>

      {features.length > 0 && (
        <>
          <h2>Caractéristiques</h2>
          <dl>
            {features.map(([key, value]) => <div key={key}><dt><strong>{key}</strong></dt><dd>{String(value)}</dd></div>)}
          </dl>
        </>
      )}
      {product.package_contents && <p><strong>Contenu du colis :</strong> {product.package_contents}</p>}
      {product.warranty_terms && <p><strong>Garantie :</strong> {product.warranty_terms}</p>}
      {product.kind === "physical" && (
        <p className="muted">
          Délai fournisseur indicatif : {product.lead_time_days_min ?? "—"}–{product.lead_time_days_max ?? "—"} jours, hors transport international, douane et distribution finale.
        </p>
      )}
      {cartVariants.length > 0 && (
        <section>
          <h2>Choix de la variante</h2>
          <p className="muted">Chaque variante possède son propre prix et sa propre offre source lorsqu'elle est configurée.</p>
        </section>
      )}
      <AddToCart product={{
        id: product.id,
        slug: product.slug,
        name: product.name,
        priceMinor: Number(product.price_usd_minor ?? 0),
      }} variants={cartVariants} />
    </article>
  );
}
