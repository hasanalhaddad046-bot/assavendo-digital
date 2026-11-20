import { test } from "node:test";
import assert from "node:assert/strict";
import { salePriceUsd, isPricingError } from "../pricing.ts";
import { toMinor, toMajor, roundUpStep } from "../money.ts";
import { scoreRisk, decideRisk } from "../risk.ts";

test("prix : marge réelle = marge cible sur le prix de vente", () => {
  const r = salePriceUsd({ fixedCostsUsd: 70, marginPct: 30, feePct: 3.8, reservePct: 3 });
  assert.ok(!isPricingError(r));
  assert.equal(r.priceUsd, 110.76);
  assert.equal(r.marginRealPct, 30);
});

test("prix : frais de paiement manquants bloquent la publication", () => {
  const r = salePriceUsd({ fixedCostsUsd: 70, marginPct: 30, feePct: null });
  assert.ok(isPricingError(r) && r.error === "fee_missing");
});

test("prix : dénominateur invalide refusé", () => {
  const r = salePriceUsd({ fixedCostsUsd: 10, marginPct: 90, feePct: 5, reservePct: 5 });
  assert.ok(isPricingError(r) && r.error === "bad_denominator");
});

test("prix : bénéfice minimum respecté", () => {
  const r = salePriceUsd({ fixedCostsUsd: 5, marginPct: 10, feePct: 3, minProfitUsd: 4 });
  assert.ok(!isPricingError(r));
  assert.ok(r.profitUsd >= 3.99);
});

test("argent : unités mineures et arrondi commercial", () => {
  assert.equal(toMinor(14.29, "USD"), 1429);
  assert.equal(toMinor(500, "JPY"), 500);
  assert.equal(toMajor(1429, "USD"), 14.29);
  assert.equal(roundUpStep(251_234, 100), 251_300);
});

test("risque : un VPN seul ne bloque jamais", () => {
  const s = { anonymizer: true, anonymizerConfidence: 90 };
  const d = decideRisk(scoreRisk(s), s, "challenge");
  assert.equal(d.action, "log");
});

test("risque : faisceau de signaux -> revue ou blocage selon politique", () => {
  const s = { anonymizer: true, anonymizerConfidence: 95, ipCountry: "US", shipCountry: "TZ", paymentAttempts: 4, ordersLastHour: 3 };
  assert.equal(decideRisk(scoreRisk(s), s, "challenge").action, "manual_review");
  assert.equal(decideRisk(scoreRisk(s), s, "checkout_block").action, "block_checkout");
});

test("risque : strict_site_block bloque un VPN à haute confiance (mode déconseillé)", () => {
  const s = { anonymizer: true, anonymizerConfidence: 90 };
  assert.equal(decideRisk(scoreRisk(s), s, "strict_site_block").action, "block_site");
});
