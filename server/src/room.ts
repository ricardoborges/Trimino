import { MAX_PLAYERS, MIN_PLAYERS, RuleError, TriminoGame, fullSet, type ClientMessage, type GameState, type MesaSummary, type ServerMessage, type TokenLog } from "@trimino/shared";
import { chooseMove, model } from "./ai.ts";

/** O mínimo de um WebSocket que a sala usa (serve o do Workers e o do pacote `ws`). */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Member {
  id: string;
  clientId: string;
  name: string;
  ws: Socket | null;
  joinedAt: number;
  /** Jogador IA controlado pelo servidor (sem conexão). */
  bot?: boolean;
  /** Conta do jogador; ausente para convidados e robôs. */
  userId?: string;
  /** Administrador do site: só ele adiciona e remove jogadores IA. */
  admin?: boolean;
  /** Espectador: só assiste, não ocupa lugar na mesa. */
  watch?: boolean;
  /** Espectador pediu para entrar na videoconferência. */
  callRequested?: boolean;
  /** O anfitrião deixou o espectador entrar na videoconferência. */
  callApproved?: boolean;
  /** Já está na videoconferência (o que o cliente sabe). */
  inCall?: boolean;
}

/** Resultado de uma partida terminada, para as estatísticas. */
export interface MatchResult {
  code: string;
  rounds: number;
  winnerId: string | null;
  players: { id: string; userId?: string; name: string; bot: boolean; score: number; out: boolean; won: boolean; position: number }[];
}

const LOTTERY_REVEAL_MS = 3500;
/** Pausa antes de cada ação do robô, para os humanos acompanharem a jogada. */
const BOT_DELAY_MS = 1100;
/** Nomes dos jogadores IA, na ordem em que são adicionados. Todo jogador IA leva "(IA)" no nome. */
const BOT_NAMES = ["Ricardo (IA)", "Ilana (IA)", "Henrique (IA)"];

const newId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** Quantas jogadas de robô o registro de tokens guarda (os totais somam todas). */
const TOKEN_LOG_SIZE = 200;
const emptyTokenLog = (): TokenLog => ({ model: model(), entries: [], totals: { calls: 0, prompt: 0, completion: 0, reasoning: 0, total: 0 } });

export class Room {
  members = new Map<string, Member>();
  game: TriminoGame | null = null;
  /** Evita que duas ações de robô rodem ao mesmo tempo. */
  private botBusy = false;
  /** Muda a cada reinício, para descartar ações de robô agendadas antes dele. */
  private epoch = 0;
  /** Tokens gastos pelos robôs na partida atual. */
  private tokens = emptyTokenLog();
  /** Partida cujo resultado já foi registrado. */
  private recorded: TriminoGame | null = null;
  /** Nome da mesa (escolhido na varanda). */
  title = "";
  /** Chamado depois de cada mudança de estado (a varanda acompanha as mesas por aqui). */
  onChange?: () => void;
  /** Chamado uma vez quando uma partida termina. */
  onGameOver?: (result: MatchResult) => void;

  constructor(readonly code: string) {}

  get hostId(): string | null {
    // Anfitrião = jogador conectado mais antigo (espectadores não contam).
    let host: Member | null = null;
    for (const m of this.members.values()) if (m.ws && !m.bot && !m.watch && (!host || m.joinedAt < host.joinedAt)) host = m;
    return host?.id ?? null;
  }

  /** Fora de partida (antes da primeira ou depois do fim), os lugares estão livres. */
  private get betweenMatches(): boolean {
    return !this.game || this.game.phase === "gameOver";
  }

  /** Lugares ocupados por quem vai jogar a próxima partida (conectados e robôs). */
  private get seatsTaken(): number {
    return [...this.members.values()].filter((m) => (m.ws || m.bot) && !m.watch).length;
  }

  /**
   * Quem volta para a mesa: a mesma aba (`clientId`) ou, se o lugar estiver vago, quem fechou a aba ou o
   * navegador sem querer (`resume`, guardado no navegador) ou entrou com a mesma conta.
   * Lugar ocupado por outra conexão não é tomado: duas abas abertas continuam sendo duas pessoas.
   */
  returning(clientId: string, resume?: string, userId?: string): Member | undefined {
    const members = [...this.members.values()].filter((m) => !m.bot);
    return (
      members.find((m) => m.clientId === clientId) ??
      (resume ? members.find((m) => !m.ws && m.clientId === resume) : undefined) ??
      (userId ? members.find((m) => !m.ws && m.userId === userId) : undefined)
    );
  }

  get humansConnected(): number {
    return [...this.members.values()].filter((m) => m.ws && !m.bot).length;
  }

  /** Jogadores estão sempre na videoconferência; espectadores, só com a permissão do anfitrião. */
  private inCallOf(m: Member): boolean {
    if (!m.ws || m.bot) return false;
    if (m.callApproved) return true;
    return !m.watch && (this.betweenMatches || !!this.game?.player(m.id));
  }

  /** Quem já está na videoconferência, menos `except`. */
  callPeers(except: Member): string[] {
    return [...this.members.values()].filter((m) => m !== except && m.inCall && m.ws).map((m) => m.id);
  }

  join(ws: Socket, name: string, clientId: string, opts: { watch?: boolean; userId?: string; admin?: boolean; resume?: string } = {}): Member {
    let member = this.returning(clientId, opts.resume, opts.userId);
    if (member) {
      member.ws?.close(4000, "Conectado em outro lugar");
      member.ws = ws;
      member.clientId = clientId;
      member.name = name || member.name;
      member.admin = !!opts.admin;
    } else {
      // Sem lugar livre, quem chega fica assistindo.
      const watch = !!opts.watch || (this.betweenMatches && this.seatsTaken >= MAX_PLAYERS);
      member = { id: newId(), clientId, name: name || "Jogador", ws, joinedAt: Date.now(), userId: opts.userId, admin: !!opts.admin, watch };
      this.members.set(member.id, member);
    }
    member.inCall = this.inCallOf(member);
    return member;
  }

  leave(member: Member, ws: Socket): void {
    if (member.ws !== ws) return; // já foi substituído por uma reconexão
    member.ws = null;
    member.inCall = false;
    member.callRequested = false;
    member.callApproved = false;
    if (!this.game || this.game.phase === "gameOver") {
      // Fora de partida não precisamos guardar a vaga.
      if (!this.game?.player(member.id)) this.members.delete(member.id);
    }
    this.broadcast({ t: "peerLeft", id: member.id });
    this.broadcastState();
  }

  handle(member: Member, msg: ClientMessage): void {
    try {
      switch (msg.t) {
        case "start":
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode iniciar.");
          if (this.game && this.game.phase !== "gameOver") throw new RuleError("A partida já começou.");
          this.newGame();
          break;
        case "restartGame":
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode reiniciar a partida.");
          if (!this.game) throw new RuleError("A partida ainda não começou.");
          this.newGame();
          break;
        case "restartRound":
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode reiniciar a rodada.");
          this.requireGame().restartRound();
          this.epoch++;
          break;
        case "addBot": {
          this.requireHostOutsideMatch(member);
          const seats = this.seatsTaken;
          if (seats >= MAX_PLAYERS) throw new RuleError(`A sala já tem ${MAX_PLAYERS} jogadores.`);
          const used = new Set([...this.members.values()].map((m) => m.name));
          const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Jogador ${seats + 1} (IA)`;
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
        case "removePlayer": {
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode tirar alguém da partida.");
          if (msg.id === member.id) throw new RuleError("Para sair, use o botão Sair.");
          const game = this.requireGame();
          const target = game.player(msg.id);
          if (!target || target.out) throw new RuleError("Este jogador não está na partida.");
          game.forfeit(target.id, member.name);
          this.beginAfterLottery(game);
          const ws = this.members.get(target.id)?.ws;
          if (ws) send(ws, { t: "notice", message: `${member.name} tirou você da partida.` });
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
        case "signal": {
          // Só entre quem está na videoconferência.
          const target = this.members.get(msg.to);
          if (member.inCall && target?.inCall && target.ws) send(target.ws, { t: "signal", from: member.id, data: msg.data });
          return;
        }
        case "sit":
          if (!member.watch) return;
          if (!this.betweenMatches) throw new RuleError("Espere a partida terminar para sentar.");
          if (this.seatsTaken >= MAX_PLAYERS) throw new RuleError(`A mesa já tem ${MAX_PLAYERS} jogadores.`);
          member.watch = false;
          member.callRequested = false;
          break;
        case "requestCall": {
          if (member.inCall || member.callRequested) return;
          member.callRequested = true;
          const host = this.hostId ? this.members.get(this.hostId) : null;
          if (host?.ws) send(host.ws, { t: "notice", message: `${member.name} pediu para entrar na conversa.` });
          break;
        }
        case "leaveCall":
          member.callRequested = false;
          member.callApproved = false;
          break;
        case "answerCall": {
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode responder.");
          const guest = this.members.get(msg.id);
          if (!guest?.callRequested) return;
          guest.callRequested = false;
          guest.callApproved = !!msg.allow;
          if (!msg.allow && guest.ws) send(guest.ws, { t: "notice", message: "O anfitrião não liberou sua entrada na conversa." });
          break;
        }
        case "endCall": {
          if (member.id !== this.hostId) throw new RuleError("Só o anfitrião pode tirar alguém da conversa.");
          const guest = this.members.get(msg.id);
          if (!guest?.callApproved) return;
          guest.callApproved = false;
          if (guest.ws) send(guest.ws, { t: "notice", message: "O anfitrião encerrou sua participação na conversa." });
          break;
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

  /** Partida nova com quem está na sala (conectados e robôs), a partir do sorteio. */
  private newGame(): void {
    const seats = [...this.members.values()].filter((m) => (m.ws || m.bot) && !m.watch).slice(0, MAX_PLAYERS);
    if (seats.length < MIN_PLAYERS) throw new RuleError(`São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
    this.game = new TriminoGame(seats.map((m) => ({ id: m.id, name: m.name })));
    this.tokens = emptyTokenLog();
    this.epoch++;
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
    if (!member.admin) throw new RuleError("Só o administrador pode mudar os jogadores IA.");
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
    const epoch = this.epoch;
    this.botAct(game, BOT_DELAY_MS, async () => {
      if (game.current.id !== botId) return;
      if (game.validMoves(botId).length) {
        const choice = await chooseMove(game, botId);
        // o estado pode ter mudado enquanto a IA pensava (ex.: alguém desistiu)
        const valid = this.game === game && this.epoch === epoch && game.phase === "playing" && game.current.id === botId;
        if (valid || choice.usage) this.logTokens(game, botId, choice, valid);
        const m = choice.move;
        if (valid) game.place(botId, m.tileId, m.r, m.c, m.rot);
      } else if (game.canDraw(botId)) game.draw(botId);
      else game.pass(botId);
    });
  }

  /** Registra uma jogada de robô (e os tokens que ela gastou). `played`: false se a jogada foi descartada. */
  private logTokens(game: TriminoGame, botId: string, choice: Awaited<ReturnType<typeof chooseMove>>, played: boolean): void {
    if (this.game !== game) return;
    const u = choice.usage ?? { prompt: 0, completion: 0, reasoning: 0, total: 0 };
    const log = this.tokens;
    log.entries.push({
      round: game.round,
      bot: game.player(botId)?.name ?? "IA",
      tile: fullSet()[choice.move.tileId].v,
      points: choice.points,
      source: choice.source,
      note: played ? choice.note : "descartada (a partida mudou)",
      ...u,
      ms: choice.ms,
    });
    if (log.entries.length > TOKEN_LOG_SIZE) log.entries.shift();
    if (choice.usage) log.totals.calls++;
    log.totals.prompt += u.prompt;
    log.totals.completion += u.completion;
    log.totals.reasoning += u.reasoning;
    log.totals.total += u.total;
  }

  private botAct(game: TriminoGame, delay: number, action: () => void | Promise<void>): void {
    this.botBusy = true;
    const epoch = this.epoch;
    setTimeout(async () => {
      try {
        if (this.game === game && this.epoch === epoch) await action();
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
          spectator: g && g.phase !== "gameOver" ? !p : !!m.watch,
          out: p?.out ?? false,
          bot: !!m.bot,
          inCall: !!m.inCall,
          callRequested: !!m.callRequested,
          guest: !m.bot && !m.userId,
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
      title: this.title || undefined,
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
      scoreSheet: g?.players.map((p) => ({ playerId: p.id, marks: p.marks })) ?? [],
      celebration: g?.celebration ?? null,
      finalLap: g?.finalLap ?? null,
      tokens: g && g.players.some((p) => this.members.get(p.id)?.bot) ? this.tokens : null,
      you: {
        id: viewer.id,
        hand: me?.hand ?? [],
        frontier: g && g.phase === "playing" ? g.frontier().map(([r, c]) => ({ r, c })) : [],
        canDraw: g ? g.canDraw(viewer.id) : false,
        canPass: g ? g.canPass(viewer.id) : false,
        canManageBots: !!viewer.admin,
      },
    };
  }

  broadcastState(): void {
    this.syncCalls();
    for (const m of this.members.values()) if (m.ws) send(m.ws, { t: "state", state: this.stateFor(m) });
    this.recordResult();
    this.driveBots();
    this.onChange?.();
  }

  /**
   * Põe e tira gente da videoconferência quando muda quem tem direito a ela (espectador liberado,
   * partida começando ou terminando). Quem entra oferta para quem já está, como ao chegar na sala.
   */
  private syncCalls(): void {
    for (const m of this.members.values()) {
      const now = this.inCallOf(m);
      if (!m.ws || now === !!m.inCall) continue;
      m.inCall = now;
      if (now) send(m.ws, { t: "call", peers: this.callPeers(m) });
      else {
        send(m.ws, { t: "callEnded" });
        for (const o of this.members.values()) if (o !== m && o.inCall && o.ws) send(o.ws, { t: "peerLeft", id: m.id });
      }
    }
  }

  /**
   * Avisa o fim da partida (uma vez por partida) para registrar as estatísticas.
   * Só conta partida concluída (alguém chegou à meta): se acabou porque os outros desistiram, não vale para o ranking.
   */
  private recordResult(): void {
    const g = this.game;
    if (!g || g.phase !== "gameOver" || this.recorded === g) return;
    this.recorded = g;
    if (g.endedByForfeit) return;
    const ranked = [...g.players].sort((a, b) => b.score - a.score);
    const winnerId = g.winnerId ?? ranked[0]?.id ?? null;
    this.onGameOver?.({
      code: this.code,
      rounds: g.round,
      winnerId,
      players: g.players.map((p) => {
        const m = this.members.get(p.id);
        return {
          id: p.id,
          userId: m?.userId,
          name: p.name,
          bot: !!m?.bot,
          score: p.score,
          out: !!p.out,
          won: p.id === winnerId,
          position: ranked.findIndex((x) => x.id === p.id) + 1,
        };
      }),
    });
  }

  /** Resumo da mesa para a varanda. */
  summary(): MesaSummary {
    const g = this.game;
    const hostId = this.hostId;
    const seated: Member[] = g && g.phase !== "gameOver"
      ? g.players.map((p) => this.members.get(p.id)).filter((m): m is Member => !!m)
      : [...this.members.values()].filter((m) => (m.ws || m.bot) && !m.watch);
    return {
      code: this.code,
      title: this.title || `Mesa ${this.code}`,
      phase: g?.phase ?? "lobby",
      round: g?.round ?? 0,
      players: seated.map((m) => ({
        name: m.name,
        score: g?.player(m.id)?.score ?? 0,
        bot: !!m.bot,
        host: m.id === hostId,
        connected: !!m.ws || !!m.bot,
      })),
      spectators: [...this.members.values()].filter((m) => m.ws && !seated.includes(m)).length,
      seatsFree: this.betweenMatches ? Math.max(0, MAX_PLAYERS - this.seatsTaken) : 0,
      updatedAt: Date.now(),
    };
  }

  broadcast(msg: ServerMessage): void {
    for (const m of this.members.values()) if (m.ws) send(m.ws, msg);
  }
}

export function send(ws: Socket, msg: ServerMessage): void {
  if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg));
}
