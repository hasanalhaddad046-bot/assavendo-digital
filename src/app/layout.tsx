import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { CartProvider, CartLink } from "@/components/cart";

export const metadata: Metadata = {
  title: { default: "Assavendo Digital — Shop, Digital & Services", template: "%s — Assavendo Digital" },
  description: "Découvrez les univers Assavendo Digital : produits physiques, solutions numériques et services Internet, avec des informations claires et un suivi de commande.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <CartProvider>
          <div className="announcement-bar">
            <div className="wrap announcement-inner">
              <span>ASSAVENDO DIGITAL</span>
              <span className="announcement-center">SHOP <i /> DIGITAL <i /> SERVICES</span>
              <span className="announcement-right">UNE EXPÉRIENCE À VOTRE RYTHME</span>
            </div>
          </div>
          <header className="site-header">
            <div className="wrap header-inner">
              <Link href="/" className="brand" aria-label="Assavendo Digital, accueil">
                <span className="brand-mark"><span>A</span></span>
                <span className="brand-name">ASSAVENDO<span>DIGITAL</span><small>SHOP · DIGITAL · SERVICES</small></span>
              </Link>
              <nav className="site-nav" aria-label="Navigation principale">
                <Link href="/produits">Boutique</Link>
                <Link href="/assistant">Assistant</Link>
                <Link href="/suivi">Suivi</Link>
                <Link href="/compte">Mon compte</Link>
                <span className="nav-cart"><CartLink /></span>
              </nav>
            </div>
          </header>
          <main className="wrap site-main">{children}</main>
          <footer className="site-footer">
            <div className="wrap footer-main">
              <div className="footer-brand">
                <Link href="/" className="brand brand-footer">
                  <span className="brand-mark"><span>A</span></span>
                  <span className="brand-name">ASSAVENDO<span>DIGITAL</span><small>SHOP · DIGITAL · SERVICES</small></span>
                </Link>
                <p>Des produits, des solutions numériques et des services, avec une expérience d’achat claire et un suivi attentif.</p>
              </div>
              <div className="footer-column">
                <span className="footer-label">EXPLORER</span>
                <Link href="/produits">La boutique</Link>
                <Link href="/assistant">Assistant</Link>
                <Link href="/suivi">Suivi de commande</Link>
                <Link href="/compte">Mon compte</Link>
              </div>
              <div className="footer-column">
                <span className="footer-label">INFORMATIONS</span>
                <Link href="/livraison">Livraison</Link>
                <Link href="/retours">Retours</Link>
                <Link href="/cgv">Conditions de vente</Link>
                <Link href="/confidentialite">Confidentialité</Link>
              </div>
              <div className="footer-note">
                <span className="footer-label">ASSAVENDO DIGITAL</span>
                <p>Opérations et partenaires logistiques en Tanzanie. Les produits physiques sont commandés auprès de partenaires après votre commande ; les délais affichés sont estimatifs.</p>
                <Link href="/mentions-legales">Mentions légales <span aria-hidden="true">↗</span></Link>
              </div>
            </div>
            <div className="wrap footer-bottom">
              <span>© {new Date().getFullYear()} Assavendo Digital. Tous droits réservés.</span>
              <span>Conçu avec attention. Pensé pour durer.</span>
            </div>
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
