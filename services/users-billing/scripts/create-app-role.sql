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
-- IMPORTANT: <REPLACE_WITH_GENERATED_PASSWORD> below is a placeholder, not a
-- real value. Generate a fresh password locally (e.g. `openssl rand -base64
-- 24`), paste it over the placeholder ONLY in your local editor buffer while
-- running this script interactively, then copy the same value straight into
-- Render's env var field. Never save/commit/push a file with a real
-- password in it, and never paste one into a comment, chat, or PR diff —
-- this file must always read as a placeholder in git history.

CREATE ROLE users_billing_app WITH LOGIN PASSWORD '<REPLACE_WITH_GENERATED_PASSWORD>';

GRANT CONNECT ON DATABASE neondb TO users_billing_app;
GRANT USAGE ON SCHEMA public TO users_billing_app;
GRANT SELECT, INSERT, UPDATE ON public.users, public.subscriptions TO users_billing_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO users_billing_app;

-- New tables added by future migrations won't be visible to this role until
-- granted — re-run the relevant GRANT above (as the owner) after each schema
-- change that adds a table this service needs to read/write.
