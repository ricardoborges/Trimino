// Uma mesa = um Durable Object. Ele guarda a sala em memória (a partida vive enquanto houver gente
// conectada), atende os WebSockets dos jogadores e espectadores e mantém a linha da mesa na varanda.

import type { ClientMessage, IceServer } from "@trimino/shared";
import { DurableObject } from "cloudflare:workers";
import { humanName } from "./auth.ts";
import { Room, send, type Member, type RoomSnapshot } from "./room.ts";
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
  /** Administrador do site (pode mexer nos jogadores IA). */
  admin?: boolean;
}

const HEARTBEAT_MS = 60_000;
/** Enquanto houver partida em andamento, mantém a mesa viva e na varanda mesmo se todos caírem temporariamente. */
const MATCH_GRACE_MS = 10 * 60_000;
const DEFAULT_STUN = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478";
/** Código de fechamento do WebSocket quando um convidado tenta abrir uma mesa vazia. */
const GUEST_REFUSED = 4003;

export class Mesa extends DurableObject<Env> {
  private room: Room | null = null;
  private meta: Meta | null = null;
  private savedRoom: RoomSnapshot | null = null;
  private emptySince: number | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<Meta>("meta")) ?? null;
      this.savedRoom = (await ctx.storage.get<RoomSnapshot>("room")) ?? null;
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
    if (this.savedRoom) {
      room.restore(this.savedRoom);
      this.savedRoom = null;
    }
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
      if (msg.t === "ping" && !member) {
        send(ws, { t: "pong" });
        return;
      }
      if (msg.t === "join") {
        if (member) return;
        const clientId = String(msg.clientId ?? "").slice(0, 64);
        if (clientId.length < 8) return send(ws, { t: "error", message: "clientId inválido." });
        const resume = typeof msg.resume === "string" ? msg.resume.slice(0, 64) : undefined;
        // Com conta, o nome é o da conta; convidado escolhe o seu.
        const name = visitor.userId ? humanName(visitor.name) : humanName(msg.name);
        room.pruneStale();
        // Convidado não arma mesa vazia: só entra (ou volta) numa que já tem gente ou partida em andamento.
        if (
          !visitor.userId &&
          room.humansConnected === 0 &&
          !room.hasActiveMatch &&
          !room.returning(clientId, resume, visitor.userId, name, !!msg.watch)
        ) {
          ws.close(GUEST_REFUSED, "Esta mesa não está aberta. Convidados só entram em mesas com alguém jogando.");
          return;
        }
        member = room.join(ws, name, clientId, { watch: !!msg.watch, userId: visitor.userId, admin: !!visitor.admin, resume });
        this.emptySince = null;
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
    const servers: IceServer[] = [{ urls: (env.STUN_URLS ?? DEFAULT_STUN).split(",") }];
    if (env.TURN_URLS) servers.push({ urls: env.TURN_URLS.split(","), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    return servers;
  }

  // ---------- varanda e persistência ----------

  /** Junta as mudanças próximas numa escrita só. */
  private schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish(false).catch((err) => console.error("[varanda]", err));
    }, 500);
  }

  /** Salva o estado da sala e atualiza a linha da mesa na varanda. */
  private async publish(force: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (room.humansConnected > 0) {
      this.emptySince = null;
    } else if (this.emptySince === null) {
      this.emptySince = now;
    }
    const keepMatchAlive = room.hasActiveMatch && now - (this.emptySince ?? now) < MATCH_GRACE_MS;
    if (room.humansConnected > 0 || room.hasActiveMatch) {
      await this.ctx.storage.put("room", room.toSnapshot());
    } else {
      await this.ctx.storage.delete("room");
    }
    if (!room.humansConnected && !keepMatchAlive) {
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

  /** A cada minuto, limpa conexões zumbis e mantém a mesa viva enquanto houver gente ou partida recente. */
  async alarm(): Promise<void> {
    this.room?.pruneStale();
    await this.publish(true);
    const keepAlive =
      !!this.room &&
      (this.room.humansConnected > 0 ||
        (this.room.hasActiveMatch && Date.now() - (this.emptySince ?? Date.now()) < MATCH_GRACE_MS));
    if (keepAlive) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }
}
