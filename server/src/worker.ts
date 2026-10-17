// Worker do Triminó: API do site (contas, varanda, estatísticas), login com Google e o WebSocket
// das mesas, que é repassado ao Durable Object da mesa. O resto são os arquivos do cliente (assets).

import { HttpError, currentUser, googleCallback, googleEnabled, googleStart, json, login, logout, signup, type GoogleConfig } from "./auth.ts";
import { aiEnabled } from "./ai.ts";
import type { Visitor } from "./mesa.ts";
import { listMesas, playerStats, ranking } from "./store.ts";

export { Mesa } from "./mesa.ts";

type Secrets = Partial<Record<"GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "PUBLIC_URL", string>>;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normalizeRoom = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const randomRoom = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => ROOM_ALPHABET[b % 32]).join("");

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const secrets = env as Env & Secrets;
    const google: GoogleConfig = { clientId: secrets.GOOGLE_CLIENT_ID, clientSecret: secrets.GOOGLE_CLIENT_SECRET, publicUrl: secrets.PUBLIC_URL };
    try {
      // --- mesa (WebSocket) ---
      if (url.pathname === "/ws") {
        if (req.headers.get("upgrade") !== "websocket") return new Response("Esperava WebSocket.", { status: 426 });
        const code = normalizeRoom(url.searchParams.get("sala"));
        if (!code) return new Response("Informe a sala (?sala=CODIGO).", { status: 400 });
        const user = await currentUser(env.DB, req);
        const visitor: Visitor = user ? { userId: user.id, name: user.name, admin: !!user.admin } : {};
        // Os cabeçalhos de identidade são sempre definidos aqui, nunca repassados do cliente.
        const headers = new Headers(req.headers);
        headers.set("x-trimino-room", code);
        headers.set("x-trimino-visitor", JSON.stringify(visitor));
        const stub = env.MESA.get(env.MESA.idFromName(code));
        return stub.fetch(new Request(req.url, { headers }));
      }

      // --- Google ---
      if (url.pathname === "/auth/google") return googleStart(google, req);
      if (url.pathname === "/auth/google/callback") return await googleCallback(env.DB, google, req);

      // --- API ---
      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case "GET /api/config":
          return json({ google: googleEnabled(google), ai: aiEnabled() });
        case "GET /api/me": {
          const user = await currentUser(env.DB, req);
          return json({ user, stats: user ? await playerStats(env.DB, user.id) : null });
        }
        case "POST /api/signup":
          return await signup(env.DB, sameOrigin(req, google.publicUrl));
        case "POST /api/login":
          return await login(env.DB, sameOrigin(req, google.publicUrl));
        case "POST /api/logout":
          return await logout(env.DB, sameOrigin(req, google.publicUrl));
        case "GET /api/mesas":
          return json({ mesas: await listMesas(env.DB) });
        case "POST /api/mesas": {
          // Criar mesa: reserva um código aleatório livre (que também é o nome: "Mesa ABCDE") e grava se é privada.
          sameOrigin(req, google.publicUrl);
          const user = await currentUser(env.DB, req);
          if (!user) throw new HttpError(403, "Convidados não podem armar mesas. Crie uma conta para armar a sua.");
          const body = (await req.json().catch(() => ({}))) as { private?: unknown };
          let code = randomRoom();
          for (let i = 0; i < 5 && (await env.DB.prepare("SELECT 1 FROM mesas WHERE code = ?").bind(code).first()); i++) code = randomRoom();
          await env.MESA.get(env.MESA.idFromName(code)).configure({ code, title: "", private: !!body.private });
          return json({ code });
        }
        case "GET /api/ranking":
          return json({ ranking: await ranking(env.DB) });
      }
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "Não encontrado.");
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      console.error(err);
      return json({ error: "Erro interno." }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

/** Bloqueia POSTs de outros sites (o cookie é SameSite=Lax, isto é uma segunda barreira). */
function sameOrigin(req: Request, publicUrl?: string): Request {
  const origin = req.headers.get("origin");
  if (!origin || origin === publicUrl) return req;
  // Atrás do proxy do Vite (dev), o host original chega em X-Forwarded-Host.
  const host = new URL(origin).host;
  if (host !== new URL(req.url).host && host !== req.headers.get("x-forwarded-host")) throw new HttpError(403, "Origem não permitida.");
  return req;
}
