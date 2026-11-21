import { login } from "../actions";
export const metadata = { title: "Administration", robots: { index: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="hero">
      <h1>Administration</h1>
      {sp.err === "config" && <p className="err">ADMIN_PASSWORD (12 caractères min.) et ADMIN_SESSION_SECRET (32 min.) doivent être définis dans Vercel.</p>}
      {sp.err === "1" && <p className="err" role="alert">Mot de passe incorrect.</p>}
      <form className="buy" action={login}>
        <input name="password" type="password" placeholder="Mot de passe" required autoComplete="current-password" />
        <button>Se connecter</button>
      </form>
    </section>
  );
}
