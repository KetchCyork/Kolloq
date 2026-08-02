# @newvector/users-billing-service

Standalone registered-users + billing store. Owns two tables:

- `users` — account identity (`first_name`, `last_name`, `email` via `citext` for
  case-insensitive uniqueness).
- `subscriptions` — one row per Stripe subscription, linked to `users` by
  `user_id`. Only Stripe **reference IDs** are stored (`stripe_customer_id`,
  `stripe_subscription_id`, `stripe_price_id`, `default_payment_method_id`) —
  this service never stores raw card numbers, CVC, or a one-time client token.

Schema and migrations live in `src/db/schema.ts` / `drizzle/`, managed with
[Drizzle](https://orm.drizzle.team/) + `drizzle-kit`.

## Local setup

```bash
cp .env.example .env   # DATABASE_URL for your local/throwaway Postgres

# start a throwaway Postgres (either works)
docker compose up -d
# or: brew install postgresql@16 && brew services start postgresql@16

pnpm install
pnpm db:migrate        # applies drizzle/*.sql in order
pnpm dev                # Fastify on PORT (default 3100), GET /health checks DB connectivity
```

## Migrations

- `pnpm db:generate` — diff `src/db/schema.ts` against `drizzle/` and emit a new
  versioned migration.
- `pnpm db:migrate` — apply pending migrations via `drizzle-orm`'s migrator.
- `drizzle/0000_enable_extensions.sql` is hand-written (`pgcrypto` for
  `gen_random_uuid()`, `citext` for case-insensitive email) — regenerate custom
  migrations with `pnpm drizzle-kit generate --custom --name <name>`.

## Tests

`src/db/schema.test.ts` is an integration test that runs migrations against a
real Postgres and exercises the FK, both unique indexes, and `citext`
case-insensitivity. It's skipped unless `DATABASE_URL` is set:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/users_billing pnpm test
```

## Scope note

This scaffold is code + local verification only — no infrastructure
provisioning and no live secrets. `.env` is gitignored; `.env.example` holds
placeholders only.
