export type Plan = "free" | "pro" | "max";

/**
 * Stripe Price ID -> plan, for the TEST-mode products created in NEW-231.
 * Price IDs are not secrets (Stripe treats them as public catalog data), so
 * they're safe to commit — see services/billing-worker/README.md.
 */
export const PRICE_PLAN: Record<string, Plan> = {
  "price_1TxWR3GgrGbDWiCh6h4mm1mX": "pro", // Pro monthly ($20/mo)
  "price_1TxWR3GgrGbDWiCha86TagpD": "pro", // Pro annual ($200/yr)
  "price_1TxWR4GgrGbDWiChDelYk2LV": "max", // Max monthly ($60/mo)
  "price_1TxWR5GgrGbDWiChkPCCu44p": "max", // Max annual ($600/yr)
};

/** Short-lived: forces the app to re-verify with the backend at least this often (product spec §8.3). */
export const ENTITLEMENT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** Stripe tolerates signature timestamps within this window to reject replayed webhook deliveries. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export const KV_PREFIX = {
  emailToCustomer: "email:",
  customerRecord: "customer:",
} as const;
