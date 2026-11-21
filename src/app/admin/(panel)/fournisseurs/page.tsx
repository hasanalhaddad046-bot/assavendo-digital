import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createSupplier, setSupplierTrust } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "Fournisseurs", robots: { index: false } };

export default async function Suppliers({
  searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin("suppliers:read");
  const sp = await searchParams;
  const { data } = await supabaseAdmin().from("suppliers").select("*").order("code");
  return (
    <>
      <h1>Fournisseurs</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="t">
        <thead><tr><th>Code</th><th>Nom</th><th>Plateforme</th><th>Devise</th><th>Confiance</th></tr></thead>
        <tbody>{(data ?? []).map((s) => (
          <tr key={s.id}><td>{s.code}</td><td>{s.name}</td><td>{s.platform}</td><td>{s.billing_currency}</td>
            <td><form action={setSupplierTrust} className="row"><input type="hidden" name="id" value={s.id} />
              <select name="trust_level" defaultValue={s.trust_level}>{["in_review", "approved", "watch", "blocked"].map((t) => <option key={t}>{t}</option>)}</select><button className="sec">OK</button></form></td></tr>
        ))}</tbody>
      </table>
      <form className="buy" action={createSupplier}>
        <input name="code" placeholder="Code interne (ex. S001)" required /><input name="name" placeholder="Nom" required />
        <input name="platform" placeholder="Plateforme (1688, Alibaba…)" /><input name="url" placeholder="URL" />
        <div className="row"><input name="country" placeholder="Pays" defaultValue="CN" maxLength={2} /><input name="currency" placeholder="Devise" defaultValue="CNY" maxLength={3} /></div>
        <button>Ajouter (en revue)</button>
      </form>
    </>
  );
}
