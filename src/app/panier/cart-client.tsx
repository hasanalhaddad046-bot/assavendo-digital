"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { useCart, cartLineKey } from "@/components/cart";

const CURRENCIES = ["USD","TZS","KES","UGX","RWF","EUR","GBP","CNY","JPY","NGN","ZAR","GHS","CAD","AUD","AED","SAR","INR","CHF"];
const COUNTRIES = [
  ["TZ","Tanzanie"],["KE","Kenya"],["UG","Ouganda"],["RW","Rwanda"],["US","États-Unis"],
  ["GB","Royaume-Uni"],["NG","Nigéria"],["ZA","Afrique du Sud"],["GH","Ghana"],
  ["AE","Émirats arabes unis"],["IN","Inde"],["CN","Chine"],["FR","France"],["BE","Belgique"],
];

interface ShippingQuote {
  productId: string;
  available: boolean;
  shippingUsdMinor: number;
  dutyMode: string | null;
  daysMin: number | null;
  daysMax: number | null;
}
interface FxQuote {
  currency: string;
  rate: number;
  fetchedAt: string;
  source: string;
  indicative: true;
}

function money(amountMinor: number, currency: string): string {
  const digits = ["JPY","KRW","UGX","RWF","VND","XAF","XOF"].includes(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency", currency, maximumFractionDigits: digits,
    }).format(amountMinor / (10 ** digits));
  } catch {
    return `${(amountMinor / (10 ** digits)).toFixed(digits)} ${currency}`;
  }
}

function displayMoney(usdMinor: number, fx: FxQuote | null, currency: string): string {
  if (currency === "USD") return money(usdMinor, "USD");
  if (!fx || fx.currency !== currency) return "—";
  const amount = (usdMinor / 100) * fx.rate;
  const digits = ["JPY","KRW","UGX","RWF","VND","XAF","XOF"].includes(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency", currency, maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

export default function Cart() {
  const { lines, setQty, remove, clear, ready } = useCart();
  const [country, setCountry] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote[] | null>(null);
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);
  const [fxError, setFxError] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    setShippingQuote(null);
    setQuoteError("");
    if (!/^[A-Z]{2}$/.test(country) || lines.length === 0) return;
    const controller = new AbortController();
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ country, productIds: lines.map((line) => line.id) }),
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Devis de livraison indisponible.");
        setShippingQuote(result.items ?? []);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setQuoteError(error.message || "Devis de livraison indisponible.");
      });
    return () => controller.abort();
  }, [country, lines]);

  useEffect(() => {
    setFxQuote(null);
    setFxError("");
    if (displayCurrency === "USD") return;
    const controller = new AbortController();
    fetch(`/api/fx/quote?currency=${encodeURIComponent(displayCurrency)}`, {
      cache: "no-store", signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Taux de change indisponible.");
        setFxQuote(result as FxQuote);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setFxError(error.message || "Taux de change indisponible.");
      });
    return () => controller.abort();
  }, [displayCurrency]);

  const itemsUsdMinor = useMemo(
    () => lines.reduce((sum, line) => sum + line.priceMinor * line.qty, 0),
    [lines],
  );
  const shippingUsdMinor = useMemo(
    () => shippingQuote?.reduce((sum, item) => sum + item.shippingUsdMinor, 0) ?? 0,
    [shippingQuote],
  );
  const blocked = shippingQuote
    ? shippingQuote.filter((quote) => !quote.available)
      .map((quote) => lines.find((line) => line.id === quote.productId)?.name)
      .filter((name): name is string => Boolean(name))
    : [];
  const totalUsdMinor = itemsUsdMinor + shippingUsdMinor;
  const fxReady = displayCurrency === "USD" || !!fxQuote;
  const quoteReady = !!shippingQuote && blocked.length === 0 && !quoteError;

  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quoteReady || !fxReady || busy) return;
    setBusy(true);
    setMsg("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((line) => ({
            productId: line.id,
            variantId: line.variantId ?? null,
            qty: line.qty,
          })),
          email: form.get("email"),
          shipCountry: country,
          displayCurrency,
          turnstileToken,
          acceptTerms: form.get("terms") === "on",
          address: {
            name: form.get("name"),
            phone: form.get("phone"),
            line1: form.get("line1"),
            line2: form.get("line2"),
            district: form.get("district"),
            landmark: form.get("landmark"),
            city: form.get("city"),
            region: form.get("region"),
            postal: form.get("postal"),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.url) {
        clear();
        window.location.href = result.url;
        return;
      }
      setMsg(result.error || "Une erreur est survenue.");
    } catch {
      setMsg("Impossible de contacter le service de commande. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;
  if (lines.length === 0) {
    return <section className="hero"><h1>Panier</h1><p>Votre panier est vide. <Link href="/produits">Voir le catalogue</Link></p></section>;
  }

  return (
    <section style={{ padding: "32px 0" }}>
      <h1>Panier</h1>
      <table className="t">
        <thead><tr><th>Article</th><th>Prix</th><th>Qté</th><th></th></tr></thead>
        <tbody>
          {lines.map((line) => (
            <tr key={cartLineKey(line)}>
              <td>
                <Link href={`/produits/${line.slug}`}>{line.name}</Link>
                {line.variantName && <div className="muted">Variante : {line.variantName}</div>}
              </td>
              <td>{displayMoney(line.priceMinor, fxQuote, displayCurrency)}</td>
              <td>
                <input type="number" min={1} max={20} value={line.qty}
                  onChange={(event) => setQty(cartLineKey(line), Number(event.target.value))}
                  style={{ width: 70 }} aria-label={`Quantité ${line.name}`} />
              </td>
              <td><button type="button" className="sec" onClick={() => remove(cartLineKey(line))}>Retirer</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="buy" onSubmit={submit}>
        <h2>Livraison et devise d'affichage</h2>
        <label>
          Pays de livraison
          <select value={country} onChange={(event) => setCountry(event.target.value)} required>
            <option value="">Choisir un pays</option>
            {COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label>
          Devise d'affichage choisie par le client
          <select value={displayCurrency} onChange={(event) => setDisplayCurrency(event.target.value)}>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        {displayCurrency !== "USD" && fxQuote && (
          <p className="muted">
            Taux indicatif : 1 USD = {fxQuote.rate.toLocaleString("fr-FR", { maximumFractionDigits: 6 })} {displayCurrency}.
            Source : {fxQuote.source}. Actualisé : {new Date(fxQuote.fetchedAt).toLocaleString("fr-FR")}.
          </p>
        )}
        {fxError && <p className="err" role="alert">{fxError} Vous pouvez choisir USD ou réessayer plus tard.</p>}

        <h2>Estimation de la commande</h2>
        {quoteError && <p className="err" role="alert">{quoteError}</p>}
        {shippingQuote && blocked.length > 0 && (
          <p className="err" role="alert">Non livrable vers ce pays : {blocked.join(", ")}. Retirez ces articles.</p>
        )}
        <p>Sous-total : <strong>{displayMoney(itemsUsdMinor, fxQuote, displayCurrency)}</strong> <span className="muted">({money(itemsUsdMinor, "USD")})</span></p>
        {shippingQuote && blocked.length === 0 && (
          <>
            <p>Livraison estimée : <strong>{displayMoney(shippingUsdMinor, fxQuote, displayCurrency)}</strong> <span className="muted">({money(shippingUsdMinor, "USD")})</span></p>
            <p>Total estimé : <strong>{displayMoney(totalUsdMinor, fxQuote, displayCurrency)}</strong> <span className="muted">({money(totalUsdMinor, "USD")})</span></p>
            {shippingQuote.some((item) => item.dutyMode === "DAP") && (
              <p className="muted">Certains articles sont en DAP : les droits et taxes éventuels restent à régler par le destinataire à la réception.</p>
            )}
            {shippingQuote.some((item) => item.dutyMode === "DDP") && (
              <p className="muted">Les articles DDP incluent les droits et taxes indiqués par la règle de livraison.</p>
            )}
          </>
        )}
        <p className="muted">La devise choisie ici sert à afficher une estimation. L'encaissement s'effectue dans une devise effectivement activée sur le compte de paiement, après vérification du prix final.</p>

        <h2>Coordonnées et adresse complète</h2>
        <label>Nom du destinataire<input name="name" required autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Téléphone international<input name="phone" type="tel" placeholder="+255…" required autoComplete="tel" /></label>
        <label>Région / province<input name="region" required autoComplete="address-level1" /></label>
        <label>District / département<input name="district" required /></label>
        <label>Ville<input name="city" required autoComplete="address-level2" /></label>
        <label>Adresse (rue, quartier, numéro)<input name="line1" required autoComplete="address-line1" /></label>
        <label>Complément d'adresse<input name="line2" autoComplete="address-line2" /></label>
        <label>Repère / point de référence<input name="landmark" placeholder="Ex. près de…" /></label>
        <label>Code postal (si applicable)<input name="postal" autoComplete="postal-code" /></label>
        <Turnstile onToken={handleTurnstileToken} />
        <label className="check">
          <input type="checkbox" name="terms" required />
          J'accepte les <Link href="/cgv" target="_blank">conditions générales de vente</Link> et la politique de confidentialité.
        </label>
        {msg && <p className="err" role="alert">{msg}</p>}
        <button disabled={busy || !quoteReady || !fxReady || blocked.length > 0}>
          {busy ? "Vérification de la commande…" : "Continuer vers le paiement"}
        </button>
      </form>
    </section>
  );
}
