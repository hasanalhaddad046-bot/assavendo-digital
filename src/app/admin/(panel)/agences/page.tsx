import { supabaseAdmin } from "@/lib/supabase";
import { createAgency, toggleAgency } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Agences", robots: { index: false } };

export default async function Agencies({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { data } = await supabaseAdmin().from("agencies").select("*").order("name");
  return (
    <>
      <h1>Agences et entrepôts de réexpédition</h1>
      <p className="muted">Renseignez ici les adresses réelles et vérifiées de vos partenaires. Aucune adresse n'est préremplie.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="t">
        <thead><tr><th>Nom</th><th>Ville</th><th>Adresse (locale)</th><th>Adresse (latin)</th><th>Contact</th><th></th></tr></thead>
        <tbody>{(data ?? []).map((a) => (
          <tr key={a.id}><td>{a.name}{!a.active && " (inactive)"}</td><td>{a.city} {a.country}</td><td>{a.address_local}</td><td>{a.address_latin}</td><td>{a.contact}</td>
            <td><form action={toggleAgency}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={String(!a.active)} /><button className="sec">{a.active ? "Désactiver" : "Activer"}</button></form></td></tr>
        ))}</tbody>
      </table>
      <form className="buy" action={createAgency}>
        <input name="name" placeholder="Nom de l'agence" required /><div className="row"><input name="city" placeholder="Ville" /><input name="country" placeholder="Pays" defaultValue="CN" maxLength={2} /></div>
        <input name="address_local" placeholder="Adresse en caractères locaux (chinois)" /><input name="address_latin" placeholder="Adresse en caractères latins" />
        <input name="contact" placeholder="Contact" /><input name="notes" placeholder="Notes" />
        <button>Ajouter</button>
      </form>
    </>
  );
}
