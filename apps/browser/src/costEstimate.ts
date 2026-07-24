import type { ProviderName } from "./types";

/**
 * Static, approximate USD price per 1K tokens. No provider in this codebase returns real token
 * usage from a chat response, so every cost note here is a rough client-side estimate (character
 * count / 4, times a flat per-provider rate) — not a billing figure. Formatted output is always
 * prefixed with "~" so it reads as an estimate, per the board's cost-visibility preference.
 */
const PRICE_PER_1K_TOKENS: Record<ProviderName, number> = {
  anthropic: 0.003,
  openai: 0.0005,
  google: 0.0003,
  ollama: 0,
  openrouter: 0.001,
};

const CHARS_PER_TOKEN = 4;

export interface CostEstimate {
  tokens: number;
  usd: number;
  free: boolean;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function estimateCost(provider: ProviderName | undefined, text: string): CostEstimate {
  const tokens = estimateTokens(text);
  if (!provider) return { tokens, usd: 0, free: false };
  const price = PRICE_PER_1K_TOKENS[provider];
  return { tokens, usd: (tokens / 1000) * price, free: price === 0 };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  if (estimate.tokens === 0) return "~0 tok";
  if (estimate.free) return `~${estimate.tokens} tok · free (local)`;
  return `~${estimate.tokens} tok · ~$${estimate.usd.toFixed(4)}`;
}

export function sumCostEstimates(estimates: CostEstimate[]): CostEstimate {
  const tokens = estimates.reduce((sum, estimate) => sum + estimate.tokens, 0);
  const usd = estimates.reduce((sum, estimate) => sum + estimate.usd, 0);
  const free = estimates.length > 0 && estimates.every((estimate) => estimate.free);
  return { tokens, usd, free };
}
