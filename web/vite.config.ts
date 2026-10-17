import { defineConfig } from "vite";

export default defineConfig({
  // three.js responde pela maior parte do bundle (~150 KB gzip).
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: { "/ws": { target: `ws://localhost:${process.env.PORT ?? 8080}`, ws: true } },
  },
});
