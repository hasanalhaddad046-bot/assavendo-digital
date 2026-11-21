"use client";
import { useState } from "react";

export default function RmaForm() {
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg("");
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/rma", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: f.get("number"), email: f.get("email"), kind: f.get("kind"), reason: f.get("reason") }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setOk(true); else setMsg(j.error || "Erreur.");
  }
  if (ok) return <p className="notice">Demande enregistrée. Un e-mail de confirmation vous est envoyé.</p>;
  return (
    <form className="buy" onSubmit={submit}>
      <input name="number" type="number" placeholder="Numéro de commande" required />
      <input name="email" type="email" placeholder="E-mail de la commande" required />
      <select name="kind" required defaultValue="return">
        <option value="return">Retour</option><option value="exchange">Échange</option>
        <option value="damaged">Colis endommagé</option><option value="lost">Colis perdu</option>
      </select>
      <textarea name="reason" placeholder="Décrivez le problème" required maxLength={2000} style={{ minHeight: 100, font: "inherit", padding: 10, borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" }} />
      <button disabled={busy}>{busy ? "Envoi…" : "Envoyer la demande"}</button>
      {msg && <p className="err" role="alert">{msg}</p>}
    </form>
  );
}
