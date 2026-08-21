-- Least-privilege DB role for the deployed users-billing service (NEW-366).
--
-- Run this ONCE against the Neon database, connected as the owner role
-- (neondb_owner) — e.g. via the Neon console's SQL editor, or:
--   psql "$NEON_OWNER_URL" -f scripts/create-app-role.sql
--
-- Afterwards, put the NEW role's connection string in Render's DATABASE_URL
-- (never the owner's). Migrations (`pnpm db:migrate`) still need to run as
-- the owner, since this role can't alter schema.
--
-- Replace the password placeholder before running; generate it locally
-- (e.g. `openssl rand -base64 24`) and copy it straight into Render's env —
-- never paste it into a comment, chat, or file.

CREATE ROLE users_billing_app WITH LOGIN PASSWORD 'w0OWqLQRnVCmnHon4VijrbIrcwQWV4nK';

GRANT CONNECT ON DATABASE neondb TO users_billing_app;
GRANT USAGE ON SCHEMA public TO users_billing_app;
GRANT SELECT, INSERT, UPDATE ON public.users, public.subscriptions TO users_billing_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO users_billing_app;

-- New tables added by future migrations won't be visible to this role until
-- granted — re-run the relevant GRANT above (as the owner) after each schema
-- change that adds a table this service needs to read/write.
