import { login } from "../actions";
import { AdminEmailLogin } from "@/components/admin-email-login";
import { adminConfigured } from "@/lib/admin-auth";
export const metadata = { title: "Administration", robots: { index: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="hero">
      <h1>Administration</h1>
      {sp.err === "config" && <p className="err">Le compte propriétaire de secours n'est pas configuré.</p>}
      {sp.err === "auth_config" && <p className="err">Configuration Supabase Auth absente ou URL de redirection invalide.</p>}
      {sp.err === "auth" && <p className="err">Le lien de connexion est invalide, expiré ou déjà utilisé.</p>}
      {sp.err === "not_invited" && <p className="err">Cette adresse n'a pas de rôle administrateur actif.</p>}
      {sp.err === "service_config" && <p className="err">L'accès serveur sécurisé n'est pas configuré. Le propriétaire doit finaliser la clé Supabase serveur.</p>}
      {sp.err === "1" && <p className="err" role="alert">Mot de passe incorrect.</p>}
      <AdminEmailLogin />
      <details>
        <summary>Accès propriétaire de secours</summary>
        {!adminConfigured() && <p className="muted">La connexion propriétaire par mot de passe est désactivée tant que ses deux secrets ne sont pas configurés.</p>}
        <form className="buy" action={login}>
          <input name="password" type="password" placeholder="Mot de passe propriétaire" required autoComplete="current-password" />
          <button>Connexion propriétaire</button>
        </form>
      </details>
    </section>
  );
}
