import { test } from "node:test";
import assert from "node:assert/strict";
import { toUsd, usdToLocal, type FxSnapshot } from "../fx-math.ts";

const fresh: FxSnapshot = {
  rates: { USD: 1, CNY: 7.2, TZS: 2500, EUR: 0.92 },
  sources: { USD: "identity", CNY: "frankfurter", TZS: "er-api", EUR: "frankfurter" },
  fetchedAt: Date.UTC(2026, 10, 21),
  fresh: true,
  sourceMetadata: { date: "2026-11-21" },
};

test("FX: préserve le montant source CNY et convertit correctement en USD", () => {
  assert.equal(toUsd(fresh, 7200, "CNY"), 1000);
});

test("FX: refuse les taux périmés, absents, nuls et les montants invalides", () => {
  assert.equal(toUsd({ ...fresh, fresh: false }, 10, "CNY"), null);
  assert.equal(toUsd(fresh, 10, "XXX"), null);
  assert.equal(toUsd({ ...fresh, rates: { USD: 1, CNY: 0 } }, 10, "CNY"), null);
  assert.equal(toUsd(fresh, -1, "USD"), null);
  assert.equal(toUsd(fresh, Number.NaN, "USD"), null);
});

test("FX: TZS affiche une conversion arrondie à l'unité locale et conserve la provenance", () => {
  const result = usdToLocal(fresh, 10, "TZS", { marginPct: 0 });
  assert.deepEqual(result, {
    amount: 25000,
    currency: "TZS",
    rate: 2500,
    fetchedAt: fresh.fetchedAt,
    source: "er-api",
  });
});

test("FX: la marge d'affichage est bornée et le taux ne peut pas être inventé", () => {
  assert.equal(usdToLocal(fresh, 10, "TZS", { marginPct: 101 }), null);
  assert.equal(usdToLocal({ ...fresh, fresh: false }, 10, "TZS"), null);
  assert.equal(usdToLocal(fresh, 10, "XXX"), null);
});
