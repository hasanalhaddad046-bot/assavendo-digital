"use client";
import { useState } from "react";

export default function BuyForm({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        qty: Number(f.get("qty") || 1),
        email: f.get("email"),
        shipCountry: f.get("country"),
        address: {
          name: f.get("name"), phone: f.get("phone"), line1: f.get("line1"),
          city: f.get("city"), region: f.get("region"), postal: f.get("postal"),
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && j.url) window.location.href = j.url;
    else setMsg(j.error || "Une erreur est survenue.");
  }

  return (
    <form className="buy" onSubmit={submit}>
      <input name="name" placeholder="Nom du destinataire" required autoComplete="name" />
      <input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
      <input name="phone" placeholder="Téléphone (avec indicatif pays)" required autoComplete="tel" />
      <input name="country" placeholder="Pays de livraison (code, ex. TZ)" maxLength={2} required />
      <input name="region" placeholder="Région" />
      <input name="city" placeholder="Ville" required />
      <input name="line1" placeholder="Adresse, quartier, repère" required />
      <input name="postal" placeholder="Code postal (si utilisé)" />
      <input name="qty" type="number" min={1} max={20} defaultValue={1} aria-label="Quantité" />
      <button disabled={busy}>{busy ? "Patientez…" : "Payer en sécurité"}</button>
      {msg && <p className="notice" role="alert">{msg}</p>}
    </form>
  );
}
