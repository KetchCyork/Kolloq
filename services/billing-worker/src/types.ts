import type { Plan } from "./config";

export interface Env {
  BILLING_KV: KVNamespace;
  GOOGLE_OAUTH_CLIENT_ID: string;
  DEFAULT_CHECKOUT_SUCCESS_URL: string;
  DEFAULT_CHECKOUT_CANCEL_URL: string;
  DEFAULT_PORTAL_RETURN_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ENTITLEMENT_SIGNING_SECRET: string;
}

/** Stored at `customer:<stripeCustomerId>` — the entitlement record kept current by the webhook. */
export interface CustomerRecord {
  email: string;
  plan: Plan;
  status: string;
  currentPeriodEnd: number | null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
