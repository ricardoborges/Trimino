import { MAX_PLAYERS, MIN_PLAYERS, RuleError, TriminoGame, type ClientMessage, type GameState, type ServerMessage } from "@trimino/shared";
import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export interface Member {
  id: string;
  clientId: string;
  name: string;
  ws: WebSocket | null;
  joinedAt: number;
}

const LOTTERY_REVEAL_MS = 3500;

const newId = () => randomBytes(4).toString("hex");

export class Room {
  members = new Map<string, Member>();
  game: TriminoGame | null = null;
  private emptySince: number | null = null;

  constructor(readonly code: string) {}

  get hostId(): string | null {
    // Anfitrião = membro conectado mais antigo.
    let host: Member | null = null;
    for (const m of this.members.values()) if (m.ws && (!host || m.joinedAt < host.joinedAt)) host = m;
    return host?.id ?? null;
  }

  get isAbandoned(): boolean {
    return this.emptySince !== null && Date.now() - this.emptySince > 10 * 60_000;
  }

  join(ws: WebSocket, name: string, clientId: string): Member {
    let member = [...this.members.values()].find((m) => m.clientId === clientId);
    if (member) {
      member.ws?.close(4000, "Conectado em outro lugar");
      member.ws = ws;
      member.name = name || member.name;
    } else {
      member = { id: newId(), clientId, name: name || "Jogador", ws, joinedAt: Date.now() };
      this.members.set(member.id, member);
    }
    this.emptySince = null;
    return member;
  }

  leave(member: Member, ws: WebSocket): void {
    if (member.ws !== ws) return; // já foi substituído por uma reconexão
    member.ws = null;
    if (!this.game || this.game.phase === "gameOver") {
      // Fora de partida não precisamos guardar a vaga.
      if (!this.game?.player(member.id)) this.members.delete(member.id);
    }
    this.broadcast({ t: "peerLeft", id: member.id });
    if (![...this.members.values()].some((m) => m.ws)) this.emptySince = Date.now();
    this.broadcastState();
  }

  handle(member: Member, msg: ClientMessage): void {
    try {
      switch (msg.t) {
        case "start": {
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode iniciar.");
          if (this.game && this.game.phase !== "gameOver") throw new RuleError("A partida já começou.");
          const seats = [...this.members.values()].filter((m) => m.ws).slice(0, MAX_PLAYERS);
          if (seats.length < MIN_PLAYERS) throw new RuleError(`São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
          this.game = new TriminoGame(seats.map((m) => ({ id: m.id, name: m.name })));
          break;
        }
        case "pickLot": {
          const game = this.requireGame();
          game.pickLot(member.id, msg.slot);
          // Deixa todos verem as pedras reveladas antes de dar as cartas.
          if (game.lotteryDone)
            setTimeout(() => {
              if (this.game === game && game.lotteryDone) {
                game.beginFirstRound();
                this.broadcastState();
              }
            }, LOTTERY_REVEAL_MS);
          break;
        }
        case "nextRound":
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode iniciar a rodada.");
          if (this.game?.phase !== "roundOver") throw new RuleError("A rodada ainda não terminou.");
          this.game.startRound();
          break;
        case "place":
          this.requireGame().place(member.id, msg.tileId, msg.r, msg.c, msg.rot);
          break;
        case "draw":
          this.requireGame().draw(member.id);
          break;
        case "pass":
          this.requireGame().pass(member.id);
          break;
        case "chat": {
          const text = String(msg.text ?? "").slice(0, 300).trim();
          if (text) this.broadcast({ t: "chat", from: member.id, name: member.name, text });
          return;
        }
        case "signal": {
          const target = this.members.get(msg.to);
          if (target?.ws) send(target.ws, { t: "signal", from: member.id, data: msg.data });
          return;
        }
        default:
          return;
      }
      this.broadcastState();
    } catch (err) {
      if (err instanceof RuleError && member.ws) send(member.ws, { t: "error", message: err.message });
      else throw err;
    }
  }

  private requireGame(): TriminoGame {
    if (!this.game) throw new RuleError("A partida ainda não começou.");
    return this.game;
  }

  stateFor(viewer: Member): GameState {
    const g = this.game;
    const hostId = this.hostId;
    const seated = (id: string) => g?.player(id);
    const players = [...this.members.values()]
      .filter((m) => m.ws || seated(m.id))
      .map((m) => {
        const p = seated(m.id);
        return {
          id: m.id,
          name: m.name,
          score: p?.score ?? 0,
          handCount: p?.hand.length ?? 0,
          connected: m.ws !== null,
          isHost: m.id === hostId,
          spectator: !!g && !p,
        };
      });
    // Ordem dos assentos durante a partida; espectadores no fim.
    if (g) {
      const order = new Map(g.players.map((p, i) => [p.id, i]));
      players.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    }
    const me = g?.player(viewer.id);
    return {
      room: this.code,
      phase: g?.phase ?? "lobby",
      round: g?.round ?? 0,
      targetScore: g?.targetScore ?? 400,
      players,
      turnPlayerId: g && g.phase === "playing" ? g.current.id : null,
      poolCount: g?.pool.length ?? 0,
      board: g ? [...g.board.values()] : [],
      lottery:
        g && g.phase === "lottery"
          ? { slots: g.lotteryPool.length, picks: g.lotteryPicks, winnerId: g.lotteryWinnerId }
          : null,
      log: g?.log.slice(-20) ?? [],
      roundSummary: g?.roundSummary ?? null,
      you: {
        id: viewer.id,
        hand: me?.hand ?? [],
        frontier: g && g.phase === "playing" ? g.frontier().map(([r, c]) => ({ r, c })) : [],
        canDraw: g ? g.canDraw(viewer.id) : false,
        canPass: g ? g.canPass(viewer.id) : false,
      },
    };
  }

  broadcastState(): void {
    for (const m of this.members.values()) if (m.ws) send(m.ws, { t: "state", state: this.stateFor(m) });
  }

  broadcast(msg: ServerMessage): void {
    for (const m of this.members.values()) if (m.ws) send(m.ws, msg);
  }
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
