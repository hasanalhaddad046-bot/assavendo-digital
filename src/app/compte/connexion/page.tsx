"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
export default function CustomerLogin() {
  const [email,setEmail]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy) return; setBusy(true); setMessage("");
    try {
      const {error}=await supabaseBrowser().auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:window.location.origin+"/compte",shouldCreateUser:true}});
      if(error) throw error;
      setMessage("Un lien de connexion sécurisé vient d'être envoyé. Ouvrez-le pour accéder à votre compte.");
    } catch(e) { setMessage(e instanceof Error?e.message:"Impossible d'envoyer le lien."); }
    finally { setBusy(false); }
  }
  return <section className="hero"><h1>Votre compte Assavendo</h1><p>Connexion sans mot de passe par lien sécurisé envoyé par e-mail.</p><form className="buy" onSubmit={submit}><label>Adresse e-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>{message&&<p role="status">{message}</p>}<button disabled={busy}>{busy?"Envoi…":"Recevoir mon lien de connexion"}</button></form><p className="muted"><Link href="/suivi">Suivre une commande sans compte</Link></p></section>;
}
