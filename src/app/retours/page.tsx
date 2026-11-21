import Link from "next/link";
import { ReviewNotice } from "@/lib/legal";
export const metadata = { title: "Retours et remboursements" };

export default function Returns() {
  return (
    <section className="hero prose">
      <h1>Retours et remboursements</h1>
      <ReviewNotice />
      <p>Assavendo Digital est votre unique interlocuteur pour tout retour, échange, colis endommagé ou perdu. Vous n'avez pas à contacter le fournisseur.</p>
      <h2>Comment procéder</h2>
      <p>Faites une demande depuis <Link href="/retours/demande">la page de demande</Link> avec votre numéro de commande. Nous répondons avec la marche à suivre ; n'expédiez rien avant notre accord.</p>
      <h2>Cas couverts</h2>
      <p>Colis endommagé ou non conforme (photos demandées), colis perdu, retour dans le délai accordé pour votre pays, échange selon disponibilité. Les produits numériques et services exécutés ne sont remboursables que s'ils sont défectueux ou non fournis, sauf droit impératif contraire.</p>
      <h2>Remboursement</h2>
      <p>Une fois le retour accepté et reçu (ou le litige établi), le remboursement est effectué sur le moyen de paiement d'origine via Paystack, en général sous quelques jours ouvrés selon votre banque. Les frais de retour et la restitution des droits de douane dépendent du motif et du pays ; ils sont précisés dans notre réponse avant tout envoi.</p>
      <h2>Délais par pays</h2>
      <p>Le délai de retour est de 14 jours après réception par défaut ; il peut être plus long ou imposé par la loi de votre pays de résidence, qui prévaut.</p>
    </section>
  );
}
