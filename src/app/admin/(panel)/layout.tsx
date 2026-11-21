import Link from "next/link";
import { requireAdmin, hasPermission } from "@/lib/admin-auth";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireAdmin();
  return (
    <div className="admin" style={{ padding: "24px 0" }}>
      <nav className="row" style={{ marginBottom: 16 }}>
        {hasPermission(identity.role,"dashboard:read") && <Link href="/admin">Tableau de bord</Link>}
        {hasPermission(identity.role,"orders:read") && <Link href="/admin/commandes">Commandes</Link>}
        {hasPermission(identity.role,"catalog:read") && <Link href="/admin/produits">Produits</Link>}
        {hasPermission(identity.role,"ai:read") && <Link href="/admin/ia">Copilote IA</Link>}
        {hasPermission(identity.role,"workflows:read") && <Link href="/admin/workflows">Workflows</Link>}
        {hasPermission(identity.role,"digital:read") && <Link href="/admin/numerique-services">Numérique / services</Link>}
        {hasPermission(identity.role,"finance:read") && <Link href="/admin/finances">Trésorerie</Link>}
        {hasPermission(identity.role,"suppliers:read") && <Link href="/admin/fournisseurs">Fournisseurs</Link>}
        {hasPermission(identity.role,"logistics:read") && <Link href="/admin/agences">Agences</Link>}
        {hasPermission(identity.role,"returns:read") && <Link href="/admin/retours">Retours</Link>}
        {hasPermission(identity.role,"support:read") && <Link href="/admin/emails">E-mails</Link>}
        {hasPermission(identity.role,"settings:read") && <Link href="/admin/parametres">Paramètres</Link>}
        {hasPermission(identity.role,"team:manage") && <Link href="/admin/equipe">Équipe</Link>}
        <form action={logout}><button className="sec">Déconnexion</button></form>
      </nav>
      {children}
    </div>
  );
}
