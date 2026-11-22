export function estimateAiCostUsdMicro(
  tokensInput: number,
  tokensOutput: number,
  inputCostPerMillion: number | string | null | undefined,
  outputCostPerMillion: number | string | null | undefined,
): number | null {
  const inputRate = inputCostPerMillion === null || inputCostPerMillion === undefined ? NaN : Number(inputCostPerMillion);
  const outputRate = outputCostPerMillion === null || outputCostPerMillion === undefined ? NaN : Number(outputCostPerMillion);
  if (
    !Number.isSafeInteger(tokensInput) || !Number.isSafeInteger(tokensOutput) ||
    tokensInput < 0 || tokensOutput < 0 ||
    !Number.isFinite(inputRate) || !Number.isFinite(outputRate) ||
    inputRate < 0 || outputRate < 0
  ) return null;
  const cost = tokensInput * inputRate + tokensOutput * outputRate;
  return Number.isSafeInteger(Math.round(cost)) ? Math.max(0, Math.round(cost)) : null;
}
