import { defineConfig, type ProxyOptions } from "vite";

const worker = `localhost:${process.env.PORT ?? 8787}`;
/** Repassa o host original: o Worker o usa para conferir a origem dos POSTs (o wrangler dev reescreve o Host). */
const toWorker = (ws = false): ProxyOptions => ({
  target: `${ws ? "ws" : "http"}://${worker}`,
  ws,
  configure: (proxy) => proxy.on("proxyReq", (req, incoming) => req.setHeader("x-forwarded-host", incoming.headers.host ?? "")),
});

export default defineConfig({
  // three.js responde pela maior parte do bundle (~150 KB gzip).
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    // API, login e WebSocket vão para o `wrangler dev` (porta 8787).
    proxy: { "/ws": toWorker(true), "/api": toWorker(), "/auth": toWorker() },
  },
});
