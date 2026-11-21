import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { Flash } from "../flash";
import { inviteAdminMember, updateAdminMember } from "../../actions";

export const metadata={title:"Équipe et rôles",robots:{index:false}};
export default async function Team({searchParams}:{searchParams:Promise<{ok?:string;err?:string}>}) {
  await requireAdmin("team:manage");
  const q=await searchParams;
  const {data:members}=await supabaseAdmin().from("admin_members")
    .select("user_id,email,display_name,role,active,last_login_at,created_at")
    .order("created_at",{ascending:true});
  return <>
    <h1>Équipe et contrôle des accès</h1>
    <Flash ok={q.ok} err={q.err}/>
    <p className="muted">Chaque membre se connecte par lien e-mail nominatif. Les autorisations sont contrôlées côté serveur à chaque page et action. Le compte propriétaire historique reste indépendant des comptes de l'équipe.</p>
    <h2>Inviter un membre</h2>
    <form className="buy" action={inviteAdminMember}>
      <div className="row">
        <label>E-mail professionnel<input name="email" type="email" required/></label>
        <label>Nom affiché<input name="display_name" maxLength={160}/></label>
        <label>Rôle<select name="role" defaultValue="support_agent">
          <option value="administrator">Administrateur</option>
          <option value="catalog_manager">Gestionnaire catalogue</option>
          <option value="purchasing_manager">Achats fournisseurs</option>
          <option value="logistics_manager">Logistique</option>
          <option value="support_agent">Support client</option>
          <option value="accountant">Comptabilité</option>
          <option value="auditor">Auditeur (lecture)</option>
          <option value="owner">Propriétaire (un seul actif)</option>
        </select></label>
      </div>
      <button>Inviter et attribuer les droits</button>
    </form>
    <h2>Membres autorisés ({members?.length??0})</h2>
    {(members??[]).map(member=><section key={member.user_id} className="notice">
      <strong>{member.display_name||member.email}</strong> · {member.email}
      <p><span className="pill">{member.role}</span> · {member.active?"Actif":"Désactivé"}</p>
      <p className="muted">Dernière connexion connue : {member.last_login_at?new Date(member.last_login_at).toLocaleString("fr-FR"):"—"}</p>
      <form className="buy" action={updateAdminMember}>
        <input type="hidden" name="user_id" value={member.user_id}/>
        <div className="row">
          <label>Rôle<select name="role" defaultValue={member.role}>
            {["administrator","catalog_manager","purchasing_manager","logistics_manager","support_agent","accountant","auditor","owner"].map(role=><option key={role}>{role}</option>)}
          </select></label>
          <label>Nom affiché<input name="display_name" defaultValue={member.display_name}/></label>
          <label className="check"><input type="checkbox" name="active" defaultChecked={member.active}/>Accès actif</label>
        </div>
        <button className="sec">Enregistrer les droits</button>
      </form>
    </section>)}
  </>;
}
