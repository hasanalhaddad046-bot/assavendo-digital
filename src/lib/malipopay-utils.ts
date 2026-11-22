import crypto from "node:crypto";

const CURRENCY = "TZS";

export function normalizeMalipopayPhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  return /^255\d{9}$/.test(digits) ? digits : null;
}

export function wholeTzsToMinor(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Le montant MALIPOPAY doit être un nombre entier positif de TZS.");
  }
  const minor = amount * 100;
  if (!Number.isSafeInteger(minor)) throw new Error("Le montant TZS dépasse la capacité du système.");
  return minor;
}

export function nonNegativeWholeTzsToMinor(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Montant de frais MALIPOPAY invalide.");
  }
  const minor = amount * 100;
  if (!Number.isSafeInteger(minor)) throw new Error("Montant de frais TZS hors limite.");
  return minor;
}

export function isFullSuccessfulCollection(
  payment: { status?: string; currency?: string; amount?: number; paidAmount?: number },
  expectedAmountTzs: number,
): boolean {
  const status = String(payment.status ?? "").toUpperCase();
  return (status === "SUCCESSFUL" || status === "PAID")
    && String(payment.currency ?? "").toUpperCase() === CURRENCY
    && Number.isSafeInteger(Number(payment.amount))
    && Number.isSafeInteger(Number(payment.paidAmount))
    && Number(payment.amount) === expectedAmountTzs
    && Number(payment.paidAmount) === expectedAmountTzs;
}

export function verifyMalipopayWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
