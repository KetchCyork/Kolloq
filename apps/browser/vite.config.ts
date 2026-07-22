import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * Machine-level env dir, used to fill in vars the repo-local files don't set.
 *
 * `apps/browser/.env` is untracked, so it never travels to a fresh clone or to the throwaway
 * git worktrees releases get built from — and a build from such a working copy inlines the
 * missing var as empty and ships the feature disabled, with nothing in the UI saying why
 * (NEW-131: three of four working copies on the build machine had no `.env`, and the desktop
 * app that reached the user had "Continue with Google" permanently greyed out).
 *
 * Provisioning `~/.openwork/.env` once per machine makes every working copy on it build the
 * same binary. This is a fallback only: an explicit process env var (CI) or a repo-local
 * `.env` still wins.
 */
const USER_ENV_DIR = (process.env.OPENWORK_ENV_DIR ?? "").trim() || join(homedir(), ".openwork");

/**
 * Copies `VITE_`-prefixed vars from the machine-level env dir into `process.env` for keys
 * nothing else has set.
 *
 * Writing to `process.env` — rather than just merging into the local `env` map below — is what
 * makes the value reach the bundle: Vite assembles `import.meta.env` from its own `.env` scan
 * plus `process.env`, and it does that after this config factory has run. Only `VITE_` keys are
 * copied, so an unrelated var in that file can't leak into the build environment.
 */
function applyUserEnvFallback(mode: string): void {
  for (const [key, value] of Object.entries(loadEnv(mode, USER_ENV_DIR, ""))) {
    if (!key.startsWith("VITE_")) continue;
    if (!value.trim()) continue;
    if ((process.env[key] ?? "").trim()) continue;
    process.env[key] = value;
  }
}

/**
 * Build env vars a *shippable* binary cannot go out without.
 *
 * Vite inlines `VITE_`-prefixed vars at build time, so a var that is absent from the
 * build job's environment is baked in as empty and the feature silently degrades in the
 * shipped binary. Locally these come from the untracked `apps/browser/.env`; in the
 * release pipeline they come from its secret store (see apps/desktop/README.md).
 */
const RELEASE_REQUIRED_ENV: Record<string, string> = {
  VITE_GOOGLE_OAUTH_CLIENT_SECRET:
    'Google OAuth Client Secret. Without it googleSignInConfigured() is false and "Continue with Google" ships disabled.',
};

/**
 * Fail a release build that is missing a required var, so a degraded binary can't ship
 * silently. Only release builds hard-fail: a contributor without the secrets can still
 * run `pnpm build` (they get a warning). The pipeline opts in with `RELEASE_BUILD=1`.
 */
function assertReleaseEnv(env: Record<string, string>, isRelease: boolean): void {
  const missing = Object.keys(RELEASE_REQUIRED_ENV).filter((name) => !(env[name] ?? "").trim());
  if (missing.length === 0) return;

  const detail = missing.map((name) => `  - ${name}: ${RELEASE_REQUIRED_ENV[name]}`).join("\n");
  const provision =
    `Provision them in ${join(USER_ENV_DIR, ".env")} (machine-wide, survives fresh clones and ` +
    "worktrees) or in apps/browser/.env, and rebuild.";
  if (!isRelease) {
    console.warn(
      `\n[build] WARNING - building with these vars empty, so the features they gate will be ` +
        `DISABLED in this bundle:\n${detail}\n${provision}\n` +
        "Continuing because this is not a release build (RELEASE_BUILD is unset).\n",
    );
    return;
  }
  throw new Error(
    `Release build is missing required env var(s):\n${detail}\n\n` +
      "Set them in the release pipeline's secret store and export them for the build step " +
      `(GitHub Actions: repository secrets, see .github/workflows/desktop-release.yml). ` +
      `Locally: ${provision} Refusing to ship a build with the feature disabled.`,
  );
}

export default defineConfig(({ command, mode }) => {
  // Fill gaps from ~/.openwork/.env before anything reads the environment, so a working copy
  // without its own .env still builds a complete binary.
  applyUserEnvFallback(mode);
  // loadEnv reads .env files the same way Vite does for import.meta.env; process.env alone
  // would miss a locally-provisioned apps/browser/.env and fail a correct build.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  const isRelease = ["1", "true"].includes((env.RELEASE_BUILD ?? "").trim().toLowerCase());
  if (command === "build") assertReleaseEnv(env, isRelease);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // Resolve @newvector/core from its TypeScript source for the browser
        // bundle instead of ./dist. The package's `main` points at ./dist/src
        // (required for its Node CLI + the @newvector/core/node subpath), but on
        // a fresh checkout `dist` doesn't exist yet, so Vite would fail to resolve
        // the entry until `pnpm build` runs. The default `.` entry is
        // browser-safe (node-only tools live under @newvector/core/node), and
        // @newvector/ui already resolves from source the same way. Keeping the
        // alias scoped to the exact package specifier leaves the /node subpath
        // (Node CLI) resolving through dist as before.
        "@newvector/core": fileURLToPath(
          new URL("../../packages/core/src/index.ts", import.meta.url),
        ),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      // Allow reaching the preview over the private Tailscale tailnet by hostname,
      // not just by IP (Vite blocks unknown Host headers with a 403 otherwise).
      allowedHosts: [".ts.net", "christophers-macbook-pro.tailcd24a8.ts.net"],
    },
  };
});
