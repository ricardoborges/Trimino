// Uma mesa = um Durable Object. Ele guarda a sala em memória (a partida vive enquanto houver gente
// conectada), atende os WebSockets dos jogadores e espectadores e mantém a linha da mesa na varanda.

import type { ClientMessage, IceServer } from "@trimino/shared";
import { DurableObject } from "cloudflare:workers";
import { humanName } from "./auth.ts";
import { Room, send, type Member } from "./room.ts";
import { publishMesa, recordMatch, removeMesa } from "./store.ts";

interface Meta {
  code: string;
  title: string;
  private: boolean;
}

/** Quem está conectando, já autenticado pelo Worker (nunca vem do cliente). */
export interface Visitor {
  userId?: string;
  name?: string;
}

const HEARTBEAT_MS = 60_000;

export class Mesa extends DurableObject<Env> {
  private room: Room | null = null;
  private meta: Meta | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<Meta>("meta")) ?? null;
    });
  }

  /** Chamado pela varanda ao criar a mesa, antes de alguém entrar. */
  async configure(meta: Meta): Promise<void> {
    this.meta = meta;
    await this.ctx.storage.put("meta", meta);
    if (this.room) this.room.title = meta.title;
  }

  private ensureRoom(code: string): Room {
    if (this.room) return this.room;
    const room = new Room(code);
    room.title = this.meta?.title ?? "";
    room.onChange = () => this.schedulePublish();
    room.onGameOver = (result) => {
      recordMatch(this.env.DB, result).catch((err) => console.error("[estatísticas]", err));
    };
    this.room = room;
    return room;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("Esperava WebSocket.", { status: 426 });
    const code = req.headers.get("x-trimino-room")!;
    const visitor = JSON.parse(req.headers.get("x-trimino-visitor") ?? "{}") as Visitor;
    const room = this.ensureRoom(code);

    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    let member: Member | null = null;

    ws.addEventListener("message", (ev) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return send(ws, { t: "error", message: "Mensagem inválida." });
      }
      if (msg.t === "join") {
        if (member) return;
        const clientId = String(msg.clientId ?? "").slice(0, 64);
        if (clientId.length < 8) return send(ws, { t: "error", message: "clientId inválido." });
        // Com conta, o nome é o da conta; convidado escolhe o seu.
        const name = visitor.userId ? humanName(visitor.name) : humanName(msg.name);
        member = room.join(ws, name, clientId, { watch: !!msg.watch, userId: visitor.userId });
        send(ws, {
          t: "welcome",
          you: member.id,
          room: code,
          iceServers: this.iceServers(),
          peers: member.inCall ? room.callPeers(member) : [],
          inCall: !!member.inCall,
        });
        room.broadcastState();
        this.armHeartbeat();
        return;
      }
      if (!member) return send(ws, { t: "error", message: "Entre numa sala primeiro." });
      try {
        room.handle(member, msg);
      } catch (err) {
        console.error(err);
        send(ws, { t: "error", message: "Erro interno." });
      }
    });

    const closed = () => {
      if (member) room.leave(member, ws);
    };
    ws.addEventListener("close", closed);
    ws.addEventListener("error", closed);

    return new Response(null, { status: 101, webSocket: client });
  }

  private iceServers(): IceServer[] {
    const env = this.env as Env & Partial<Record<"STUN_URLS" | "TURN_URLS" | "TURN_USERNAME" | "TURN_CREDENTIAL", string>>;
    const servers: IceServer[] = [{ urls: (env.STUN_URLS ?? "stun:stun.l.google.com:19302").split(",") }];
    if (env.TURN_URLS) servers.push({ urls: env.TURN_URLS.split(","), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    return servers;
  }

  // ---------- varanda ----------

  /** Junta as mudanças próximas numa escrita só. */
  private schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish(false).catch((err) => console.error("[varanda]", err));
    }, 500);
  }

  /** Atualiza a linha da mesa na varanda; sem ninguém conectado, a mesa sai da lista. */
  private async publish(force: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!room.humansConnected) {
      if (this.lastPublished !== "") await removeMesa(this.env.DB, room.code);
      this.lastPublished = "";
      return;
    }
    const summary = room.summary();
    const key = JSON.stringify({ ...summary, updatedAt: 0 });
    if (!force && key === this.lastPublished) return;
    this.lastPublished = key;
    await publishMesa(this.env.DB, summary, !!this.meta?.private);
  }

  private armHeartbeat(): void {
    this.ctx.storage.getAlarm().then((at) => {
      if (at === null) return this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    });
  }

  /** A cada minuto, enquanto houver gente, avisa a varanda que a mesa continua aberta. */
  async alarm(): Promise<void> {
    await this.publish(true);
    if (this.room?.humansConnected) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }
}
