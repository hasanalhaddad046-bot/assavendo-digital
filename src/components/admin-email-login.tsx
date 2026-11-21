"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function AdminEmailLogin() {
  const [email,setEmail]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy) return;
    setBusy(true);
    setMessage("");
    try {
      const origin=window.location.origin;
      const {error}=await supabaseBrowser().auth.signInWithOtp({
        email:email.trim().toLowerCase(),
        options:{shouldCreateUser:false,emailRedirectTo:origin+"/admin/auth/callback"},
      });
      if(error) throw error;
      setMessage("Lien de connexion envoyé. Seules les adresses déjà invitées et activées par le propriétaire peuvent accéder à l'administration.");
    } catch(error) {
      setMessage(error instanceof Error?error.message:"Impossible d'envoyer le lien sécurisé.");
    } finally { setBusy(false); }
  }
  return <form className="buy" onSubmit={submit}>
    <h2>Connexion nominative de l'équipe</h2>
    <label>E-mail professionnel<input type="email" value={email} onChange={event=>setEmail(event.target.value)} required autoComplete="email"/></label>
    {message&&<p role="status">{message}</p>}
    <button disabled={busy}>{busy?"Envoi…":"Recevoir un lien sécurisé"}</button>
  </form>;
}
