import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
