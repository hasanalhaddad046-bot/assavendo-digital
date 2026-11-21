import Chat from "./chat";
export const metadata = { title: "Assistant" };
export default function Page() {
  return (
    <section className="hero">
      <h1>Assistant</h1>
      <p>Posez une question sur le catalogue. L'assistant ne voit jamais vos données de paiement et ne remplace pas le support.</p>
      <Chat />
    </section>
  );
}
