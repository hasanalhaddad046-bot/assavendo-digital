import { legalIdentity, ReviewNotice } from "@/lib/legal";
export const metadata = { title: "Mentions légales" };
export const dynamic = "force-dynamic";

export default async function Mentions() {
  const id = await legalIdentity();
  return (
    <section className="hero prose">
      <h1>Mentions légales</h1>
      <ReviewNotice />
      <p><strong>Éditeur :</strong> {id.name}<br /><strong>Adresse :</strong> {id.address}<br /><strong>Contact :</strong> {id.email}<br />{id.taxId && <><strong>N° fiscal :</strong> {id.taxId}<br /></>}<strong>Régime de TVA :</strong> {id.vat}</p>
      <p><strong>Hébergement :</strong> Vercel Inc. (application) et Supabase (base de données). <strong>Paiement :</strong> Paystack.</p>
    </section>
  );
}
