import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Assavendo Digital", template: "%s — Assavendo Digital" },
  description: "Boutique en ligne : produits, solutions numériques et services Internet, livrés dans de nombreux pays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">ASSAVENDO <span>DIGITAL</span></Link>
            <nav className="muted">
              <Link href="/livraison">Livraison</Link> · <Link href="/retours">Retours</Link> · <Link href="/confidentialite">Confidentialité</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap muted">
            © Assavendo Digital. Opérations et partenaires logistiques en Tanzanie. Les produits physiques sont
            commandés auprès de partenaires après votre commande ; les délais affichés sont estimatifs.
          </div>
        </footer>
      </body>
    </html>
  );
}
