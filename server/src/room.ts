import { MAX_PLAYERS, MIN_PLAYERS, RuleError, TriminoGame, type ClientMessage, type GameState, type ServerMessage } from "@trimino/shared";
import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import { chooseMove } from "./ai.ts";

export interface Member {
  id: string;
  clientId: string;
  name: string;
  ws: WebSocket | null;
  joinedAt: number;
  /** Jogador IA controlado pelo servidor (sem conexão). */
  bot?: boolean;
}

const LOTTERY_REVEAL_MS = 3500;
/** Pausa antes de cada ação do robô, para os humanos acompanharem a jogada. */
const BOT_DELAY_MS = 1100;
const BOT_NAMES = ["IA Lia", "IA Rui", "IA Téo"];

const newId = () => randomBytes(4).toString("hex");

export class Room {
  members = new Map<string, Member>();
  game: TriminoGame | null = null;
  private emptySince: number | null = null;
  /** Evita que duas ações de robô rodem ao mesmo tempo. */
  private botBusy = false;

  constructor(readonly code: string) {}

  get hostId(): string | null {
    // Anfitrião = membro conectado mais antigo.
    let host: Member | null = null;
    for (const m of this.members.values()) if (m.ws && !m.bot && (!host || m.joinedAt < host.joinedAt)) host = m;
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
    if (!this.humansOnline) this.emptySince = Date.now();
    this.broadcastState();
  }

  handle(member: Member, msg: ClientMessage): void {
    try {
      switch (msg.t) {
        case "start": {
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode iniciar.");
          if (this.game && this.game.phase !== "gameOver") throw new RuleError("A partida já começou.");
          const seats = [...this.members.values()].filter((m) => m.ws || m.bot).slice(0, MAX_PLAYERS);
          if (seats.length < MIN_PLAYERS) throw new RuleError(`São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
          this.game = new TriminoGame(seats.map((m) => ({ id: m.id, name: m.name })));
          break;
        }
        case "addBot": {
          this.requireHostOutsideMatch(member);
          const seats = [...this.members.values()].filter((m) => m.ws || m.bot).length;
          if (seats >= MAX_PLAYERS) throw new RuleError(`A sala já tem ${MAX_PLAYERS} jogadores.`);
          const used = new Set([...this.members.values()].map((m) => m.name));
          const name = BOT_NAMES.find((n) => !used.has(n)) ?? `IA ${seats + 1}`;
          const id = newId();
          this.members.set(id, { id, clientId: `bot:${id}`, name, ws: null, joinedAt: Date.now(), bot: true });
          break;
        }
        case "removeBot": {
          this.requireHostOutsideMatch(member);
          const bot = this.members.get(msg.id);
          if (!bot?.bot) throw new RuleError("Jogador IA não encontrado.");
          this.members.delete(bot.id);
          break;
        }
        case "pickLot": {
          const game = this.requireGame();
          game.pickLot(member.id, msg.slot);
          this.beginAfterLottery(game);
          break;
        }
        case "forfeit": {
          const game = this.requireGame();
          game.forfeit(member.id);
          this.beginAfterLottery(game);
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

  /** Deixa todos verem as pedras reveladas por alguns segundos antes de dar as cartas. */
  private beginAfterLottery(game: TriminoGame): void {
    if (!game.lotteryDone) return;
    setTimeout(() => {
      if (this.game === game && game.lotteryDone) {
        game.beginFirstRound();
        this.broadcastState();
      }
    }, LOTTERY_REVEAL_MS);
  }

  private requireHostOutsideMatch(member: Member): void {
    if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode mudar os jogadores IA.");
    if (this.game && this.game.phase !== "gameOver") throw new RuleError("Não dá para mudar os jogadores durante a partida.");
  }

  private get humansOnline(): boolean {
    return [...this.members.values()].some((m) => m.ws && !m.bot);
  }

  /**
   * Faz os robôs agirem quando é a vez deles (ou no sorteio). Chamado a cada mudança de estado.
   * Só joga enquanto houver algum humano conectado, para não gastar chamadas de IA à toa.
   */
  private driveBots(): void {
    const game = this.game;
    if (!game || this.botBusy || !this.humansOnline) return;
    const isBot = (id: string) => !!this.members.get(id)?.bot;

    if (game.phase === "lottery" && !game.lotteryDone) {
      const bot = game.active.find((p) => isBot(p.id) && !game.lotteryPicks.some((x) => x.playerId === p.id));
      if (!bot) return;
      this.botAct(game, BOT_DELAY_MS / 2, () => {
        const free = game.lotteryPool.map((_, i) => i).filter((i) => !game.lotteryPicks.some((x) => x.slot === i));
        game.pickLot(bot.id, free[Math.floor(Math.random() * free.length)]);
        this.beginAfterLottery(game);
      });
      return;
    }

    if (game.phase !== "playing" || !isBot(game.current.id)) return;
    const botId = game.current.id;
    this.botAct(game, BOT_DELAY_MS, async () => {
      if (game.current.id !== botId) return;
      if (game.validMoves(botId).length) {
        const m = await chooseMove(game, botId);
        // o estado pode ter mudado enquanto a IA pensava (ex.: alguém desistiu)
        if (this.game === game && game.phase === "playing" && game.current.id === botId) game.place(botId, m.tileId, m.r, m.c, m.rot);
      } else if (game.canDraw(botId)) game.draw(botId);
      else game.pass(botId);
    });
  }

  private botAct(game: TriminoGame, delay: number, action: () => void | Promise<void>): void {
    this.botBusy = true;
    setTimeout(async () => {
      try {
        if (this.game === game) await action();
      } catch (err) {
        console.error("[ia] ação falhou:", err);
      } finally {
        this.botBusy = false;
        if (this.game === game) this.broadcastState();
      }
    }, delay);
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
      .filter((m) => m.ws || m.bot || seated(m.id))
      .map((m) => {
        const p = seated(m.id);
        return {
          id: m.id,
          name: m.name,
          score: p?.score ?? 0,
          handCount: p?.hand.length ?? 0,
          connected: m.ws !== null || !!m.bot,
          isHost: m.id === hostId,
          spectator: !!g && !p,
          out: p?.out ?? false,
          bot: !!m.bot,
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
      winnerId: g?.winnerId ?? null,
      celebration: g?.celebration ?? null,
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
    this.driveBots();
  }

  broadcast(msg: ServerMessage): void {
    for (const m of this.members.values()) if (m.ws) send(m.ws, msg);
  }
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
