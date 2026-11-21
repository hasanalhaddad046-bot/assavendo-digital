import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOfferLandedCost, chooseBestLandedOffer } from "../landed-cost.ts";
import type { FxSnapshot } from "../fx-math.ts";

const fx: FxSnapshot = {
  rates: { USD: 1, CNY: 7.2, TZS: 2500, EUR: 0.92 },
  sources: { USD: "identity", CNY: "frankfurter", TZS: "er-api", EUR: "frankfurter" },
  fetchedAt: Date.now(),
  fresh: true,
  sourceMetadata: {},
};

test("coût rendu convertit la devise source et ajoute les coûts de préparation sans double compter les frais inclus", () => {
  const result = calculateOfferLandedCost({
    offerId: "offer-a",
    priceMinor: 7200,
    currency: "CNY",
    moq: 10,
    components: [
      { kind: "packaging", label: "Packing", amount_minor: 3600, currency: "CNY", per_unit: false, included_in_supplier_price: false, cost_stage: "supplier" },
      { kind: "insurance", label: "Insurance", amount_minor: 500, currency: "CNY", per_unit: true, included_in_supplier_price: false, cost_stage: "export" },
      { kind: "other", label: "Included cost", amount_minor: 900, currency: "CNY", per_unit: true, included_in_supplier_price: true, cost_stage: "supplier" },
    ],
  }, fx, 90, 5);
  assert.ok(!("error" in result));
  assert.equal(result.sourceUnitPriceUsd, 10);
  assert.ok(Math.abs(result.componentsUsd - 1.1944444444) < 0.0001);
  assert.ok(Math.abs(result.landedCostUsd - 11.1944444444) < 0.0001);
  assert.ok(result.qualityAdjustedCostUsd > result.landedCostUsd);
});

test("coût rendu choisit le palier correspondant à la MOQ et garde le montant source", () => {
  const result = calculateOfferLandedCost({
    offerId: "offer-tier",
    priceMinor: 7200,
    currency: "CNY",
    moq: 10,
    tiers: [
      { min_qty: 1, max_qty: 9, price_minor: 7200, currency: "CNY" },
      { min_qty: 10, max_qty: 49, price_minor: 6480, currency: "CNY" },
    ],
  }, fx, 100, 5);
  assert.ok(!("error" in result));
  assert.equal(result.sourceUnitPriceMinor, 6480);
  assert.equal(result.sourceCurrency, "CNY");
  assert.equal(result.sourceUnitPriceUsd, 9);
});

test("coût rendu refuse un FX périmé et un taux absent", () => {
  const stale = { ...fx, fresh: false };
  const failed = calculateOfferLandedCost({ offerId: "x", priceMinor: 100, currency: "CNY", moq: 1 }, stale, null, 0);
  assert.ok("error" in failed && failed.error === "missing_fx");
  const noRate = calculateOfferLandedCost({ offerId: "x", priceMinor: 100, currency: "CAD", moq: 1 }, fx, null, 0);
  assert.ok("error" in noRate && noRate.error === "missing_fx");
});

test("sélection du fournisseur compare le coût rendu ajusté, puis la priorité", () => {
  const a = calculateOfferLandedCost({ offerId: "a", priceMinor: 7200, currency: "CNY", moq: 1 }, fx, 40, 5);
  const b = calculateOfferLandedCost({ offerId: "b", priceMinor: 7300, currency: "CNY", moq: 1 }, fx, 100, 5);
  assert.ok(!("error" in a) && !("error" in b));
  const picked = chooseBestLandedOffer([
    { priority: 1, result: a, isPreferred: false },
    { priority: 100, result: b, isPreferred: true },
  ]);
  assert.equal(picked?.result.offerId, "b");
});

