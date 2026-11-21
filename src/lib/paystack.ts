import crypto from "node:crypto";
import { supabaseAdmin, getSettings, audit } from "./supabase";
import { queueEmail, siteUrl } from "./mail";
import { dispatchWorkflowEvent } from "./workflow-service";

const API = "https://api.paystack.co";

function secret(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? "";
}

export function canCharge(settings: Record<string, string>, isDropshipping = true): boolean {
  if (!isDropshipping) return true;
  return settings.paystack_dropshipping_status === "approved"
    && (settings.paystack_approval_proof ?? "").trim().length > 0;
}

function secureHexEqual(expected: string, actual: string | null): boolean {
  if (!actual || !/^[a-f0-9]{128}$/i.test(expected) || !/^[a-f0-9]{128}$/i.test(actual)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** New Paystack-Signature header uses a dedicated webhook secret; legacy X header uses the API secret. */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  headerName: string = "x-paystack-signature",
): boolean {
  const normalized = headerName.toLowerCase();
  const key = normalized === "paystack-signature"
    ? process.env.PAYSTACK_WEBHOOK_SECRET ?? ""
    : secret();
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha512", key).update(rawBody, "utf8").digest("hex");
  return secureHexEqual(expected, signature.trim());
}

type PaystackResponse<T> = { status?: boolean; data?: T; message?: string };

async function call<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const key = secret();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY non définie.");
  const response = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => null) as PaystackResponse<T> | null;
  if (!response.ok || !json?.status || !json.data) {
    throw new Error(json?.message || `Réponse Paystack invalide (HTTP ${response.status}).`);
  }
  return json.data;
}

export interface PaymentInit {
  orderId: string;
  email: string;
  amountMinor: number;
  currency: string;
  fxSnapshot?: unknown;
}

export async function initializePayment(p: PaymentInit): Promise<{ reference: string; authorizationUrl: string }> {
  const settings = await getSettings();
  if (!canCharge(settings, true)) {
    throw new Error("LOCKED: autorisation écrite de Paystack requise avant tout encaissement.");
  }
  if (!secret()) throw new Error("PAYSTACK_SECRET_KEY non définie.");
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) {
    throw new Error("Montant de paiement invalide.");
  }

  const currency = p.currency.toUpperCase();
  const allowed = (settings.paystack_currencies || "USD,KES")
    .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (!allowed.includes(currency)) throw new Error(`Devise non activée sur le compte : ${currency}`);

  const reference = `ASV-${crypto.randomBytes(16).toString("hex")}`;
  const db = supabaseAdmin();
  const { error: paymentError } = await db.from("payments").insert({
    order_id: p.orderId,
    reference,
    amount_minor: p.amountMinor,
    currency,
    fx_snapshot: p.fxSnapshot ?? null,
    status: "awaiting_payment",
    provider_status: "initialized",
  });
  if (paymentError) throw new Error("Enregistrement du paiement impossible.");

  try {
    const data = await call<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>("POST", "/transaction/initialize", {
      email: p.email,
      amount: p.amountMinor,
      currency,
      reference,
      metadata: { order_id: p.orderId, platform: "assavendo-digital" },
      callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/commande-recue`,
    });
    if (data.reference !== reference || !data.authorization_url) {
      throw new Error("Réponse d'initialisation Paystack incohérente.");
    }
    return { reference, authorizationUrl: data.authorization_url };
  } catch (error) {
    await db.from("payments").update({
      status: "init_failed",
      provider_status: "initialization_failed",
      updated_at: new Date().toISOString(),
    }).eq("reference", reference).eq("status", "awaiting_payment");
    throw error;
  }
}

export async function persistWebhookEvent(
  eventKey: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin().from("webhook_events").insert({
    event_key: eventKey,
    event_type: eventType,
    payload,
    status: "received",
    attempt_count: 0,
  });
  if (error && error.code !== "23505") {
    throw new Error(`Webhook persistence failed: ${error.message}`);
  }
}

export async function claimWebhookEvent(
  eventKey: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("claim_webhook_event", {
    p_event_key: eventKey,
    p_event_type: eventType,
    p_payload: payload,
  });
  if (error) throw new Error(`Webhook claim failed: ${error.message}`);
  return data === true;
}

export async function finishWebhookEvent(
  eventKey: string,
  status: "processed" | "failed" | "received",
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabaseAdmin().rpc("finish_webhook_event", {
    p_event_key: eventKey,
    p_status: status,
    p_error: errorMessage ?? null,
  });
  if (error) throw new Error(`Webhook acknowledgement failed: ${error.message}`);
}

type ProviderTransaction = {
  id?: number | string;
  status?: string;
  reference?: string;
  amount?: number | string;
  currency?: string;
  paid_at?: string;
  channel?: string;
  fees?: number;
  metadata?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function createPurchaseDrafts(orderId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: order, error: orderError } = await db.from("orders")
    .select("number,ship_address,ship_country,status")
    .eq("id", orderId).maybeSingle();
  if (orderError || !order || !["paid_verified", "manual_review", "processing"].includes(order.status)) return;

  const { data: lines, error: lineError } = await db.from("order_items")
    .select("id,product_id,qty,unit_usd_minor,offer_snapshot,variant_id")
    .eq("order_id", orderId);
  if (lineError || !lines?.length) return;

  const productIds = [...new Set(lines.map((line) => line.product_id))];
  const { data: products } = await db.from("products").select("id,kind").in("id", productIds);
  const productKinds = new Map((products ?? []).map((product) => [product.id, product.kind]));

  const groups = new Map<string, {
    supplierId: string | null;
    agencyId: string | null;
    fulfilmentMode: string;
    items: typeof lines;
  }>();

  for (const line of lines) {
    const kind = productKinds.get(line.product_id);
    if (kind === "service") {
      const { data: existing } = await db.from("service_tasks")
        .select("id").eq("order_item_id", line.id).maybeSingle();
      if (!existing) {
        await db.from("service_tasks").insert({ order_item_id: line.id, status: "awaiting_brief" });
      }
      continue;
    }
    if (kind === "digital") {
      const { data: asset } = await db.from("digital_assets").select("id,access_days,max_downloads")
        .eq("product_id", line.product_id).eq("active", true).eq("scan_status", "clean")
        .in("distribution_rights", ["owned", "licensed", "authorized"])
        .maybeSingle();
      if (asset) {
        await db.from("digital_deliveries").upsert({
          order_id: orderId,
          order_item_id: line.id,
          asset_id: asset.id,
          status: "available",
          max_downloads: asset.max_downloads ?? 5,
          expires_at: new Date(Date.now() + Math.max(1, Number(asset.access_days ?? 30)) * 86_400_000).toISOString(),
        }, { onConflict: "order_item_id", ignoreDuplicates: true });
      } else {
        await db.from("order_events").upsert({
          order_id: orderId,
          kind: "digital_rights_review",
          event_key: `digital-rights-missing:${line.id}`,
          message: "Le produit numérique est payé mais aucun fichier autorisé et contrôlé n'est prêt. Livraison suspendue pour vérification.",
          is_public: false,
        }, { onConflict: "event_key", ignoreDuplicates: true });
      }
      continue;
    }

    const snapshot = (line.offer_snapshot ?? {}) as Record<string, unknown>;
    const supplierId = typeof snapshot.supplier_id === "string" ? snapshot.supplier_id : null;
    const agencyId = typeof snapshot.agency_id === "string" ? snapshot.agency_id : null;
    const mode = typeof snapshot.fulfilment_mode === "string" ? snapshot.fulfilment_mode : "C";
    const safeMode = ["A", "B", "C"].includes(mode) ? mode : "C";
    const groupKey = [supplierId ?? "UNASSIGNED", safeMode, agencyId ?? "NO_AGENCY"].join(":");
    const group = groups.get(groupKey) ?? {
      supplierId,
      agencyId,
      fulfilmentMode: safeMode,
      items: [],
    };
    group.items.push(line);
    groups.set(groupKey, group);
  }

  for (const [groupKey, group] of groups) {
    const digest = crypto.createHash("sha256").update(groupKey).digest("hex").slice(0, 10).toUpperCase();
    const reference = `ASV-PO-${String(order.number ?? orderId.slice(0, 8))}-${digest}`;
    let deliveryAddress: Record<string, unknown> | null = null;
    let draftNotes = "Brouillon créé après confirmation du paiement. Aucun achat ni paiement fournisseur n'a été exécuté.";
    let status: "draft" | "pending_approval" = "draft";

    if (group.fulfilmentMode === "A") {
      // Direct supplier -> customer: this is the only mode where the supplier receives the customer address.
      deliveryAddress = order.ship_address as Record<string, unknown>;
      draftNotes += " Mode A (direct) : vérifier l'adresse client et l'accord de livraison directe avant approbation.";
    } else if (group.fulfilmentMode === "B" && group.agencyId) {
      const { data: agency } = await db.from("agencies").select(
        "id,name,city,country,address_local,address_latin,contact,active",
      ).eq("id", group.agencyId).eq("active", true).maybeSingle();
      if (agency && agency.address_local && agency.address_latin) {
        // Supplier sees only the warehouse destination and code, never the final customer address.
        deliveryAddress = {
          kind: "agency_warehouse",
          agency_id: agency.id,
          agency_name: agency.name,
          city: agency.city,
          country: agency.country,
          address_local: agency.address_local,
          address_latin: agency.address_latin,
          contact: agency.contact,
          receiving_code: reference,
        };
        draftNotes += " Mode B : destination agence uniquement. L'adresse du client final reste réservée à la réexpédition interne.";
      } else {
        status = "pending_approval";
        draftNotes += " Blocage : agence absente, inactive ou adresse bilingue non vérifiée. Ne pas communiquer l'adresse client au fournisseur.";
      }
    } else if (group.fulfilmentMode === "B") {
      status = "pending_approval";
      draftNotes += " Blocage : aucune agence/entrepôt n'est configuré pour cette offre. Adresse client non transmise au fournisseur.";
    } else {
      status = "pending_approval";
      draftNotes += " Mode C : centre ou instructions du prestataire non configurés. Destination à confirmer manuellement, aucune adresse client transmise.";
    }

    const currencies = new Set(group.items.map((item) => {
      const snapshot = item.offer_snapshot as Record<string, unknown> | null;
      return typeof snapshot?.currency === "string" ? snapshot.currency.toUpperCase() : "USD";
    }));
    const sourceCurrency = currencies.size === 1 ? [...currencies][0] : null;
    const { error: purchaseError } = await db.from("purchase_orders").upsert({
      order_id: orderId,
      supplier_id: group.supplierId,
      agency_id: group.agencyId,
      purchase_reference: reference,
      status,
      source_currency: sourceCurrency,
      delivery_address: deliveryAddress,
      supplier_instructions: group.fulfilmentMode === "B"
        ? "Expédier uniquement vers l'entrepôt Assavendo indiqué ci-dessus. Ne pas inclure d'adresse client ni de contact client."
        : null,
      internal_notes: draftNotes,
    }, { onConflict: "purchase_reference", ignoreDuplicates: true });

    const { data: purchase } = await db.from("purchase_orders").select("id,status,delivery_address")
      .eq("purchase_reference", reference).maybeSingle();
    if (purchaseError || !purchase) {
      await audit("purchase_draft_failed", orderId, {
        reference,
        group: groupKey,
        error: purchaseError?.message ?? "purchase row missing",
      });
      continue;
    }
    // Repair a pending draft if the agency address was completed after payment.
    if (deliveryAddress && !isRecord(purchase.delivery_address)) {
      await db.from("purchase_orders").update({
        agency_id: group.agencyId,
        delivery_address: deliveryAddress,
        status: purchase.status === "pending_approval" ? "draft" : purchase.status,
        supplier_instructions: group.fulfilmentMode === "B"
          ? "Expédier uniquement vers l'entrepôt Assavendo indiqué ci-dessus. Ne pas inclure d'adresse client ni de contact client."
          : null,
        updated_at: new Date().toISOString(),
      }).eq("id", purchase.id);
    }

    const rows = group.items.map((item) => {
      const snapshot = (item.offer_snapshot ?? {}) as Record<string, unknown>;
      const sourcePrice = Number(snapshot.price_minor ?? 0);
      const sourceCurrency = typeof snapshot.currency === "string" ? snapshot.currency.toUpperCase() : "USD";
      return {
        purchase_order_id: purchase.id,
        order_item_id: item.id,
        offer_id: typeof snapshot.id === "string" ? snapshot.id : null,
        variant_id: typeof item.variant_id === "string" ? item.variant_id : null,
        supplier_sku: typeof snapshot.supplier_sku === "string" ? snapshot.supplier_sku : null,
        supplier_product_url: typeof snapshot.source_url === "string" ? snapshot.source_url : null,
        variant_snapshot: {
          variant_id: item.variant_id,
          variant: snapshot.variant ?? null,
          supplier_sku: snapshot.supplier_sku ?? null,
        },
        source_offer_snapshot: snapshot,
        fulfilment_mode: group.fulfilmentMode,
        agency_id: group.agencyId,
        qty: Number(item.qty),
        source_unit_price_minor: Number.isSafeInteger(sourcePrice) ? sourcePrice : Number(item.unit_usd_minor),
        source_currency: sourceCurrency,
        total_usd_minor: Number(item.unit_usd_minor) * Number(item.qty),
      };
    });

    const { error: itemsError } = await db.from("purchase_order_items")
      .upsert(rows, { onConflict: "purchase_order_id,order_item_id", ignoreDuplicates: true });
    if (itemsError) {
      await db.from("purchase_orders").update({
        status: "disputed",
        internal_notes: `${draftNotes} Erreur de génération des lignes : ${itemsError.message.slice(0, 300)}`,
      }).eq("id", purchase.id);
      continue;
    }
    await db.from("order_items").update({ purchase_status: "draft_purchase" })
      .in("id", group.items.map((item) => item.id));

    if (group.fulfilmentMode === "B" && deliveryAddress) {
      // The supplier only receives the Chinese agency warehouse address.
      await db.from("shipment_packages").upsert({
        order_id: orderId,
        agency_id: group.agencyId,
        stage: "supplier_to_agency",
        status: "pending",
        destination_address: deliveryAddress,
        package_reference: "ASV-PKG-" + digest + "-IN",
        notes: "Adresse fournisseur = entrepôt agence uniquement. Pas d'adresse client final.",
      }, { onConflict: "package_reference", ignoreDuplicates: true });
    } else if (group.fulfilmentMode === "A" && deliveryAddress) {
      await db.from("shipment_packages").upsert({
        order_id: orderId,
        stage: "supplier_direct",
        status: "pending",
        destination_address: deliveryAddress,
        package_reference: "ASV-PKG-" + digest + "-DIRECT",
        notes: "Expédition directe fournisseur vers le client. Communication de l'adresse après approbation humaine.",
      }, { onConflict: "package_reference", ignoreDuplicates: true });
    }
  }

  await db.from("order_events").upsert({
    order_id: orderId,
    kind: "purchase_drafts_ready",
    event_key: `purchase-drafts-ready:${orderId}`,
    message: "Les brouillons d'achat sont créés. Chaque achat exige une approbation humaine avant toute commande ou dépense.",
    is_public: false,
  }, { onConflict: "event_key", ignoreDuplicates: true });
}
async function ensurePaidSideEffects(orderId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders")
    .select("id,email,public_token,number,total_usd_minor,status")
    .eq("id", orderId).maybeSingle();
  if (!order) return;

  if (order.status === "awaiting_payment" || order.status === "payment_failed") {
    await db.from("orders").update({
      status: "paid_verified",
      paid_at: new Date().toISOString(),
    }).eq("id", orderId).in("status", ["awaiting_payment", "payment_failed"]);
  }
  const { data: invoice } = await db.rpc("assign_invoice_number", { p_order: orderId });
  await createPurchaseDrafts(orderId);

  await db.from("order_events").upsert({
    order_id: orderId,
    kind: "paid",
    event_key: `payment_verified:${orderId}`,
    message: "Paiement confirmé par Paystack. Les brouillons d'approvisionnement sont prêts pour validation.",
  }, { onConflict: "event_key", ignoreDuplicates: true });

  if (order.email) {
    const { data: digitalDeliveries } = await db.from("digital_deliveries")
      .select("id,status").eq("order_id", orderId).eq("status", "available");
    const downloadLinks = (digitalDeliveries ?? []).map((delivery) =>
      `Téléchargement sécurisé (5 accès maximum, lien lié à cette commande) : ${siteUrl()}/api/digital/download?order=${encodeURIComponent(order.public_token)}&delivery=${encodeURIComponent(delivery.id)}`
    );
    await queueEmail({
      to: order.email,
      orderId,
      idempotencyKey: `payment-confirmed:${orderId}`,
      subject: "Assavendo Digital — paiement confirmé",
      body: "Merci, votre paiement est confirmé.\n\n" +
        `Suivi de commande : ${siteUrl()}/suivi/${order.public_token}\n` +
        `Facture : ${siteUrl()}/facture/${order.public_token}\n` +
        (invoice ? `Facture numéro : ${invoice}\n` : "") +
        (downloadLinks.length ? "\nProduits numériques :\n" + downloadLinks.join("\n") + "\n" : ""),
    });
  }
}

export async function processVerifiedPayment(reference: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: row, error } = await db.from("payments")
    .select("id,order_id,amount_minor,currency,status")
    .eq("reference", reference).maybeSingle();
  if (error) throw new Error(`Lecture paiement impossible: ${error.message}`);
  if (!row) {
    await audit("payment_unknown_reference", reference);
    return;
  }
  if (row.status === "paid_verified") {
    await ensurePaidSideEffects(row.order_id);
    const { data: existingOrder } = await db.from("orders").select("status,total_usd_minor,ship_country,risk_score")
      .eq("id",row.order_id).maybeSingle();
    if (existingOrder && existingOrder.status !== "manual_review") {
      try {
        await dispatchWorkflowEvent(db,"payment_verified",{
          order_id:row.order_id,payment_status:"paid_verified",order_status:existingOrder.status,
          total_usd_minor:existingOrder.total_usd_minor,ship_country:existingOrder.ship_country,
          risk_score:existingOrder.risk_score,event_type:"payment_verified",
        },`payment-verified:${row.order_id}`);
      } catch(error) { console.error("Workflow dispatch failed after verified payment",error); }
    }
    return;
  }

  const transaction = await call<ProviderTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  if (transaction.reference !== reference) {
    await db.from("payments").update({ status: "manual_review", provider_status: "reference_mismatch" }).eq("id", row.id);
    await db.from("orders").update({ status: "manual_review" }).eq("id", row.order_id);
    await audit("payment_reference_mismatch", reference);
    return;
  }

  if (transaction.status !== "success") {
    const failedState = ["failed", "abandoned", "reversed"].includes(String(transaction.status));
    await db.from("payments").update({
      status: failedState ? String(transaction.status) : "manual_review",
      provider_status: String(transaction.status ?? "unknown"),
      provider_transaction_id: transaction.id ? String(transaction.id) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("status", "awaiting_payment");
    if (failedState) {
      await db.from("orders").update({ status: "payment_failed" }).eq("id", row.order_id).eq("status", "awaiting_payment");
    } else {
      await db.from("orders").update({ status: "manual_review" }).eq("id", row.order_id);
    }
    return;
  }

  const amount = Number(transaction.amount);
  const currency = String(transaction.currency ?? "").toUpperCase();
  const { data: order } = await db.from("orders")
    .select("total_usd_minor,status").eq("id", row.order_id).maybeSingle();
  if (
    !Number.isSafeInteger(amount) ||
    amount !== Number(row.amount_minor) ||
    amount !== Number(order?.total_usd_minor) ||
    currency !== String(row.currency).trim().toUpperCase()
  ) {
    await db.from("payments").update({
      status: "manual_review",
      provider_status: "amount_or_currency_mismatch",
      provider_transaction_id: transaction.id ? String(transaction.id) : null,
      provider_payload: { id: transaction.id, status: transaction.status, amount, currency },
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).neq("status", "paid_verified");
    await db.from("orders").update({ status: "manual_review" }).eq("id", row.order_id).neq("status", "paid_verified");
    await audit("payment_mismatch", reference, {
      provider: { amount, currency },
      expected: { amount: row.amount_minor, currency: row.currency, order: order?.total_usd_minor },
    });
    return;
  }

  const { data: changed, error: updateError } = await db.from("payments")
    .update({
      status: "paid_verified",
      provider_status: "success",
      provider_transaction_id: transaction.id ? String(transaction.id) : null,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provider_payload: {
        id: transaction.id,
        status: transaction.status,
        reference: transaction.reference,
        amount,
        currency,
        paid_at: transaction.paid_at,
        channel: transaction.channel,
        fees: transaction.fees,
      },
    })
    .eq("id", row.id)
    .eq("status", "awaiting_payment")
    .select("id");
  if (updateError) throw new Error(`Mise à jour paiement impossible: ${updateError.message}`);

  if (!changed?.length) {
    const { data: fresh } = await db.from("payments").select("status").eq("id", row.id).maybeSingle();
    if (fresh?.status !== "paid_verified") return;
  }
  await ensurePaidSideEffects(row.order_id);
  await audit("payment_verified", reference, { order_id: row.order_id, provider_id: transaction.id ?? null });
  const { data: verifiedOrder } = await db.from("orders")
    .select("status,total_usd_minor,ship_country,risk_score").eq("id",row.order_id).maybeSingle();
  if (verifiedOrder && verifiedOrder.status !== "manual_review") {
    try {
      await dispatchWorkflowEvent(db,"payment_verified",{
        order_id:row.order_id,payment_status:"paid_verified",order_status:verifiedOrder.status,
        total_usd_minor:verifiedOrder.total_usd_minor,ship_country:verifiedOrder.ship_country,
        risk_score:verifiedOrder.risk_score,event_type:"payment_verified",
      },`payment-verified:${row.order_id}`);
    } catch(error) { console.error("Workflow dispatch failed after verified payment",error); }
  }
}

async function processPaymentFailure(data: Record<string, unknown>): Promise<void> {
  const reference = String(data.reference ?? "");
  if (!reference) return;
  const db = supabaseAdmin();
  const { data: payment } = await db.from("payments").select("id,order_id,status").eq("reference", reference).maybeSingle();
  if (!payment || payment.status === "paid_verified") return;
  const providerStatus = String(data.status ?? "failed");
  await db.from("payments").update({
    status: providerStatus === "abandoned" ? "abandoned" : "failed",
    provider_status: providerStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", payment.id).neq("status", "paid_verified");
  await db.from("orders").update({ status: "payment_failed" })
    .eq("id", payment.order_id).eq("status", "awaiting_payment");
  await audit("payment_failed", reference, { provider_status: providerStatus });
}

async function processRefundWebhook(event: string, data: Record<string, unknown>): Promise<void> {
  const transactionReference = String(data.transaction_reference ?? data.reference ?? "");
  const refundReference = data.refund_reference ? String(data.refund_reference) : null;
  const statusMap: Record<string, string> = {
    "refund.pending": "pending",
    "refund.processing": "processing",
    "refund.needs-attention": "needs_attention",
    "refund.failed": "failed",
    "refund.processed": "processed",
  };
  const status = statusMap[event];
  if (!status || !transactionReference) return;
  const amount = Number(data.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Payload Paystack de remboursement sans montant valide.");
  }
  const { data: refundId, error } = await supabaseAdmin().rpc("apply_refund_provider_status", {
    p_transaction_reference: transactionReference,
    p_refund_reference: refundReference,
    p_status: status,
    p_amount_minor: amount,
    p_provider_payload: { event, status, amount, currency: data.currency ?? null, refund_reference: refundReference },
    p_error: status === "failed" ? "Paystack a signalé l'échec du remboursement." : null,
  });
  if (error) throw new Error(`Mise à jour remboursement impossible: ${error.message}`);
  if (!refundId) {
    await audit("refund_webhook_unmatched", transactionReference, { event, refundReference, amount });
    return;
  }
  const db = supabaseAdmin();
  const { data: refund } = await db.from("refunds")
    .select("id,rma_id,amount_minor,currency,status")
    .eq("id", refundId).maybeSingle();
  if (refund) {
    const { data: rma } = await db.from("rma_requests")
      .select("order_id").eq("id", refund.rma_id).maybeSingle();
    if (rma?.order_id) {
      await db.from("order_events").upsert({
        order_id: rma.order_id,
        kind: `refund_${status}`,
        event_key: `refund:${refund.id}:${status}`,
        message: status === "processed"
          ? "Le remboursement a été confirmé par Paystack."
          : status === "failed"
            ? "Paystack n'a pas pu effectuer le remboursement. Notre équipe doit vérifier le dossier."
            : "Le remboursement est en cours de traitement par Paystack.",
      }, { onConflict: "event_key", ignoreDuplicates: true });
      const { data: order } = await db.from("orders").select("email").eq("id", rma.order_id).maybeSingle();
      if (order?.email) {
        await queueEmail({
          to: order.email,
          orderId: rma.order_id,
          idempotencyKey: `refund:${refund.id}:${status}`,
          subject: "Assavendo Digital — suivi de remboursement",
          body: status === "processed"
            ? "Paystack a confirmé le traitement de votre remboursement. Le délai d'apparition sur votre compte dépend de votre banque."
            : status === "failed"
              ? "Le prestataire nous a signalé un problème sur le remboursement. Notre équipe vérifie la situation."
              : "Votre demande de remboursement est en cours de traitement par le prestataire de paiement.",
        });
      }
    }
  }
  await audit("refund_provider_status", String(refundId), { event, status });
}

export async function handlePaystackEvent(
  eventKey: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ claimed: boolean }> {
  const claimed = await claimWebhookEvent(eventKey, event, payload);
  if (!claimed) return { claimed: false };

  try {
    const data = (payload.data && typeof payload.data === "object")
      ? payload.data as Record<string, unknown>
      : {};
    if (event === "charge.success") {
      const reference = String(data.reference ?? "");
      if (!reference) throw new Error("Webhook charge.success sans référence.");
      await processVerifiedPayment(reference);
    } else if (event === "charge.failed") {
      await processPaymentFailure(data);
    } else if (event.startsWith("refund.")) {
      await processRefundWebhook(event, data);
    } else if (event === "transfer.success" || event === "transfer.failed" || event === "transfer.reversed") {
      await audit("paystack_transfer_event", String(data.reference ?? data.id ?? ""), { event, status: data.status ?? null });
    } else {
      await audit("paystack_event_ignored", event, { event_key: eventKey });
    }
    await finishWebhookEvent(eventKey, "processed");
    return { claimed: true };
  } catch (error) {
    await finishWebhookEvent(eventKey, "failed", String(error).slice(0, 1000));
    throw error;
  }
}

/** Request a provider refund. The RMA remains refund_pending until refund.processed webhook. */
export async function refundPayment(p: {
  reference: string;
  rmaId: string;
  amountMinor: number;
  currency: string;
  merchantNote?: string;
}): Promise<{ requestReference: string; providerReference: string | null; status: string }> {
  if (!secret()) throw new Error("PAYSTACK_SECRET_KEY non définie.");
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) throw new Error("Montant de remboursement invalide.");
  const currency = p.currency.toUpperCase();
  const requestReference = `ASVR-${crypto.randomBytes(15).toString("hex")}`;
  const db = supabaseAdmin();
  const { data: reservedId, error: reserveError } = await db.rpc("reserve_refund", {
    p_payment_reference: p.reference,
    p_rma_id: p.rmaId,
    p_amount_minor: p.amountMinor,
    p_request_reference: requestReference,
  });
  if (reserveError || !reservedId) throw new Error(reserveError?.message || "Réservation du remboursement impossible.");

  try {
    const result = await call<{
      id?: number | string;
      reference?: string;
      refund_reference?: string;
      status?: string;
      amount?: number;
    }>("POST", "/refund", {
      transaction: p.reference,
      amount: p.amountMinor,
      currency,
      reference: requestReference,
      merchant_note: p.merchantNote ?? "Refund requested by Assavendo Digital.",
    });
    const providerReference = result.refund_reference || result.reference || requestReference;
    const status = ["pending", "processing", "needs_attention", "processed", "failed"].includes(String(result.status))
      ? String(result.status)
      : "pending";
    const { error: updateError } = await db.from("refunds").update({
      provider_reference: providerReference,
      status,
      provider_payload: {
        id: result.id ?? null,
        reference: result.reference ?? null,
        refund_reference: result.refund_reference ?? null,
        status,
        amount: result.amount ?? p.amountMinor,
      },
      updated_at: new Date().toISOString(),
      processed_at: status === "processed" ? new Date().toISOString() : null,
    }).eq("id", reservedId);
    if (updateError) throw new Error(`Remboursement initié mais suivi local impossible: ${updateError.message}`);

    if (status === "processed" || status === "failed" || status === "needs_attention") {
      const { error: stateError } = await db.rpc("apply_refund_provider_status", {
        p_transaction_reference: p.reference,
        p_refund_reference: providerReference,
        p_status: status,
        p_amount_minor: p.amountMinor,
        p_provider_payload: { id: result.id ?? null, status, amount: result.amount ?? p.amountMinor },
        p_error: status === "failed" ? "Paystack a retourné failed lors de la demande." : null,
      });
      if (stateError) throw new Error(`État Paystack non réconcilié: ${stateError.message}`);
    }
    await audit("refund_requested", p.reference, {
      rma_id: p.rmaId, amount_minor: p.amountMinor, currency, request_reference: requestReference, status,
    });
    return { requestReference, providerReference, status };
  } catch (error) {
    // The provider may have accepted the request even if the network response was lost.
    // Keep the reservation blocked and flag it for manual reconciliation; never retry blindly.
    await db.from("refunds").update({
      status: "needs_attention",
      last_error: String(error).slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", reservedId).in("status", ["pending", "processing"]);
    await audit("refund_needs_reconciliation", p.reference, { rma_id: p.rmaId, error: String(error).slice(0, 300) });
    throw new Error("Le résultat du remboursement est incertain. Vérification manuelle Paystack requise avant toute nouvelle tentative.");
  }
}
