import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Suivi de commande" };

async function lookup(fd: FormData) {
  "use server";
  const n = Number(fd.get("number"));
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!Number.isInteger(n) || !email) redirect("/suivi?e=1");
  const { data } = await supabaseAdmin().from("orders").select("public_token,email").eq("number", n).maybeSingle();
  if (!data || data.email.toLowerCase() !== email) redirect("/suivi?e=1");
  redirect(`/suivi/${data.public_token}`);
}

export default async function Suivi({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="hero">
      <h1>Suivi de commande</h1>
      <p>Entrez votre numéro de commande et l'e-mail utilisé. Vous pouvez aussi utiliser le lien reçu par e-mail.</p>
      {sp.e && <p className="err" role="alert">Commande introuvable. Vérifiez le numéro et l'e-mail.</p>}
      <form className="buy" action={lookup}>
        <input name="number" type="number" placeholder="Numéro de commande" required />
        <input name="email" type="email" placeholder="E-mail" required />
        <button>Voir ma commande</button>
      </form>
    </section>
  );
}
