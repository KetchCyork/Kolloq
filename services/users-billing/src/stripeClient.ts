import { HttpError } from "./httpError.js";

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe's form-encoded API needs bracket notation for nested/array params,
// e.g. { invoice_settings: { default_payment_method: "x" } } ->
// "invoice_settings[default_payment_method]=x".
function flattenParams(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") {
          pairs.push(...flattenParams(item as Record<string, unknown>, `${paramKey}[${i}]`));
        } else {
          pairs.push([`${paramKey}[${i}]`, String(item)]);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(...flattenParams(value as Record<string, unknown>, paramKey));
    } else {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

/**
 * Board preference: TEST mode only until a separate go-live gate (NEW-225 plan §6.4).
 * Refusing anything but a TEST-mode key means a live key pasted into .env too early
 * fails loudly instead of silently taking real payments — mirrors
 * services/billing-worker/src/stripeClient.ts.
 */
export function assertTestModeKey(secretKey: string): void {
  if (!/^(sk|rk)_test_/.test(secretKey)) {
    throw new HttpError(500, "stripe_secret_key_not_test_mode");
  }
}

async function stripeRequest<T>(
  secretKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  assertTestModeKey(secretKey);
  const isBodyless = method === "GET" || method === "DELETE";
  const query = params && method === "GET" ? `?${new URLSearchParams(flattenParams(params)).toString()}` : "";
  const response = await fetch(`${STRIPE_API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(isBodyless ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: !isBodyless && params ? new URLSearchParams(flattenParams(params)).toString() : undefined,
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = (body.error as { message?: string } | undefined)?.message ?? "stripe_request_failed";
    throw new HttpError(response.status >= 500 ? 502 : 400, message);
  }
  return body as T;
}

export interface StripeCustomer {
  id: string;
  email: string | null;
}

export function createCustomer(secretKey: string, params: { email: string; name: string }): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(secretKey, "POST", "/customers", {
    email: params.email,
    name: params.name,
  });
}

export interface StripePaymentMethod {
  id: string;
  customer: string | null;
}

export function attachPaymentMethod(
  secretKey: string,
  paymentMethodId: string,
  customerId: string,
): Promise<StripePaymentMethod> {
  return stripeRequest<StripePaymentMethod>(secretKey, "POST", `/payment_methods/${paymentMethodId}/attach`, {
    customer: customerId,
  });
}

export function setDefaultPaymentMethod(
  secretKey: string,
  customerId: string,
  paymentMethodId: string,
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(secretKey, "POST", `/customers/${customerId}`, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

export interface StripeSubscription {
  id: string;
  status: string;
  current_period_end: number | null;
}

export function createSubscription(
  secretKey: string,
  params: { customerId: string; priceId: string; paymentMethodId: string },
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(secretKey, "POST", "/subscriptions", {
    customer: params.customerId,
    items: [{ price: params.priceId }],
    default_payment_method: params.paymentMethodId,
  });
}

/** Best-effort compensation only — see handlers/signup.ts. Never awaited for its result to affect a response. */
export function cancelSubscription(secretKey: string, subscriptionId: string): Promise<{ id: string }> {
  return stripeRequest(secretKey, "DELETE", `/subscriptions/${subscriptionId}`);
}
