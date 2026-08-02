export type Plan = "pro" | "max";

/**
 * Stripe Price ID -> plan, for the TEST-mode products created in NEW-231.
 * Price IDs are not secrets (Stripe treats them as public catalog data), so
 * they're safe to commit — mirrors services/billing-worker/src/config.ts
 * (same Stripe TEST-mode account, two independent services).
 */
export const PRICE_PLAN: Record<string, Plan> = {
  "price_1TxWR3GgrGbDWiCh6h4mm1mX": "pro", // Pro monthly ($20/mo)
  "price_1TxWR3GgrGbDWiCha86TagpD": "pro", // Pro annual ($200/yr)
  "price_1TxWR4GgrGbDWiChDelYk2LV": "max", // Max monthly ($60/mo)
  "price_1TxWR5GgrGbDWiChkPCCu44p": "max", // Max annual ($600/yr)
};
