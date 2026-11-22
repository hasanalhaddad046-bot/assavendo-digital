import test from "node:test";
import assert from "node:assert/strict";
import { estimateAiCostUsdMicro } from "../ai-usage.ts";

test("AI cost uses configured input/output rates in USD micro-units", () => {
  assert.equal(estimateAiCostUsdMicro(1000, 500, 2, 8), 6000);
});

test("AI cost is unknown when either model tariff is absent", () => {
  assert.equal(estimateAiCostUsdMicro(1000, 500, 2, null), null);
  assert.equal(estimateAiCostUsdMicro(1000, 500, null, 8), null);
});

test("AI cost refuses invalid token counts and negative prices", () => {
  assert.equal(estimateAiCostUsdMicro(-1, 500, 2, 8), null);
  assert.equal(estimateAiCostUsdMicro(1000.5, 500, 2, 8), null);
  assert.equal(estimateAiCostUsdMicro(1000, 500, -2, 8), null);
});
