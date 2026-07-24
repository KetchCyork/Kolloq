import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

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
  if (!isRelease) {
    console.warn(
      `\n[build] Missing optional build env (not a release build, continuing):\n${detail}\n`,
    );
    return;
  }
  throw new Error(
    `Release build is missing required env var(s):\n${detail}\n\n` +
      "Set them in the release pipeline's secret store and export them for the build step " +
      "(GitHub Actions: repository secrets, see .github/workflows/desktop-release.yml), " +
      "or locally in apps/browser/.env. Refusing to ship a build with the feature disabled.",
  );
}

export default defineConfig(({ command, mode }) => {
  // loadEnv reads .env files the same way Vite does for import.meta.env; process.env alone
  // would miss a locally-provisioned apps/browser/.env and fail a correct build.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  const isRelease = ["1", "true"].includes((env.RELEASE_BUILD ?? "").trim().toLowerCase());
  if (command === "build") assertReleaseEnv(env, isRelease);

  return {
    plugins: [react()],
    optimizeDeps: {
      // Every `@tauri-apps/*` module is reached *only* through a runtime `await import(...)`
      // (see credentials.ts, openWorkGoogleAuth.ts, projectFolder.ts, desktopIntegration.ts,
      // subscriptionAuth.ts). Vite's dep scanner only walks statically-reachable imports at
      // startup, so it never pre-bundles these. The first time one is invoked at runtime — e.g.
      // clicking "Continue with Google", whose first act is `import("@tauri-apps/api/core")` —
      // Vite discovers the new dep, re-runs the optimizer, and invalidates the in-flight hashed
      // chunk, so the import rejects with "Failed to fetch dynamically imported module:
      // .../@tauri-apps_api_core.js?v=<hash>" (NEW-195). Listing them here forces pre-bundling
      // at server start so the hash is stable and the dynamic import resolves on the first click.
      include: [
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-updater",
        "@tauri-apps/plugin-process",
      ],
    },
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
