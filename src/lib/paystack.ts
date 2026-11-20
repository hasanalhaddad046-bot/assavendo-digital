import crypto from "node:crypto";
import { supabaseAdmin, getSettings, audit } from "./supabase";

const API = "https://api.paystack.co";

function secret(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? "";
}

/**
 * Verrou dur : aucune vente sans stock n'est encaissée tant qu'une autorisation écrite
 * de Paystack n'est pas enregistrée avec sa preuve. Aucun contournement.
 */
export function canCharge(settings: Record<string, string>, isDropshipping = true): boolean {
  if (!isDropshipping) return true;
  return (
    settings.paystack_dropshipping_status === "approved" &&
    (settings.paystack_approval_proof ?? "").trim() !== ""
  );
}

/** Signature HMAC-SHA512 du corps BRUT avec la clé secrète du compte. */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const key = secret();
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = (await r.json().catch(() => null)) as { status?: boolean; data?: any; message?: string } | null;
  if (!r.ok || !j?.status) throw new Error(j?.message || "Réponse Paystack invalide");
  return j.data;
}

/** Initialisation côté serveur : le montant vient de la base, jamais du navigateur. */
export async function initializePayment(p: {
  orderId: string;
  email: string;
  amountMinor: number;
  currency: string;
  fxSnapshot?: unknown;
}): Promise<{ reference: string; authorizationUrl: string }> {
  const settings = await getSettings();
  if (!canCharge(settings, true)) {
    throw new Error("LOCKED: autorisation écrite de Paystack requise avant tout encaissement.");
  }
  if (!secret()) throw new Error("PAYSTACK_SECRET_KEY non définie.");
  const currency = p.currency.toUpperCase();
  const allowed = (settings.paystack_currencies || "USD,KES").split(",").map((c) => c.trim());
  if (!allowed.includes(currency)) throw new Error(`Devise non activée sur le compte : ${currency}`);

  const reference = `ASV-${crypto.randomBytes(10).toString("hex")}`;
  const { error } = await supabaseAdmin().from("payments").insert({
    order_id: p.orderId,
    reference,
    amount_minor: p.amountMinor,
    currency,
    fx_snapshot: p.fxSnapshot ?? null,
  });
  if (error) throw new Error("Enregistrement du paiement impossible.");

  const data = await call("POST", "/transaction/initialize", {
    email: p.email,
    amount: p.amountMinor,
    currency,
    reference,
    callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/commande-recue`,
  });
  return { reference, authorizationUrl: data.authorization_url as string };
}

/** Idempotence : retourne false si l'événement a déjà été reçu. */
export async function registerWebhookEvent(key: string, type: string): Promise<boolean> {
  const { error } = await supabaseAdmin().from("webhook_events").insert({ event_key: key, event_type: type });
  if (!error) return true;
  if (error.code === "23505") return false; // doublon
  throw error;
}

/** Vérification API + comparaison montant/devise/référence ; un seul passage à paid_verified. */
export async function processVerifiedPayment(reference: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("payments").select("*").eq("reference", reference).maybeSingle();
  if (!row) {
    await audit("payment_unknown_reference", reference);
    return;
  }
  let d: any;
  try {
    d = await call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  } catch {
    return;
  }
  if (d.status !== "success") return;
  if (Number(d.amount) !== Number(row.amount_minor) || String(d.currency).toUpperCase() !== row.currency) {
    await db.from("payments").update({ status: "manual_review" }).eq("id", row.id);
    await audit("payment_mismatch", reference, { paystack: [d.amount, d.currency], expected: [row.amount_minor, row.currency] });
    return;
  }
  const { data: changed } = await db
    .from("payments")
    .update({ status: "paid_verified", verified_at: new Date().toISOString() })
    .eq("id", row.id)
    .neq("status", "paid_verified")
    .select("id");
  if (changed && changed.length === 1) {
    await db.from("orders").update({ status: "paid_verified" }).eq("id", row.order_id);
    await audit("payment_verified", reference, { order_id: row.order_id });
  }
}
