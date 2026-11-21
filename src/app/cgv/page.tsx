import { legalIdentity, ReviewNotice } from "@/lib/legal";
export const metadata = { title: "Conditions générales de vente" };
export const dynamic = "force-dynamic";

export default async function Cgv() {
  const id = await legalIdentity();
  return (
    <section className="hero prose">
      <h1>Conditions générales de vente</h1>
      <ReviewNotice />
      <h2>1. Vendeur</h2>
      <p>{id.name}, {id.address}. Contact : {id.email}.</p>
      <h2>2. Objet et produits</h2>
      <p>Assavendo Digital propose des produits physiques, des produits numériques et des services. Les produits physiques sont commandés auprès d'un partenaire après confirmation de votre paiement ; nous n'avons pas de stock propre.</p>
      <h2>3. Prix et devises</h2>
      <p>Les prix sont établis et débités en dollars américains (USD). Les montants affichés en monnaie locale sont indicatifs, convertis avec un taux actualisé chaque jour ; votre banque peut appliquer son propre taux et ses frais. Les frais de livraison sont indiqués avant paiement. {id.vat}.</p>
      <h2>4. Commande et paiement</h2>
      <p>Le paiement est traité par Paystack ; nous ne stockons aucune donnée de carte. La commande est confirmée uniquement après vérification du paiement. Nous pouvons refuser ou suspendre une commande en cas de suspicion de fraude, d'indisponibilité ou d'erreur de prix manifeste, et nous vous remboursons alors intégralement.</p>
      <h2>5. Livraison, droits et taxes</h2>
      <p>Les délais sont estimatifs. En mode DDP, droits et taxes d'importation sont inclus. En mode DAP, ils peuvent être exigés à la réception par la douane ou le transporteur ; ils restent à votre charge. Le mode applicable est indiqué pour chaque article et chaque pays avant paiement.</p>
      <h2>6. Retours, échanges, remboursements</h2>
      <p>Assavendo Digital est votre seul interlocuteur : en cas de colis endommagé, perdu ou non conforme, ou de retour accepté, adressez-vous à nous via la page de demande. Les conditions précises par pays sont décrites dans la politique de retours. Les droits impératifs dont vous disposez selon la loi de votre pays de résidence ne sont pas affectés.</p>
      <h2>7. Produits numériques et services</h2>
      <p>Pour les contenus numériques fournis immédiatement et les services exécutés, le droit de rétractation peut ne pas s'appliquer une fois l'exécution commencée avec votre accord, sauf disposition légale contraire de votre pays.</p>
      <h2>8. Responsabilité</h2>
      <p>Notre responsabilité est limitée au prix payé pour l'article concerné, dans la mesure permise par la loi, sauf faute lourde ou dol et sauf droits impératifs du consommateur.</p>
      <h2>9. Données personnelles</h2>
      <p>Voir la politique de confidentialité.</p>
      <h2>10. Droit applicable et litiges</h2>
      <p>Sous réserve des règles impératives protégeant les consommateurs de leur pays, le droit de la République unie de Tanzanie s'applique. Essayez d'abord une solution amiable via {id.email}.</p>
    </section>
  );
}
