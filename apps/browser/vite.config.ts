import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Resolve @newvector/core to its TypeScript source in dev so the browser bundle
// doesn't require a prior `pnpm build` of the package. The package's own
// package.json intentionally points `main` at the compiled `./dist` output
// because its Node CLI (`agent-cli`) and the `@newvector/core/node` subpath run
// on Node and need real .js files — but the browser only consumes the
// provider-agnostic entry, which is safe to load straight from source. This
// mirrors @newvector/ui, whose `main` already points at `./src/index.ts`.
const coreSrc = fileURLToPath(
  new URL("../../packages/core/src/index.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@newvector/core": coreSrc,
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
