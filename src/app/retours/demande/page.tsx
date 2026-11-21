import RmaForm from "./form";
export const metadata = { title: "Demande de retour ou d'aide" };
export default function Page() {
  return (
    <section className="hero">
      <h1>Retour, échange, colis endommagé ou perdu</h1>
      <p>Indiquez votre numéro de commande et l'e-mail utilisé. Nous sommes votre seul interlocuteur : ne contactez pas le fournisseur.</p>
      <RmaForm />
    </section>
  );
}
