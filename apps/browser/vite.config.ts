import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ollama's own CORS allowlist (`OLLAMA_ORIGINS`) rejects requests whose Origin header isn't
// localhost, which blocks the browser app's direct Ollama fetches whenever it's loaded from a
// tailnet IP/hostname (see NEW-97). Proxying same-origin requests through this dev/preview server
// to the local daemon avoids the browser ever cross-origin-fetching Ollama directly.
const OLLAMA_PROXY_PREFIX = "/__ollama__";
const ollamaProxy = {
  [OLLAMA_PROXY_PREFIX]: {
    target: "http://localhost:11434",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(new RegExp(`^${OLLAMA_PROXY_PREFIX}`), ""),
  },
};

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
    proxy: ollamaProxy,
  },
  preview: {
    // Allow reaching the preview over the private Tailscale tailnet by hostname,
    // not just by IP (Vite blocks unknown Host headers with a 403 otherwise).
    allowedHosts: [".ts.net", "christophers-macbook-pro.tailcd24a8.ts.net"],
    proxy: ollamaProxy,
  },
});
