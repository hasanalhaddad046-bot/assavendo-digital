import Link from "next/link";
import { headers } from "next/headers";
import { supabasePublic } from "@/lib/supabase";
import { getFx, usdToLocal, currencyForCountry } from "@/lib/fx";
import { format, toMajor } from "@/lib/money";

export const revalidate = 300;

type Product = {
  slug: string;
  name: string;
  image_url: string | null;
  price_usd_minor: number;
  kind: string;
};

const universes = [
  {
    number: "01",
    kind: "physical",
    eyebrow: "LE MONDE DU QUOTIDIEN",
    title: "Produits physiques",
    description: "Des articles utiles et soigneusement présentés, commandés auprès de partenaires lorsque vous passez commande.",
    label: "Explorer les produits",
    visual: "universe-physical",
    icon: "cube",
  },
  {
    number: "02",
    kind: "digital",
    eyebrow: "VOTRE ESPACE NUMÉRIQUE",
    title: "Solutions numériques",
    description: "Des ressources et outils digitaux, accessibles en ligne selon les conditions propres à chaque offre.",
    label: "Explorer le numérique",
    visual: "universe-digital",
    icon: "spark",
  },
  {
    number: "03",
    kind: "service",
    eyebrow: "LE SAVOIR-FAIRE À VOTRE SERVICE",
    title: "Services Internet",
    description: "Un accompagnement à distance avec un périmètre, un délai et des livrables définis à l’avance.",
    label: "Découvrir les services",
    visual: "universe-services",
    icon: "orbit",
  },
] as const;

function UniverseIcon({ icon }: { icon: string }) {
  if (icon === "cube") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="m24 5 17 9.5v19L24 43 7 33.5v-19L24 5Z" />
        <path d="m7.5 14.5 16.5 9 16.5-9M24 24v19M15.5 10l17 9.5" />
      </svg>
    );
  }
  if (icon === "spark") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 4.5 29 18l13.5 6-13.5 5L24 42.5 19 29 5.5 24 19 18l5-13.5Z" />
        <path d="m37 4 1.8 5.2L44 11l-5.2 1.8L37 18l-1.8-5.2L30 11l5.2-1.8L37 4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="17.5" />
      <circle cx="24" cy="24" r="7" />
      <path d="M24 2.5v8M24 37.5v8M2.5 24h8M37.5 24h8M8.8 8.8l5.7 5.7M33.5 33.5l5.7 5.7" />
    </svg>
  );
}

export default async function Home() {
  let products: Product[] = [];
  try {
    const { data } = await supabasePublic()
      .from("products")
      .select("slug,name,image_url,price_usd_minor,kind")
      .order("created_at", { ascending: false })
      .limit(4);
    products = (data ?? []) as Product[];
  } catch {
    // La vitrine reste accessible même lorsque le catalogue n'est pas encore configuré.
  }

  const country = (await headers()).get("x-vercel-ip-country");
  const currency = currencyForCountry(country);
  let fx = null;
  if (products.length > 0 && currency !== "USD") {
    try {
      fx = await getFx();
    } catch {
      // La conversion locale reste facultative.
    }
  }

  return (
    <div className="home">
      <section className="home-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> ASSAVENDO DIGITAL <span className="eyebrow-separator">/</span> SHOP &amp; SERVICES</div>
          <h1>Le quotidien,<br /><em>en mieux.</em></h1>
          <p className="hero-lead">
            Produits physiques, solutions numériques et services Internet — réunis dans une expérience claire, soignée et pensée pour vous accompagner.
          </p>
          <div className="hero-actions">
            <Link href="/produits" className="button button-primary">Explorer la boutique <span aria-hidden="true">↗</span></Link>
            <Link href="/suivi" className="button button-quiet">Suivre une commande <span aria-hidden="true">→</span></Link>
          </div>
          <div className="hero-signature">
            <span className="signature-mark">A</span>
            <span>Une expérience plus simple.<br /><strong>Un suivi plus transparent.</strong></span>
          </div>
        </div>

        <div className="hero-art" aria-label="Composition graphique de l'identité Assavendo Digital">
          <div className="art-topline"><span>ASSAVENDO</span><span>EST. DIGITAL</span></div>
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-sun" />
          <div className="art-core"><span>A</span><small>DISCOVER<br />MORE</small></div>
          <div className="art-caption art-caption-top"><span className="caption-dot" /> THREE WORLDS<br /><strong>ONE EXPERIENCE</strong></div>
          <div className="art-caption art-caption-bottom"><span>01 — 03</span><strong>PHYSICAL · DIGITAL · SERVICES</strong></div>
          <div className="art-index">A<span>/</span>D</div>
          <div className="art-stamp">AD<br /><small>CURATED<br />WITH CARE</small></div>
        </div>
      </section>

      <section className="universe-section" id="univers">
        <div className="section-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> NOS UNIVERS</div>
            <h2>Tout ce qu’il vous faut.<br /><em>Au même endroit.</em></h2>
          </div>
          <p>Découvrez les trois grands espaces Assavendo. Chaque offre est présentée avec ses informations essentielles et ses conditions propres.</p>
        </div>

        <div className="universe-grid">
          {universes.map((item) => (
            <Link href={`/produits?kind=${item.kind}`} className={`universe-card ${item.visual}`} key={item.kind}>
              <div className="universe-card-top"><span>{item.number}</span><span className="universe-arrow" aria-hidden="true">↗</span></div>
              <div className="universe-icon"><UniverseIcon icon={item.icon} /></div>
              <div className="universe-card-bottom">
                <div className="universe-eyebrow">{item.eyebrow}</div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <span className="text-link">{item.label} <span aria-hidden="true">→</span></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="selection-section">
        <div className="selection-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> LA SÉLECTION ASSAVENDO</div>
            <h2>Des choix qui ont<br /><em>du sens.</em></h2>
          </div>
          <Link href="/produits" className="text-link selection-link">Voir toute la boutique <span aria-hidden="true">↗</span></Link>
        </div>
        {products.length > 0 ? (
          <div className="product-grid">
            {products.map((product, index) => {
              const usd = toMajor(product.price_usd_minor, "USD");
              const local = currency !== "USD" ? usdToLocal(fx, usd, currency) : null;
              return (
                <Link key={product.slug} href={`/produits/${product.slug}`} className="product-card">
                  <div className={`product-media product-media-${index % 4}`}>
                    {product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" /> : <span className="product-monogram">A<span>/</span>D</span>}
                    <span className="product-kind">{product.kind === "digital" ? "NUMÉRIQUE" : product.kind === "service" ? "SERVICE" : "PRODUIT"}</span>
                  </div>
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <strong>{format(usd, "USD")}</strong>
                    {local && <span className="muted product-local">≈ {format(local.amount, currency)} · indicatif</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="catalogue-empty">
            <div className="empty-symbol"><span>A</span><i /></div>
            <div>
              <span className="empty-kicker">UNE VITRINE EN CONSTRUCTION</span>
              <h3>La sélection arrive bientôt.</h3>
              <p>Nous préparons les premières fiches produits. Elles seront publiées une fois les prix, les partenaires et les conditions de livraison vérifiés.</p>
            </div>
            <Link href="/produits" className="button button-outline">Explorer le catalogue <span aria-hidden="true">↗</span></Link>
          </div>
        )}
      </section>

      <section className="experience-section" id="experience">
        <div className="experience-panel">
          <div className="experience-copy">
            <div className="eyebrow eyebrow-light"><span className="eyebrow-line" /> L’EXPÉRIENCE ASSAVENDO</div>
            <h2>La confiance se construit<br /><em>à chaque étape.</em></h2>
            <p>De la découverte au suivi, nous mettons l’accent sur une information claire et un accompagnement attentif.</p>
            <Link href="/assistant" className="button button-gold">Besoin d’aide ? Parlons-en <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="experience-list">
            <div className="experience-item"><span>01</span><div><strong>Des informations claires</strong><p>Prix, variantes, délais estimés et conditions visibles avant de commander.</p></div><span className="item-arrow">↗</span></div>
            <div className="experience-item"><span>02</span><div><strong>Un parcours suivi</strong><p>Retrouvez les étapes de votre commande depuis votre espace de suivi.</p></div><span className="item-arrow">↗</span></div>
            <div className="experience-item"><span>03</span><div><strong>Une assistance accessible</strong><p>Un point de contact pour vos questions avant et après l’achat.</p></div><span className="item-arrow">↗</span></div>
          </div>
          <div className="panel-watermark">A</div>
        </div>
      </section>
    </div>
  );
}
