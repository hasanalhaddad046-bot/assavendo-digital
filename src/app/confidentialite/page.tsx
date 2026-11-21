import { legalIdentity, ReviewNotice } from "@/lib/legal";
export const metadata = { title: "Confidentialité" };
export const dynamic = "force-dynamic";

export default async function Privacy() {
  const id = await legalIdentity();
  return (
    <section className="hero prose">
      <h1>Politique de confidentialité</h1>
      <ReviewNotice />
      <h2>Responsable du traitement</h2>
      <p>{id.name}, {id.address}. Contact : {id.email}.</p>
      <h2>Données collectées</h2>
      <p>Nom, e-mail, téléphone, adresse de livraison, contenu de la commande, historique de paiement (référence et statut, jamais le numéro de carte), et données techniques de sécurité (adresse IP, pays approximatif, signaux anti-fraude).</p>
      <h2>Finalités et bases</h2>
      <p>Exécuter votre commande et la livraison ; facturer ; assurer le support, les retours et remboursements ; prévenir la fraude (intérêt légitime) ; respecter nos obligations comptables et fiscales.</p>
      <h2>Destinataires</h2>
      <p>Paystack (paiement), nos partenaires fournisseurs, transporteurs et agences de réexpédition (uniquement ce qui est nécessaire à la livraison), notre hébergeur et notre prestataire d'e-mail. Les messages envoyés à un assistant IA sont anonymisés (e-mails et téléphones masqués) et n'incluent jamais de données de paiement. Des transferts internationaux ont lieu du fait de la livraison et des prestataires.</p>
      <h2>Conservation</h2>
      <p>Les données personnelles des commandes sont anonymisées automatiquement après la durée légale de conservation (3 ans par défaut) ; montants et numéros de facture sont conservés pour la comptabilité.</p>
      <h2>Vos droits</h2>
      <p>Accès, rectification, effacement lorsque la loi le permet, opposition et réclamation auprès de l'autorité de protection des données compétente (en Tanzanie : la Personal Data Protection Commission). Écrivez à {id.email}.</p>
      <h2>Sécurité</h2>
      <p>Chiffrement en transit, accès restreint aux données, aucune donnée de carte sur nos serveurs.</p>
    </section>
  );
}
