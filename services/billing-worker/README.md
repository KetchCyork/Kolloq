# @newvector/billing-worker

Cloudflare Worker for Open Work billing (Phase 2 of [NEW-225](../../docs/openwork-product-spec.md#8-accounts-subscription-tiers--enterprise)) — Stripe-hosted Checkout/Portal, TEST mode. No database server: a single KV namespace maps `email <-> Stripe customer id` and stores the entitlement record the webhook keeps current.

## Endpoints

Every endpoint except the webhook is authorized by `Authorization: Bearer <Google id_token>` — the same OIDC id_token the app already gets from Google Sign-In (`apps/browser/src/openWorkGoogleAuth.ts`). The worker verifies it against Google's live JWKS (signature, issuer, audience = `GOOGLE_OAUTH_CLIENT_ID`, `email_verified`) and uses the verified email as the user's identity. There is no separate Open Work session/user database — this **is** the auth layer for v1.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/create-checkout-session` | `{ priceId, successUrl?, cancelUrl? }` | `{ url, id }` — redirect the user here |
| POST | `/stripe-webhook` | raw Stripe event (signature-verified) | `{ received: true }` |
| GET | `/entitlement` | — | `{ token, plan, status, currentPeriodEnd, expiresAt }` |
| POST | `/portal-session` | `{ returnUrl? }` | `{ url }` — 404 `no_billing_account` if the user has never checked out |
| GET | `/checkout/return?status=success\|cancelled\|portal` | — | static HTML landing page (unauthenticated) |

`/checkout/return` exists because the Open Work client (Phase 3, [NEW-233](/NEW/issues/NEW-233)) is a desktop app with no web server of its own — Checkout/Portal open in the system browser (like Google sign-in, NEW-195) and Stripe needs a real `https://` URL to send that browser back to. The frontend passes `${apiBase}/checkout/return?status=...` as `successUrl`/`cancelUrl`/`returnUrl`; the app itself never sees that navigation and instead re-fetches `/entitlement` when its window regains focus.

`priceId` must be one of the Price IDs in `src/config.ts` (Pro/Max, monthly/annual — from [NEW-231](/NEW/issues/NEW-231)'s Stripe TEST-mode setup). `token` from `/entitlement` is a short-lived (24h) HS256 JWT signed with `ENTITLEMENT_SIGNING_SECRET`, carrying `{ sub: email, plan, status }` (product spec §8.3: "verified server-side... short-lived signed token").

## Data model (KV, binding `BILLING_KV`)

- `email:<lowercased email>` -> Stripe customer id (string)
- `customer:<stripe customer id>` -> JSON `{ email, plan, status, currentPeriodEnd }`, kept current by `/stripe-webhook` on `checkout.session.completed` / `customer.subscription.created|updated|deleted`.

No card data, CVC, or one-time token is ever stored — only Stripe reference IDs, same scope decision as [NEW-227](/NEW/issues/NEW-227).

## Local dev

```bash
cd services/billing-worker
pnpm install
pnpm test         # 29 unit tests — signature verification, token sign/verify, Google id_token
                   # verification (against a locally generated keypair, not the real Google JWKS),
                   # and all 4 handlers with Stripe calls mocked. No network/secrets needed.
pnpm typecheck

# Boot it locally (miniflare-backed KV, no Cloudflare account needed):
pnpm dev           # wrangler dev --local, default port 8787
curl http://localhost:8787/entitlement   # -> 401 missing_bearer_token (expected, no token)
```

`.dev.vars` (gitignored) can hold local-only secret overrides, e.g. to hit real Stripe TEST mode from your machine:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ENTITLEMENT_SIGNING_SECRET=any-random-string-for-local-testing
```

## Deploy (Chris — one-time, needs a Cloudflare account)

This is the same style of handoff as the Stripe key in Phase 1: I own the code, you own the one interactive step that needs *your* credentials (Cloudflare doesn't have a way to hand me an API token without you first having an account). Everything below is copy-paste; nothing you type here is a secret except where noted, and secrets go straight into `wrangler secret put`, never into a comment or file.

```bash
cd services/billing-worker
pnpm install

# 1. One-time browser login (free Cloudflare account — sign up at dash.cloudflare.com if you don't have one)
pnpm exec wrangler login

# 2. Create the KV namespace and paste the printed "id" into wrangler.toml's
#    [[kv_namespaces]] block, replacing REPLACE_WITH_KV_NAMESPACE_ID
pnpm exec wrangler kv namespace create BILLING_KV

# 3. Set the three secrets (each prompts for a value — paste and press enter, nothing is echoed)
pnpm exec wrangler secret put STRIPE_SECRET_KEY          # TEST-mode key from Phase 1 (sk_test_... or rk_test_...)
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET      # from Phase 1's webhook endpoint (whsec_...)
pnpm exec wrangler secret put ENTITLEMENT_SIGNING_SECRET # generate with: openssl rand -base64 32

# 4. Deploy
pnpm exec wrangler deploy
```

`wrangler deploy` prints the live URL (`https://newvector-billing-worker.<your-subdomain>.workers.dev`). Two follow-ups after that:

1. **Point the Stripe webhook at the real URL.** Phase 1 registered a placeholder (`https://api.newvector.ai/webhooks/stripe`) since this URL didn't exist yet. Dashboard -> Developers -> Webhooks -> edit that endpoint's URL to `<deployed-url>/stripe-webhook`. Editing the URL keeps the same signing secret, so no new `wrangler secret put` needed.
2. **Paste the deployed URL back into the NEW-232 issue thread** (not a secret) so Phase 3 (frontend wiring) knows where to point the app.

### Restricted-key scope for `STRIPE_SECRET_KEY`

The Phase 1 setup-script key (Products/Prices/Webhooks/Billing — write) is *not* the right scope for this running service (least privilege: it doesn't need to create products). If you're minting a fresh restricted key for this step instead of reusing Phase 1's:

- **Customers** — Write (create) + Read (retrieve, for the webhook's email-lookup fallback)
- **Checkout Sessions** — Write
- **Customer Portal** — Write
- Everything else — None

The client refuses to call Stripe at all with anything not starting `sk_test_`/`rk_test_` (`src/stripeClient.ts`), so a live key pasted in here fails loudly instead of taking a real charge — that guard stays until NEW-225's separate go-live gate.

## Out of scope here (later issues)

- Turning `FREE_LIMITS` into real server-verified gating — Phase 4 ([NEW-234](/NEW/issues/NEW-234)).
- Actual Cloudflare deploy + the two follow-ups above — needs Chris's Cloudflare account, see "Deploy" section.
