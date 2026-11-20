export const metadata = { title: "Commande reçue" };

export default function Received() {
  return (
    <section className="hero">
      <h1>Merci, nous vérifions votre paiement.</h1>
      <p>
        Votre commande est confirmée uniquement après validation du paiement par notre prestataire. Vous recevrez
        un e-mail de confirmation. Cette page ne constitue pas une preuve de paiement.
      </p>
    </section>
  );
}
