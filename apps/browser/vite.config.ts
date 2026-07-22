import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
});
