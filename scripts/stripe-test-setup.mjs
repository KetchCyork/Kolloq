#!/usr/bin/env node
// NEW-231 (Phase 1 of NEW-225): idempotent Stripe TEST-mode setup.
//
// Creates the Products/Prices for the approved tiers (Pro $20/mo, Max
// $60/mo, plus an annual price per paid tier at ~2 months off), configures
// the Customer Portal (plan switch, cancel, update payment method), and
// registers a webhook endpoint — printing the resulting Price IDs (safe to
// commit) and the webhook signing secret (never persisted by this script).
//
// Requires STRIPE_SECRET_KEY in the environment, and refuses to run against
// anything but a TEST-mode key (must start with "sk_test_"). Get a
// restricted TEST-mode key from Stripe Dashboard -> Developers -> API keys,
// scoped to write access on Products, Prices, Webhook Endpoints, and Billing
// Portal Configurations.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-test-setup.mjs [--dry-run] [--webhook-url=https://...]
//
// --dry-run prints the planned API calls without making any network request
// and without requiring STRIPE_SECRET_KEY to be set.
//
// The webhook signing secret is printed to stdout only. Copy it directly
// into the deploy platform's secret store (Phase 2). Never paste it into an
// issue, comment, log file, or committed file — Stripe will not show it
// again once printed, so if it's lost, rotate the endpoint in the dashboard.

const DRY_RUN = process.argv.includes('--dry-run');
const webhookUrlArg = process.argv.find((arg) => arg.startsWith('--webhook-url='));
const WEBHOOK_URL = webhookUrlArg
  ? webhookUrlArg.slice('--webhook-url='.length)
  : 'https://api.newvector.ai/webhooks/stripe'; // placeholder until Phase 2 picks a real deploy target

const STRIPE_API = 'https://api.stripe.com/v1';

const TIERS = [
  {
    productId: 'newvector_pro',
    productName: 'New Vector — Pro',
    monthly: { lookupKey: 'newvector_pro_monthly', unitAmount: 2000, nickname: 'Pro Monthly' },
    // ~2 months off: 10x the monthly price instead of 12x.
    annual: { lookupKey: 'newvector_pro_annual', unitAmount: 20000, nickname: 'Pro Annual' },
  },
  {
    productId: 'newvector_max',
    productName: 'New Vector — Max',
    monthly: { lookupKey: 'newvector_max_monthly', unitAmount: 6000, nickname: 'Max Monthly' },
    annual: { lookupKey: 'newvector_max_annual', unitAmount: 60000, nickname: 'Max Annual' },
  },
];

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

function flattenParams(obj, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(obj)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          pairs.push(...flattenParams(item, `${paramKey}[]`));
        } else {
          pairs.push([`${paramKey}[]`, String(item)]);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      pairs.push(...flattenParams(value, paramKey));
    } else if (value !== undefined) {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

async function stripeRequest(secretKey, method, path, params = {}) {
  const pairs = flattenParams(params);
  let url = `${STRIPE_API}${path}`;
  const init = {
    method,
    headers: { Authorization: `Bearer ${secretKey}` },
  };
  if (method === 'GET') {
    if (pairs.length) url += `?${new URLSearchParams(pairs).toString()}`;
  } else {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(pairs).toString();
  }
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe ${method} ${path} failed: ${res.status} ${body.error?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

async function getOrCreateProduct(secretKey, { productId, productName }) {
  try {
    const existing = await stripeRequest(secretKey, 'GET', `/products/${productId}`);
    console.log(`[product] exists: ${existing.id} (${existing.name})`);
    return existing;
  } catch {
    const created = await stripeRequest(secretKey, 'POST', '/products', {
      id: productId,
      name: productName,
    });
    console.log(`[product] created: ${created.id} (${created.name})`);
    return created;
  }
}

async function getOrCreatePrice(secretKey, product, { lookupKey, unitAmount, nickname }) {
  const existing = await stripeRequest(secretKey, 'GET', '/prices', { lookup_keys: [lookupKey] });
  if (existing.data.length > 0) {
    console.log(`[price] exists: ${existing.data[0].id} (${lookupKey})`);
    return existing.data[0];
  }
  const created = await stripeRequest(secretKey, 'POST', '/prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval: lookupKey.endsWith('annual') ? 'year' : 'month' },
    lookup_key: lookupKey,
    nickname,
  });
  console.log(`[price] created: ${created.id} (${lookupKey}) — $${(unitAmount / 100).toFixed(2)}`);
  return created;
}

async function configureCustomerPortal(secretKey, priceIdsByProduct) {
  const products = Object.entries(priceIdsByProduct).map(([productId, prices]) => ({
    product: productId,
    prices,
  }));
  const config = await stripeRequest(secretKey, 'POST', '/billing_portal/configurations', {
    business_profile: { headline: 'New Vector — manage your subscription' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products,
      },
    },
  });
  console.log(`[portal] configuration created: ${config.id}`);
  return config;
}

async function getOrCreateWebhookEndpoint(secretKey, url) {
  const existing = await stripeRequest(secretKey, 'GET', '/webhook_endpoints', { limit: 100 });
  const match = existing.data.find((ep) => ep.url === url);
  if (match) {
    console.log(`[webhook] endpoint already registered: ${match.id} (${url})`);
    console.log('[webhook] signing secret is not retrievable after creation — rotate in the dashboard if lost.');
    return match;
  }
  const created = await stripeRequest(secretKey, 'POST', '/webhook_endpoints', {
    url,
    enabled_events: WEBHOOK_EVENTS,
  });
  console.log(`[webhook] created: ${created.id} (${url})`);
  console.log(`[webhook] SIGNING SECRET (copy into the deploy secret store now, it will not be shown again):`);
  console.log(`  ${created.secret}`);
  return created;
}

async function main() {
  if (DRY_RUN) {
    console.log('--- DRY RUN: no network calls will be made ---');
    for (const tier of TIERS) {
      console.log(`product ${tier.productId} (${tier.productName})`);
      console.log(`  price ${tier.monthly.lookupKey}: $${(tier.monthly.unitAmount / 100).toFixed(2)}/mo`);
      console.log(`  price ${tier.annual.lookupKey}: $${(tier.annual.unitAmount / 100).toFixed(2)}/yr`);
    }
    console.log(`webhook endpoint: ${WEBHOOK_URL}`);
    console.log(`webhook events: ${WEBHOOK_EVENTS.join(', ')}`);
    console.log('customer portal: plan switch (Pro <-> Max), cancel at period end, payment method update');
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set. See script header for how to obtain a TEST-mode key.');
    process.exitCode = 1;
    return;
  }
  // Both full secret keys (sk_test_...) and restricted keys (rk_test_...) are
  // valid here — the issue instructs using a restricted key, which uses the
  // rk_ prefix, not sk_. Either is fine as long as it's TEST-mode.
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    console.error('Refusing to run: STRIPE_SECRET_KEY must be a TEST-mode key (sk_test_... or rk_test_...).');
    console.error('Got a key starting with a different prefix — in the Stripe Dashboard, toggle to "Test mode"');
    console.error('(top-right switch) BEFORE creating the restricted key. Test and Live keys are separate sets;');
    console.error('a key created while Live mode is active will start with sk_live_/rk_live_ regardless of scopes.');
    process.exitCode = 1;
    return;
  }

  const priceIdsByProduct = {};
  const priceIdSummary = {};
  for (const tier of TIERS) {
    const product = await getOrCreateProduct(secretKey, tier);
    const monthly = await getOrCreatePrice(secretKey, product, tier.monthly);
    const annual = await getOrCreatePrice(secretKey, product, tier.annual);
    priceIdsByProduct[product.id] = [monthly.id, annual.id];
    priceIdSummary[tier.productId] = { monthly: monthly.id, annual: annual.id };
  }

  await configureCustomerPortal(secretKey, priceIdsByProduct);
  await getOrCreateWebhookEndpoint(secretKey, WEBHOOK_URL);

  console.log('\n--- Price IDs (safe to record, not secrets) ---');
  console.log(JSON.stringify(priceIdSummary, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
