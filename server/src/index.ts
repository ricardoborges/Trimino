import type { ClientMessage, IceServer } from "@trimino/shared";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Room, send, type Member } from "./room.ts";

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");

function iceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302").split(",") }];
  if (process.env.TURN_URLS)
    servers.push({ urls: process.env.TURN_URLS.split(","), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  return servers;
}

const rooms = new Map<string, Room>();
setInterval(() => {
  for (const [code, room] of rooms) if (room.isAbandoned) rooms.delete(code);
}, 60_000).unref();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // Serve o cliente web compilado (npm run build); SPA cai no index.html.
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Cliente web não compilado. Rode `npm run build` ou use `npm run dev:web`.");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 256 * 1024 });

wss.on("connection", (ws: WebSocket) => {
  let room: Room | null = null;
  let member: Member | null = null;

  const alive = { v: true };
  ws.on("pong", () => (alive.v = true));
  const ping = setInterval(() => {
    if (!alive.v) return ws.terminate();
    alive.v = false;
    ws.ping();
  }, 30_000);

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { t: "error", message: "Mensagem inválida." });
    }

    if (msg.t === "join") {
      if (member) return;
      const code = String(msg.room ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (!code) return send(ws, { t: "error", message: "Informe o código da sala." });
      const clientId = String(msg.clientId ?? "").slice(0, 64);
      if (clientId.length < 8) return send(ws, { t: "error", message: "clientId inválido." });
      room = rooms.get(code) ?? new Room(code);
      rooms.set(code, room);
      member = room.join(ws, String(msg.name ?? "").trim().slice(0, 24), clientId);
      const peers = [...room.members.values()].filter((m) => m.ws && m !== member).map((m) => m.id);
      send(ws, { t: "welcome", you: member.id, room: code, iceServers: iceServers(), peers });
      room.broadcastState();
      return;
    }

    if (!room || !member) return send(ws, { t: "error", message: "Entre numa sala primeiro." });
    try {
      room.handle(member, msg);
    } catch (err) {
      console.error(err);
      send(ws, { t: "error", message: "Erro interno." });
    }
  });

  ws.on("close", () => {
    clearInterval(ping);
    if (room && member) room.leave(member, ws);
  });
});

http.listen(PORT, () => console.log(`Triminó ouvindo em http://localhost:${PORT} (WebSocket em /ws)`));
