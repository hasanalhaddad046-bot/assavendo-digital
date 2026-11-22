import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isFullSuccessfulCollection,
  normalizeMalipopayPhone,
  wholeTzsToMinor,
  verifyMalipopayWebhookSignature,
} from "../malipopay-utils.ts";

test("MALIPOPAY normalise et valide uniquement les numéros mobiles tanzaniens", () => {
  assert.equal(normalizeMalipopayPhone("+255 712 345 678"), "255712345678");
  assert.equal(normalizeMalipopayPhone("0712345678"), null);
  assert.equal(normalizeMalipopayPhone("+254712345678"), null);
  assert.equal(normalizeMalipopayPhone("25571234567"), null);
});

test("MALIPOPAY conserve les montants TZS entiers en unités mineures internes", () => {
  assert.equal(wholeTzsToMinor(25000), 2500000);
  assert.throws(() => wholeTzsToMinor(0));
  assert.throws(() => wholeTzsToMinor(1.25));
  assert.throws(() => wholeTzsToMinor(Number.MAX_SAFE_INTEGER));
});

test("MALIPOPAY ne confirme que le paiement intégral SUCCESSFUL ou PAID en TZS", () => {
  assert.equal(isFullSuccessfulCollection({
    status: "SUCCESSFUL", currency: "TZS", amount: 25000, paidAmount: 25000,
  }, 25000), true);
  assert.equal(isFullSuccessfulCollection({
    status: "PARTIAL", currency: "TZS", amount: 25000, paidAmount: 10000,
  }, 25000), false);
  assert.equal(isFullSuccessfulCollection({
    status: "SUCCESSFUL", currency: "USD", amount: 25000, paidAmount: 25000,
  }, 25000), false);
  assert.equal(isFullSuccessfulCollection({
    status: "PROCESSING", currency: "TZS", amount: 25000, paidAmount: 0,
  }, 25000), false);
  assert.equal(isFullSuccessfulCollection({
    status: "PAID", currency: "TZS", amount: 24999, paidAmount: 24999,
  }, 25000), false);
});

test("MALIPOPAY vérifie la signature HMAC-SHA256 sur le corps brut", () => {
  const secret = "webhook-test-secret";
  const raw = '{"reference":"ASV123","amount":25000}';
  const digest = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMalipopayWebhookSignature(raw, "sha256=" + digest, secret), true);
  assert.equal(verifyMalipopayWebhookSignature(raw, "sha256=" + "0".repeat(64), secret), false);
  assert.equal(verifyMalipopayWebhookSignature(raw + " ", "sha256=" + digest, secret), false);
  assert.equal(verifyMalipopayWebhookSignature(raw, null, secret), false);
});
