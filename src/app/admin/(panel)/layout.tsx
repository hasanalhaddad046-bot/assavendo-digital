import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin" style={{ padding: "24px 0" }}>
      <nav className="row" style={{ marginBottom: 16 }}>
        <Link href="/admin">Tableau de bord</Link>
        <Link href="/admin/commandes">Commandes</Link>
        <Link href="/admin/produits">Produits</Link>
        <Link href="/admin/fournisseurs">Fournisseurs</Link>
        <Link href="/admin/agences">Agences</Link>
        <Link href="/admin/retours">Retours</Link>
        <Link href="/admin/emails">E-mails</Link>
        <Link href="/admin/parametres">Paramètres</Link>
        <form action={logout}><button className="sec">Déconnexion</button></form>
      </nav>
      {children}
    </div>
  );
}
