import { supabaseAdmin } from "@/lib/supabase";
import { resendPendingEmails } from "../../actions";
import { Flash } from "../flash";

export const metadata = { title: "E-mails", robots: { index: false } };

export default async function Emails({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { data } = await supabaseAdmin().from("email_outbox").select("id,to_email,subject,status,error,created_at").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <h1>E-mails sortants</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={resendPendingEmails}><button>Renvoyer les e-mails en attente / échoués</button></form>
      <table className="t">
        <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Statut</th></tr></thead>
        <tbody>{(data ?? []).map((m) => <tr key={m.id}><td>{new Date(m.created_at).toLocaleString("fr-FR")}</td><td>{m.to_email}</td><td>{m.subject}</td><td><span className="pill">{m.status}</span> {m.error}</td></tr>)}</tbody>
      </table>
    </>
  );
}
