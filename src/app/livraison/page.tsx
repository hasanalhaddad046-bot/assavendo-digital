import { ReviewNotice } from "@/lib/legal";
export const metadata = { title: "Livraison" };

export default function Delivery() {
  return (
    <section className="hero prose">
      <h1>Livraison</h1>
      <ReviewNotice />
      <p>Les produits physiques sont commandés auprès d'un partenaire après votre paiement, puis expédiés directement ou via un entrepôt/agence de réexpédition avant la livraison finale.</p>
      <h2>Pays desservis</h2>
      <p>Chaque fiche produit indique les pays desservis, le coût, le délai estimatif et le mode de taxation. Si un article n'est pas livrable vers votre pays, il ne peut pas être commandé.</p>
      <h2>DDP et DAP</h2>
      <p><strong>DDP</strong> : droits et taxes d'importation inclus dans le prix. <strong>DAP</strong> : ils peuvent vous être demandés à la réception, à votre charge. Le mode est affiché avant paiement.</p>
      <h2>Suivi</h2>
      <p>Chaque commande a une page de suivi, accessible par le lien reçu par e-mail ou avec votre numéro de commande.</p>
    </section>
  );
}
