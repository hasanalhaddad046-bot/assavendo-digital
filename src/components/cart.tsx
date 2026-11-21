"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface CartLine { id: string; slug: string; name: string; priceMinor: number; qty: number }
interface Ctx { lines: CartLine[]; add: (l: Omit<CartLine, "qty">, qty?: number) => void; setQty: (id: string, q: number) => void; remove: (id: string) => void; clear: () => void; ready: boolean }

const CartCtx = createContext<Ctx | null>(null);
const KEY = "asv_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch { /* stockage indisponible */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* ignoré */ }
  }, [lines, ready]);

  const add = useCallback((l: Omit<CartLine, "qty">, qty = 1) => {
    setLines((cur) => {
      const f = cur.find((x) => x.id === l.id);
      if (f) return cur.map((x) => (x.id === l.id ? { ...x, qty: Math.min(x.qty + qty, 20) } : x));
      return [...cur, { ...l, qty: Math.min(qty, 20) }];
    });
  }, []);
  const setQty = useCallback((id: string, q: number) => setLines((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.min(Math.max(q, 1), 20) } : x))), []);
  const remove = useCallback((id: string) => setLines((c) => c.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  return <CartCtx.Provider value={{ lines, add, setQty, remove, clear, ready }}>{children}</CartCtx.Provider>;
}

export function useCart(): Ctx {
  const c = useContext(CartCtx);
  if (!c) throw new Error("CartProvider manquant");
  return c;
}

export function CartLink() {
  const { lines } = useCart();
  const n = lines.reduce((s, l) => s + l.qty, 0);
  return <Link href="/panier">Panier{n > 0 ? ` (${n})` : ""}</Link>;
}

export function AddToCart({ product }: { product: Omit<CartLine, "qty"> }) {
  const { add } = useCart();
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { add(product); setDone(true); setTimeout(() => setDone(false), 1800); }}>
      {done ? "Ajouté ✓" : "Ajouter au panier"}
    </button>
  );
}
