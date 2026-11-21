"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
type Data={email:string;profile:Record<string,string|null>;addresses:Array<Record<string,any>>;orders:Array<Record<string,any>>};
export default function AccountPage(){
 const [data,setData]=useState<Data|null>(null); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(true);
 const load=useCallback(async()=>{
  setBusy(true);
  try{
   const {data:s}=await supabaseBrowser().auth.getSession(); const token=s.session?.access_token;
   if(!token){setData(null);return;}
   const r=await fetch("/api/account",{headers:{Authorization:"Bearer "+token},cache:"no-store"}); const payload=await r.json();
   if(!r.ok) throw new Error(payload.error??"Compte indisponible."); setData(payload);
  }catch(e){setMessage(e instanceof Error?e.message:"Impossible de charger le compte.");}
  finally{setBusy(false);}
 },[]);
 useEffect(()=>{void load();const {data:l}=supabaseBrowser().auth.onAuthStateChange(()=>{void load();});return()=>l.subscription.unsubscribe();},[load]);
 async function token(){const {data:s}=await supabaseBrowser().auth.getSession();return s.session?.access_token??"";}
 async function saveProfile(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const t=await token();if(!t)return setMessage("Session expirée.");const f=new FormData(e.currentTarget);const r=await fetch("/api/account",{method:"PATCH",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});const p=await r.json();setMessage(p.ok?"Profil enregistré.":p.error??"Erreur.");if(p.ok)await load();}
 async function addAddress(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const t=await token();if(!t)return setMessage("Session expirée.");const f=new FormData(form);const body:Record<string,unknown>=Object.fromEntries(f);body.is_default=f.get("is_default")==="on";const r=await fetch("/api/account/addresses",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify(body)});const p=await r.json();setMessage(p.ok?"Adresse enregistrée.":p.error??"Erreur.");if(p.ok){form.reset();await load();}}
 async function signOut(){await supabaseBrowser().auth.signOut();setData(null);setMessage("Déconnexion effectuée.");}
 if(busy)return <p>Chargement du compte…</p>;
 if(!data)return <section className="hero"><h1>Mon compte</h1><p>{message||"Retrouvez vos commandes, adresses et préférences."}</p><Link href="/compte/connexion">Connexion sécurisée par e-mail</Link><p><Link href="/suivi">Suivre une commande sans compte</Link></p></section>;
 return <>
  <h1>Mon compte</h1><p>{data.email}</p>{message&&<p role="status">{message}</p>}<button className="sec" onClick={signOut}>Déconnexion</button>
  <h2>Préférences</h2><form className="buy" onSubmit={saveProfile}>
   <label>Nom complet<input name="full_name" defaultValue={data.profile.full_name??""} required/></label><label>Téléphone<input name="phone" defaultValue={data.profile.phone??""}/></label>
   <div className="row"><label>Langue<select name="preferred_language" defaultValue={data.profile.preferred_language??"fr"}><option value="fr">Français</option><option value="en">English</option><option value="sw">Kiswahili</option></select></label><label>Pays préféré<input name="preferred_country" maxLength={2} defaultValue={data.profile.preferred_country??""}/></label><label>Devise<input name="preferred_currency" maxLength={3} defaultValue={data.profile.preferred_currency??"USD"}/></label></div><button>Enregistrer</button>
  </form>
  <h2>Mes adresses</h2>{data.addresses.map(a=><section className="notice" key={a.id}><strong>{a.label}</strong>{a.is_default?" · Par défaut":""}<p>{a.recipient_name} · {a.phone}</p><p>{a.line1} {a.line2} · {a.district} · {a.city} · {a.region} · {a.country} {a.postal_code}</p>{a.landmark&&<p>Repère : {a.landmark}</p>}</section>)}
  <details><summary>Ajouter une adresse</summary><form className="buy" onSubmit={addAddress}>
   <label>Libellé<input name="label" defaultValue="Domicile"/></label><label>Destinataire<input name="recipient_name" required/></label><label>Téléphone<input name="phone" required/></label>
   <div className="row"><label>Pays<input name="country" maxLength={2} placeholder="TZ" required/></label><label>Région<input name="region" required/></label><label>District<input name="district" required/></label></div>
   <label>Ville<input name="city" required/></label><label>Adresse<input name="line1" required/></label><label>Complément<input name="line2"/></label><label>Repère<input name="landmark"/></label><label>Code postal<input name="postal_code"/></label><label className="check"><input name="is_default" type="checkbox"/>Adresse par défaut</label><button>Enregistrer l'adresse</button>
  </form></details>
  <h2>Mes commandes</h2>{data.orders.length===0&&<p className="muted">Aucune commande liée à ce compte. Les commandes invité restent accessibles par le suivi sécurisé.</p>}
  {data.orders.map(o=><section className="notice" key={o.id}><strong>Commande #{o.number}</strong> · <span className="pill">{o.status}</span><p>{new Date(o.created_at).toLocaleString("fr-FR")} · {(Number(o.total_usd_minor)/100).toFixed(2)} USD · {o.ship_country}</p><p><Link href={o.tracking_url}>Suivi</Link> · <Link href={o.invoice_url}>Facture</Link></p></section>)}
 </>;
}
