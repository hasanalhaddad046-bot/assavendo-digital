"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart";

const usd = (minor: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(minor / 100);

interface Q { productId: string; available: boolean; shippingUsdMinor: number; dutyMode: string | null; daysMin: number | null; daysMax: number | null }

export default function Cart() {
  const { lines, setQty, remove, clear, ready } = useCart();
  const [country, setCountry] = useState("");
  const [quote, setQuote] = useState<Q[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setQuote(null);
    if (!/^[A-Za-z]{2}$/.test(country) || lines.length === 0) return;
    const ctl = new AbortController();
    fetch("/api/quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ country, productIds: lines.map((l) => l.id) }),
    }).then((r) => r.json()).then((j) => setQuote(j.items ?? null)).catch(() => {});
    return () => ctl.abort();
  }, [country, lines]);

  if (!ready) return null;
  if (lines.length === 0) return <section className="hero"><h1>Panier</h1><p>Votre panier est vide. <Link href="/produits">Voir le catalogue</Link></p></section>;

  const items = lines.reduce((s, l) => s + l.priceMinor * l.qty, 0);
  const ship = quote ? quote.reduce((s, q) => s + q.shippingUsdMinor, 0) : 0;
  const blocked = quote ? quote.filter((q) => !q.available).map((q) => lines.find((l) => l.id === q.productId)?.name).filter(Boolean) : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({ productId: l.id, qty: l.qty })),
        email: f.get("email"), shipCountry: country, acceptTerms: f.get("terms") === "on",
        address: { name: f.get("name"), phone: f.get("phone"), line1: f.get("line1"), city: f.get("city"), region: f.get("region"), postal: f.get("postal") },
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && j.url) { clear(); window.location.href = j.url; } else setMsg(j.error || "Une erreur est survenue.");
  }

  return (
    <section style={{ padding: "32px 0" }}>
      <h1>Panier</h1>
      <table className="t">
        <thead><tr><th>Article</th><th>Prix</th><th>Qté</th><th></th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td><Link href={`/produits/${l.slug}`}>{l.name}</Link></td>
              <td>{usd(l.priceMinor)}</td>
              <td><input type="number" min={1} max={20} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value))} style={{ width: 70 }} aria-label={`Quantité ${l.name}`} /></td>
              <td><button type="button" className="sec" onClick={() => remove(l.id)}>Retirer</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Sous-total : <strong>{usd(items)}</strong></p>

      <form className="buy" onSubmit={submit}>
        <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="Pays de livraison (code, ex. TZ)" maxLength={2} required />
        {quote && blocked.length > 0 && <p className="err" role="alert">Non livrable vers ce pays : {blocked.join(", ")}. Retirez ces articles.</p>}
        {quote && blocked.length === 0 && (
          <div className="notice">
            Livraison : {usd(ship)}. Total estimé : <strong>{usd(items + ship)}</strong>.
            {quote.filter((q) => q.dutyMode === "DAP").length > 0 && " Certains articles sont en DAP : droits et taxes éventuels à votre charge à la réception."}
            {quote.filter((q) => q.dutyMode === "DDP").length > 0 && " Les articles DDP incluent droits et taxes."}
          </div>
        )}
        <input name="name" placeholder="Nom du destinataire" required autoComplete="name" />
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
        <input name="phone" placeholder="Téléphone international, ex. +255712345678" required autoComplete="tel" />
        <input name="region" placeholder="Région" />
        <input name="city" placeholder="Ville" required />
        <input name="line1" placeholder="Adresse, quartier, repère" required />
        <input name="postal" placeholder="Code postal (si utilisé)" />
        <label className="muted"><input type="checkbox" name="terms" required /> J'accepte les <Link href="/cgv">conditions générales de vente</Link>, la <Link href="/retours">politique de retours</Link> et la <Link href="/confidentialite">politique de confidentialité</Link>.</label>
        <button disabled={busy || blocked.length > 0 || !quote}>{busy ? "Patientez…" : "Payer en sécurité"}</button>
        {msg && <p className="err" role="alert">{msg}</p>}
      </form>
    </section>
  );
}
