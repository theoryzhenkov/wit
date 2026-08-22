import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The editor SPA. Built into app/dist/web and served statically by the
// one Bun process; in dev, vite proxies API + websocket to it.
// spec: docs/platform/L1-platform#one-process

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
