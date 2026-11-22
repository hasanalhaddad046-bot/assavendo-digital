import crypto from "node:crypto";
import {
  normalizeMalipopayPhone,
  wholeTzsToMinor,
  nonNegativeWholeTzsToMinor,
  isFullSuccessfulCollection,
} from "./malipopay-utils";
import { supabaseAdmin, audit } from "./supabase";
import { siteUrl } from "./mail";
import { ensurePaidSideEffects, claimWebhookEvent, finishWebhookEvent } from "./paystack";
import { dispatchWorkflowEvent } from "./workflow-service";

const API = "https://core-prod.malipopay.co.tz";
const CURRENCY = "TZS";

type MalipopayPayment = {
  id?: string;
  reference?: string;
  merchantAccountId?: string;
  status?: string;
  amount?: number | string;
  paidAmount?: number | string;
  currency?: string;
  transactionFee?: number | string;
  feeAmount?: number | string;
  netAmount?: number | string;
  transactionId?: string;
  link?: string;
};

type MalipopayResponse<T> = {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
};

type MalipopayWebhook = {
  timestamp?: string;
  reference?: string;
  customerReference?: string;
  amount?: number | string;
  status?: string;
  type?: string;
  event?: string;
  service?: string;
  transactionId?: string;
  merchantAccountId?: string;
};

function envFlag(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

export function isMalipopayReadyForDropshipping(): boolean {
  return envFlag("MALIPOPAY_ENABLED")
    && envFlag("MALIPOPAY_ACCOUNT_APPROVED")
    && envFlag("MALIPOPAY_DROPSHIPPING_APPROVED")
    && process.env.MALIPOPAY_CURRENCY === CURRENCY
    && Boolean(process.env.MALIPOPAY_API_KEY)
    && Boolean(process.env.MALIPOPAY_WEBHOOK_SECRET);
}

export function isMalipopayWebhookConfigured(): boolean {
  return Boolean(process.env.MALIPOPAY_WEBHOOK_SECRET);
}

async function malipopayRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<MalipopayResponse<T>> {
  const apiToken = process.env.MALIPOPAY_API_KEY;
  if (!apiToken) throw new Error("MALIPOPAY_API_KEY non configurée.");
  const response = await fetch(API + path, {
    method,
    headers: {
      apiToken,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => null) as MalipopayResponse<T> | null;
  if (!response.ok || !json) {
    throw new Error("API MALIPOPAY indisponible (" + response.status + ").");
  }
  return json;
}

async function verifyProviderPayment(reference: string): Promise<MalipopayPayment> {
  const response = await malipopayRequest<MalipopayPayment>(
    "GET",
    "/api/v1/payment/reference/" + encodeURIComponent(reference),
  );
  if (response.success !== true || !response.data || response.data.reference !== reference) {
    throw new Error("Réponse de vérification MALIPOPAY non concordante.");
  }
  return response.data;
}

export interface MalipopayPaymentInit {
  orderId: string;
  orderNumber: string;
  customerPhone: string;
  amountTzsWhole: number;
  fxSnapshot: Record<string, unknown>;
}

export async function initializeMalipopayPayment(
  input: MalipopayPaymentInit,
): Promise<{ reference: string; checkoutUrl: string; amountTzs: number }> {
  if (!isMalipopayReadyForDropshipping()) {
    throw new Error("LOCKED: compte MALIPOPAY, activité dropshipping et devise TZS non approuvés.");
  }
  const phone = normalizeMalipopayPhone(input.customerPhone);
  if (!phone) throw new Error("Un numéro mobile tanzanien au format +255XXXXXXXXX est requis.");
  if (!Number.isSafeInteger(input.amountTzsWhole) || input.amountTzsWhole <= 0) {
    throw new Error("Montant MALIPOPAY invalide.");
  }

  const amountMinor = wholeTzsToMinor(input.amountTzsWhole);
  const db = supabaseAdmin();

  // Reprendre une tentative incertaine avec la même référence : MALIPOPAY rend les appels idempotents par référence.
  const { data: previous, error: previousError } = await db.from("payments")
    .select("id,reference,status,amount_minor,currency,provider_status")
    .eq("order_id", input.orderId)
    .eq("provider", "malipopay")
    .in("status", ["awaiting_payment", "manual_review", "paid_verified"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw new Error("Lecture de la tentative MALIPOPAY impossible.");
  if (previous?.status === "paid_verified") {
    throw new Error("Cette commande a déjà un paiement confirmé.");
  }
  if (previous?.status === "manual_review") {
    throw new Error("Cette commande attend une vérification de paiement. Contactez le support.");
  }
  if (previous && (
    Number(previous.amount_minor) !== amountMinor ||
    String(previous.currency).trim().toUpperCase() !== CURRENCY
  )) {
    await db.from("payments").update({
      status: "manual_review",
      provider_status: "checkout_amount_changed",
      settlement_status: "manual_review",
    }).eq("id", previous.id);
    throw new Error("Le montant de la tentative précédente a changé. Une vérification humaine est nécessaire.");
  }

  const reference = previous?.reference
    ?? "ASV" + crypto.randomBytes(15).toString("hex").toUpperCase();

  if (!previous) {
    const { error: insertError } = await db.from("payments").insert({
      order_id: input.orderId,
      reference,
      provider: "malipopay",
      amount_minor: amountMinor,
      currency: CURRENCY,
      fx_snapshot: input.fxSnapshot,
      status: "awaiting_payment",
      provider_status: "initializing",
      settlement_status: "unconfirmed",
    });
    if (insertError) throw new Error("Impossible d'enregistrer la tentative MALIPOPAY.");
  }

  try {
    const response = await malipopayRequest<MalipopayPayment>(
      "POST",
      "/api/v2/payment/collection",
      {
        reference,
        description: "Assavendo Digital — commande " + input.orderNumber,
        amount: input.amountTzsWhole,
        service: "mobile",
        account: phone,
        amountType: "FULL",
        push: true,
      },
    );
    const payment = response.data;
    if (
      response.success !== true ||
      response.code !== 1109 ||
      !payment ||
      payment.reference !== reference ||
      String(payment.currency ?? CURRENCY).toUpperCase() !== CURRENCY
    ) {
      await db.from("payments").update({
        status: "failed",
        provider_status: "collection_rejected",
        updated_at: new Date().toISOString(),
      }).eq("reference", reference).eq("provider", "malipopay").eq("status", "awaiting_payment");
      throw new Error("MALIPOPAY n'a pas accepté la collecte. Vérifiez le compte marchand et le numéro mobile.");
    }

    if (typeof payment.link !== "string" || !payment.link) {
      throw new Error("MALIPOPAY n'a pas retourné le lien de paiement hébergé.");
    }
    const link = new URL(payment.link);
    if (
      link.protocol !== "https:" ||
      !(link.hostname === "app.malipopay.co.tz" || link.hostname.endsWith(".malipopay.co.tz"))
    ) {
      throw new Error("Domaine de paiement MALIPOPAY inattendu.");
    }
    const checkoutUrl = link.toString();

    await db.from("payments").update({
      provider_payment_id: payment.id ?? null,
      provider_status: String(payment.status ?? "PROCESSING").toUpperCase(),
      provider_payload: {
        status: payment.status ?? "PROCESSING",
        amount: payment.amount ?? input.amountTzsWhole,
        currency: payment.currency ?? CURRENCY,
        link_created: Boolean(payment.link),
      },
      updated_at: new Date().toISOString(),
    }).eq("reference", reference).eq("provider", "malipopay");

    return { reference, checkoutUrl, amountTzs: input.amountTzsWhole };
  } catch (error) {
    // Une erreur réseau peut survenir après l'acceptation côté prestataire : ne jamais recréer une nouvelle référence automatiquement.
    if (!(error instanceof Error) || !error.message.includes("n'a pas accepté la collecte")) {
      await db.from("payments").update({
        status: "manual_review",
        provider_status: "initialization_outcome_unknown",
        settlement_status: "manual_review",
        updated_at: new Date().toISOString(),
      }).eq("reference", reference).eq("provider", "malipopay").eq("status", "awaiting_payment");
      await db.from("orders").update({ status: "manual_review" })
        .eq("id", input.orderId).neq("status", "paid_verified");
    }
    throw error;
  }
}

async function markPaymentForReview(
  row: { id: string; order_id: string },
  reference: string,
  reason: string,
): Promise<void> {
  const db = supabaseAdmin();
  await db.from("payments").update({
    status: "manual_review",
    provider_status: reason,
    settlement_status: "manual_review",
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  await db.from("orders").update({ status: "manual_review" })
    .eq("id", row.order_id).neq("status", "paid_verified");
  await audit("malipopay_payment_manual_review", reference, { order_id: row.order_id, reason });
}

async function processConfirmedCollection(
  row: { id: string; order_id: string; amount_minor: number | string; currency: string },
  reference: string,
  webhookAmount?: number,
): Promise<void> {
  const providerPayment = await verifyProviderPayment(reference);
  const expectedTzs = Number(row.amount_minor) / 100;
  const paidAmount = Number(providerPayment.paidAmount);
  const requestedAmount = Number(providerPayment.amount);
  if (
    providerPayment.reference !== reference ||
    !isFullSuccessfulCollection({
      status: providerPayment.status,
      currency: providerPayment.currency,
      amount: requestedAmount,
      paidAmount,
    }, expectedTzs) ||
    String(row.currency).trim().toUpperCase() !== CURRENCY ||
    (webhookAmount !== undefined && webhookAmount !== expectedTzs)
  ) {
    await markPaymentForReview(row, reference, "provider_amount_currency_or_status_mismatch");
    return;
  }

  const rawFee = providerPayment.feeAmount ?? providerPayment.transactionFee;
  const rawNet = providerPayment.netAmount;
  const feeTzs = rawFee === undefined || rawFee === null ? null : Number(rawFee);
  const netTzs = rawNet === undefined || rawNet === null ? null : Number(rawNet);
  if (
    (feeTzs !== null && (!Number.isSafeInteger(feeTzs) || feeTzs < 0)) ||
    (netTzs !== null && (!Number.isSafeInteger(netTzs) || netTzs < 0))
  ) {
    await markPaymentForReview(row, reference, "provider_fee_or_net_amount_invalid");
    return;
  }

  const { data: changed, error } = await supabaseAdmin().from("payments").update({
    status: "paid_verified",
    provider_status: String(providerPayment.status).toUpperCase(),
    provider_payment_id: providerPayment.id ?? null,
    provider_transaction_id: providerPayment.transactionId ?? null,
    provider_fee_minor: feeTzs === null ? null : nonNegativeWholeTzsToMinor(feeTzs),
    provider_net_minor: netTzs === null ? null : nonNegativeWholeTzsToMinor(netTzs),
    settlement_status: "wallet_credited",
    provider_payload: {
      reference,
      status: providerPayment.status,
      amount: requestedAmount,
      paidAmount,
      currency: providerPayment.currency,
      feeAmount: feeTzs,
      netAmount: netTzs,
      transactionId: providerPayment.transactionId ?? null,
    },
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).in("status", ["awaiting_payment", "manual_review"]).select("id");
  if (error) throw new Error("Impossible de confirmer le paiement MALIPOPAY.");

  if (!changed?.length) {
    const { data: fresh } = await supabaseAdmin().from("payments")
      .select("status").eq("id", row.id).maybeSingle();
    if (fresh?.status === "paid_verified") return;
    await markPaymentForReview(row, reference, "payment_state_changed_during_verification");
    return;
  }

  const { data: order } = await supabaseAdmin().from("orders")
    .select("status,total_usd_minor,ship_country,risk_score")
    .eq("id", row.order_id).maybeSingle();
  if (order?.status === "manual_review") {
    await audit("malipopay_payment_verified_order_held", reference, {
      order_id: row.order_id,
      reason: "The payment is verified but the order remains under manual review.",
      settlement_status: "wallet_credited",
    });
    return;
  }

  await ensurePaidSideEffects(row.order_id, "MALIPOPAY");
  await audit("malipopay_payment_verified", reference, {
    order_id: row.order_id,
    gross_amount_minor: Number(row.amount_minor),
    fee_amount_minor: feeTzs === null ? null : feeTzs * 100,
    net_amount_minor: netTzs === null ? null : netTzs * 100,
    currency: CURRENCY,
    settlement_status: "wallet_credited",
  });

  if (order && order.status !== "manual_review") {
    try {
      await dispatchWorkflowEvent(supabaseAdmin(), "payment_verified", {
        order_id: row.order_id,
        payment_status: "paid_verified",
        order_status: order.status,
        total_usd_minor: order.total_usd_minor,
        ship_country: order.ship_country,
        risk_score: order.risk_score,
        payment_provider: "malipopay",
        payment_currency: CURRENCY,
      }, "payment-verified:malipopay:" + row.order_id);
    } catch (error) {
      console.error("Workflow dispatch failed after MALIPOPAY payment", error);
    }
  }
}

function malipopayWebhookEnvelope(payload: MalipopayWebhook) {
  const event = String(payload.event ?? "").trim().toLowerCase();
  const reference = String(payload.reference ?? "").trim();
  if (!/^[A-Za-z0-9-]{6,80}$/.test(reference)) return null;
  if (payload.service !== "Collection" || payload.type !== "CHARGE") return null;
  if (!["payment.confirmed", "payment.failed", "payment.refunded"].includes(event)) return null;
  const eventKey = [
    "malipopay",
    event,
    reference,
    String(payload.timestamp ?? ""),
    String(payload.transactionId ?? ""),
  ].join(":");
  const redactedPayload = {
    provider: "malipopay",
    event,
    reference,
    status: payload.status ?? null,
    amount: payload.amount ?? null,
    currency: CURRENCY,
    transaction_id: payload.transactionId ?? null,
    service: payload.service,
  };
  return { event, reference, eventKey, redactedPayload };
}

/** Claim and persist the minimal, redacted webhook event before returning HTTP 200. */
export async function claimMalipopayWebhook(payload: MalipopayWebhook): Promise<string | null> {
  const envelope = malipopayWebhookEnvelope(payload);
  if (!envelope) return null;
  const claimed = await claimWebhookEvent(
    envelope.eventKey,
    envelope.event,
    envelope.redactedPayload,
  );
  return claimed ? envelope.eventKey : null;
}

export async function handleMalipopayWebhook(
  payload: MalipopayWebhook,
  preclaimedEventKey?: string,
): Promise<void> {
  const event = String(payload.event ?? "").trim().toLowerCase();
  const envelope = malipopayWebhookEnvelope(payload);
  if (!envelope || envelope.event !== event) return;
  const { reference, eventKey, redactedPayload } = envelope;
  if (preclaimedEventKey && preclaimedEventKey !== eventKey) {
    throw new Error("MALIPOPAY webhook claim mismatch.");
  }
  if (!preclaimedEventKey) {
    const claimed = await claimWebhookEvent(eventKey, event, redactedPayload);
    if (!claimed) return;
  }

  try {
    const db = supabaseAdmin();
    const { data: row, error } = await db.from("payments")
      .select("id,order_id,amount_minor,currency,status")
      .eq("reference", reference)
      .eq("provider", "malipopay")
      .maybeSingle();
    if (error) throw new Error("Lecture du paiement MALIPOPAY impossible.");
    if (!row) {
      await audit("malipopay_webhook_unmatched", reference, { event });
      await finishWebhookEvent(eventKey, "processed");
      return;
    }

    if (row.status === "paid_verified" && event !== "payment.refunded") {
      await finishWebhookEvent(eventKey, "processed");
      return;
    }

    if (event === "payment.confirmed") {
      const webhookAmount = Number(payload.amount);
      await processConfirmedCollection(
        row,
        reference,
        Number.isSafeInteger(webhookAmount) ? webhookAmount : undefined,
      );
    } else if (event === "payment.failed") {
      await db.from("payments").update({
        status: "failed",
        provider_status: String(payload.status ?? "FAILED").toUpperCase(),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("status", "awaiting_payment");
      await db.from("orders").update({ status: "payment_failed" })
        .eq("id", row.order_id).eq("status", "awaiting_payment");
      await audit("malipopay_payment_failed", reference, { order_id: row.order_id });
    } else if (event === "payment.refunded") {
      await db.from("payments").update({
        status: "refunded",
        provider_status: String(payload.status ?? "REFUNDED").toUpperCase(),
        reversed_at: new Date().toISOString(),
        settlement_status: "manual_review",
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      await db.from("orders").update({ status: "manual_review" })
        .eq("id", row.order_id).neq("status", "delivered");
      await audit("malipopay_payment_refund_reported", reference, { order_id: row.order_id });
    }
    await finishWebhookEvent(eventKey, "processed");
  } catch (error) {
    await finishWebhookEvent(eventKey, "failed", error instanceof Error ? error.message : "Unknown MALIPOPAY webhook error");
    throw error;
  }
}

export async function reconcilePendingMalipopayPayments(limit = 30): Promise<{ checked: number; confirmed: number; failed: number; review: number }> {
  const db = supabaseAdmin();
  const staleBefore = new Date(Date.now() - 90_000).toISOString();
  const { data: rows, error } = await db.from("payments")
    .select("id,order_id,reference,amount_minor,currency,status,created_at")
    .eq("provider", "malipopay")
    .in("status", ["awaiting_payment", "manual_review"])
    .lt("created_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error("Impossible de charger les paiements MALIPOPAY à rapprocher.");

  const result = { checked: 0, confirmed: 0, failed: 0, review: 0 };
  for (const row of rows ?? []) {
    result.checked += 1;
    try {
      // A scheduled sweep is a one-off lookup for a missed webhook, not high-frequency polling.
      // MALIPOPAY documents the payment record as authoritative and available for reconciliation.
      const payment = await verifyProviderPayment(row.reference);
      const status = String(payment.status ?? "").toUpperCase();
      if (status === "SUCCESSFUL" || status === "PAID") {
        await processConfirmedCollection(row, row.reference);
        const { data: fresh } = await db.from("payments").select("status").eq("id", row.id).maybeSingle();
        if (fresh?.status === "paid_verified") result.confirmed += 1;
        else result.review += 1;
      } else if (status === "PARTIAL") {
        await markPaymentForReview(row, row.reference, "partial_payment_requires_manual_review");
        result.review += 1;
      } else if (["FAILED", "REJECTED", "CUSTOMER_REJECTED", "USER_REJECTED", "CANCELLED"].includes(status)) {
        await db.from("payments").update({
          status: "failed",
          provider_status: status,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id).eq("status", "awaiting_payment");
        await db.from("orders").update({ status: "payment_failed" })
          .eq("id", row.order_id).eq("status", "awaiting_payment");
        result.failed += 1;
      } else if (Date.now() - Date.parse(row.created_at) > 90_000) {
        // An unresolved collection past the USSD confirmation window is not inferred as paid.
        await markPaymentForReview(row, row.reference, "confirmation_window_elapsed_" + (status || "unknown"));
        result.review += 1;
      }
    } catch (error) {
      result.review += 1;
      await audit("malipopay_reconciliation_error", row.reference, {
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return result;
}
