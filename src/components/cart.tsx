"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface CartLine {
  id: string;
  slug: string;
  name: string;
  priceMinor: number;
  qty: number;
  variantId?: string | null;
  variantName?: string | null;
}
export interface CartVariant {
  id: string;
  name: string;
  priceMinor: number | null;
}
interface Ctx {
  lines: CartLine[];
  add: (line: Omit<CartLine, "qty">, qty?: number) => void;
  setQty: (lineKey: string, qty: number) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
  ready: boolean;
}
export const cartLineKey = (line: Pick<CartLine, "id" | "variantId">) => `${line.id}::${line.variantId ?? "base"}`;

const CartCtx = createContext<Ctx | null>(null);
const KEY = "asv_cart_v2";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY) ?? localStorage.getItem("asv_cart_v1");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setLines(parsed.filter((line) =>
            line && typeof line.id === "string" && typeof line.slug === "string"
            && typeof line.name === "string" && Number.isSafeInteger(line.priceMinor)
            && line.priceMinor >= 0 && Number.isSafeInteger(line.qty)
            && line.qty >= 1 && line.qty <= 20));
        }
      }
    } catch {
      // A corrupt or blocked local cart must not prevent the storefront from rendering.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* storage unavailable */ }
  }, [lines, ready]);

  const add = useCallback((line: Omit<CartLine, "qty">, qty = 1) => {
    setLines((current) => {
      const existing = current.find((item) => cartLineKey(item) === cartLineKey(line));
      if (existing) {
        return current.map((item) => cartLineKey(item) === cartLineKey(line)
          ? { ...item, qty: Math.min(item.qty + qty, 20) }
          : item);
      }
      return [...current, { ...line, qty: Math.min(Math.max(1, Math.floor(qty)), 20) }];
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => setLines((current) =>
    current.map((item) => cartLineKey(item) === key
      ? { ...item, qty: Math.min(Math.max(Math.floor(qty), 1), 20) }
      : item)), []);
  const remove = useCallback((key: string) => setLines((current) =>
    current.filter((item) => cartLineKey(item) !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  return <CartCtx.Provider value={{ lines, add, setQty, remove, clear, ready }}>{children}</CartCtx.Provider>;
}

export function useCart(): Ctx {
  const context = useContext(CartCtx);
  if (!context) throw new Error("CartProvider manquant");
  return context;
}

export function CartLink() {
  const { lines } = useCart();
  const quantity = lines.reduce((sum, line) => sum + line.qty, 0);
  return <Link href="/panier">Panier{quantity > 0 ? ` (${quantity})` : ""}</Link>;
}

export function AddToCart({
  product,
  variants = [],
}: {
  product: Omit<CartLine, "qty" | "variantId" | "variantName">;
  variants?: CartVariant[];
}) {
  const { add } = useCart();
  const [selected, setSelected] = useState("");
  const [done, setDone] = useState(false);
  const hasVariants = variants.length > 0;
  const selectedVariant = variants.find((variant) => variant.id === selected) ?? null;
  const canAdd = hasVariants
    ? !!selectedVariant && Number.isSafeInteger(selectedVariant.priceMinor) && Number(selectedVariant.priceMinor) > 0
    : Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0;

  return (
    <div className="buy">
      {hasVariants && (
        <label>
          Choisir une variante
          <select value={selected} onChange={(event) => setSelected(event.target.value)} required>
            <option value="">Sélectionner une variante</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={!variant.priceMinor}>
                {variant.name}{variant.priceMinor ? "" : " — prix à confirmer"}
              </option>
            ))}
          </select>
        </label>
      )}
      {!canAdd && <p className="muted">La variante doit être sélectionnée et son prix validé avant l'ajout.</p>}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          const variant = selectedVariant;
          add({
            ...product,
            priceMinor: variant ? Number(variant.priceMinor) : product.priceMinor,
            variantId: variant?.id ?? null,
            variantName: variant?.name ?? null,
          });
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        }}
      >
        {done ? "Ajouté ✓" : "Ajouter au panier"}
      </button>
    </div>
  );
}
