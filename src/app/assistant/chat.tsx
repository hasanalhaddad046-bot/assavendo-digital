"use client";
import Link from "next/link";
import { useState } from "react";

export default function Chat() {
  const [a, setA] = useState<{ answer: string; products: { slug: string; name: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const q = String(new FormData(e.currentTarget).get("q") ?? "");
    const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
    setA(await r.json().catch(() => ({ answer: "Erreur.", products: [] })));
    setBusy(false);
  }
  return (
    <>
      <form className="buy" onSubmit={ask}>
        <input name="q" placeholder="Votre question" required maxLength={500} />
        <button disabled={busy}>{busy ? "…" : "Demander"}</button>
      </form>
      {a && (
        <div className="notice">
          <p>{a.answer}</p>
          {a.products?.length > 0 && <p>{a.products.map((p) => <span key={p.slug}><Link href={`/produits/${p.slug}`}>{p.name}</Link>{" · "}</span>)}</p>}
        </div>
      )}
    </>
  );
}
