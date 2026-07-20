import { describe, expect, it } from "vitest";
import { estimateCost, estimateTokens, formatCostEstimate, sumCostEstimates } from "./costEstimate";

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up roughly one token per 4 characters, minimum 1", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("a".repeat(8))).toBe(2);
    expect(estimateTokens("a".repeat(9))).toBe(3);
  });
});

describe("estimateCost", () => {
  it("is free for a provider with a zero price (ollama)", () => {
    const estimate = estimateCost("ollama", "a".repeat(400));
    expect(estimate.free).toBe(true);
    expect(estimate.usd).toBe(0);
    expect(estimate.tokens).toBe(100);
  });

  it("computes a positive USD estimate for a priced provider", () => {
    const estimate = estimateCost("anthropic", "a".repeat(4000));
    expect(estimate.free).toBe(false);
    expect(estimate.tokens).toBe(1000);
    expect(estimate.usd).toBeCloseTo(0.003, 6);
  });

  it("treats an unknown/undefined provider as zero-cost, not free-labeled", () => {
    const estimate = estimateCost(undefined, "hello");
    expect(estimate.usd).toBe(0);
    expect(estimate.free).toBe(false);
  });
});

describe("formatCostEstimate", () => {
  it("labels a zero-token estimate distinctly", () => {
    expect(formatCostEstimate({ tokens: 0, usd: 0, free: false })).toBe("~0 tok");
  });

  it("labels free/local estimates instead of $0.0000", () => {
    expect(formatCostEstimate({ tokens: 50, usd: 0, free: true })).toBe("~50 tok · free (local)");
  });

  it("formats priced estimates with a ~ prefix on both tokens and dollars", () => {
    expect(formatCostEstimate({ tokens: 1000, usd: 0.003, free: false })).toBe("~1000 tok · ~$0.0030");
  });
});

describe("sumCostEstimates", () => {
  it("sums tokens and usd across estimates", () => {
    const total = sumCostEstimates([
      { tokens: 100, usd: 0.001, free: false },
      { tokens: 200, usd: 0.002, free: false },
    ]);
    expect(total.tokens).toBe(300);
    expect(total.usd).toBeCloseTo(0.003, 6);
  });

  it("is only free when every estimate is free", () => {
    const mixed = sumCostEstimates([
      { tokens: 10, usd: 0, free: true },
      { tokens: 10, usd: 0.001, free: false },
    ]);
    expect(mixed.free).toBe(false);

    const allFree = sumCostEstimates([
      { tokens: 10, usd: 0, free: true },
      { tokens: 10, usd: 0, free: true },
    ]);
    expect(allFree.free).toBe(true);
  });

  it("returns a non-free zero estimate for an empty list", () => {
    expect(sumCostEstimates([])).toEqual({ tokens: 0, usd: 0, free: false });
  });
});
