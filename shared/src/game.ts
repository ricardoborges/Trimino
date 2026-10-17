// Regras do Triminó. Roda no servidor; os clientes apenas exibem o estado.

import { cellKey, cellVertices, cellsAroundVertex, edgeNeighbors, vertexKey } from "./geometry.ts";
import type { BoardCell, LogEntry, Move, Phase, RoundSummary, ScoreMark } from "./protocol.ts";
import { fullSet, rotated, tileSum, type Tile } from "./tiles.ts";

export const SCORE = {
  mandala: 50,
  bridge: 40,
  emptyHand: 25,
  drawPenalty: 5,
  passPenalty: 10,
  maxDrawsPerTurn: 3,
} as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Quantas pedras viradas para baixo aparecem no sorteio de quem começa. */
export const LOTTERY_SLOTS = 12;

export const handSize = (players: number): number => (players === 2 ? 9 : 7);

export interface GamePlayer {
  id: string;
  name: string;
  hand: Tile[];
  score: number;
  /** Totais anotados na folha de pontos. */
  marks: ScoreMark[];
  /** Desistiu: fica fora das rodadas, mas continua no placar. */
  out: boolean;
}

export interface PlaceResult {
  points: number;
  bonuses: string[];
  /** Pedras que formaram cada bônus (para o destaque no tabuleiro). */
  formations: Formation[];
}

export interface Formation {
  kind: "ponte" | "mandala";
  cells: { r: number; c: number }[];
}

export class RuleError extends Error {}

export interface Celebration {
  seq: number;
  playerId: string;
  points: number;
  formations: Formation[];
  /** A jogada foi a batida (o jogador colocou a última pedra da mão). */
  batida?: boolean;
}

export interface LotPick {
  playerId: string;
  slot: number;
  tile: Tile;
}

/** Ordem do sorteio: maior soma vence; empate decidido pela peça de maior id (números mais altos). */
export const lotRank = (t: Tile): number => tileSum(t) * 100 + t.id;

export class TriminoGame {
  phase: Phase = "lottery";
  round = 0;
  players: GamePlayer[];
  pool: Tile[] = [];
  board = new Map<string, BoardCell>();
  vertices = new Map<string, number>();
  turn = 0;
  drawsThisTurn = 0;
  consecutivePasses = 0;
  /** Pedras do sorteio (viradas para baixo) e o que cada jogador tirou. */
  lotteryPool: Tile[] = [];
  lotteryPicks: LotPick[] = [];
  lotteryWinnerId: string | null = null;
  /** Índice de quem abriu a rodada atual; a próxima rodada começa com o seguinte. */
  /** Índice de quem abriu a rodada atual. */
  private starter = 0;
  /** Pontos e anotações de cada jogador no começo da rodada atual, para poder reiniciá-la. */
  private roundStart = new Map<string, { score: number; marks: number }>();
  roundSummary: RoundSummary | null = null;
  /** Vencedor da partida (definido no fim do jogo). */
  winnerId: string | null = null;
  /** Última ponte/mandala; `seq` cresce a cada uma para o cliente comemorar uma vez só. */
  celebration: Celebration | null = null;
  /**
   * Depois da batida, cada adversário joga uma última vez (na ordem da vez); `pending` são os que faltam.
   * Quando acabam, as pedras que sobraram nas mãos são acertadas.
   */
  finalLap: { batedorId: string; pending: string[] } | null = null;
  log: LogEntry[] = [];

  constructor(
    players: { id: string; name: string }[],
    readonly targetScore = 400,
    private readonly random: () => number = Math.random,
  ) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS)
      throw new RuleError(`São necessários de ${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores.`);
    this.players = players.map((p) => ({ ...p, hand: [], score: 0, marks: [], out: false }));
    this.lotteryPool = this.shuffled().slice(0, LOTTERY_SLOTS);
    this.addLog({ action: "Sorteio: cada jogador escolhe uma pedra. A maior começa." });
  }

  private shuffled(): Tile[] {
    const tiles = fullSet();
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return tiles;
  }

  // ---------- sorteio ----------

  pickLot(playerId: string, slot: number): void {
    if (this.phase !== "lottery") throw new RuleError("O sorteio já terminou.");
    const p = this.player(playerId);
    if (!p || p.out) throw new RuleError("Você não está nesta partida.");
    if (this.lotteryPicks.some((x) => x.playerId === playerId)) throw new RuleError("Você já tirou sua pedra.");
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.lotteryPool.length) throw new RuleError("Pedra inválida.");
    if (this.lotteryPicks.some((x) => x.slot === slot)) throw new RuleError("Essa pedra já foi escolhida.");
    const tile = this.lotteryPool[slot];
    this.lotteryPicks.push({ playerId, slot, tile });
    this.addLog({ actor: p.name, action: "tirou", tile: tile.v });
    this.checkLottery();
  }

  /** Quando todos os jogadores ativos já tiraram, define quem começa. */
  private checkLottery(): void {
    const active = this.active;
    if (this.lotteryWinnerId || active.some((p) => !this.lotteryPicks.some((x) => x.playerId === p.id))) return;
    const best = this.lotteryPicks.reduce((a, b) => (lotRank(b.tile) > lotRank(a.tile) ? b : a));
    this.lotteryWinnerId = best.playerId;
    this.addLog({ actor: this.player(best.playerId)!.name, action: "tirou a maior pedra e começa!" });
  }

  get lotteryDone(): boolean {
    return this.phase === "lottery" && this.lotteryWinnerId !== null;
  }

  /** Encerra o sorteio e dá as cartas da primeira rodada. */
  beginFirstRound(): void {
    if (!this.lotteryDone) throw new RuleError("O sorteio ainda não terminou.");
    this.starter = this.players.findIndex((p) => p.id === this.lotteryWinnerId);
    this.startRound(true);
  }

  get current(): GamePlayer {
    return this.players[this.turn];
  }

  player(id: string): GamePlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Jogadores que ainda estão na partida (não desistiram). */
  get active(): GamePlayer[] {
    return this.players.filter((p) => !p.out);
  }

  /**
   * Quem abre as rodadas depois da primeira: o jogador ativo com menos pontos.
   * No empate, o primeiro deles na ordem da vez a partir de quem abriu a rodada anterior.
   */
  private lowestScorer(): number {
    let best = -1;
    for (let i = this.nextActive(this.starter), k = 0; k < this.players.length; i = (i + 1) % this.players.length, k++) {
      const p = this.players[i];
      if (!p.out && (best < 0 || p.score < this.players[best].score)) best = i;
    }
    return best;
  }

  /** Próximo índice de jogador ativo depois de `from`. */
  private nextActive(from: number): number {
    for (let i = 1; i <= this.players.length; i++) {
      const idx = (from + i) % this.players.length;
      if (!this.players[idx].out) return idx;
    }
    return from;
  }

  startRound(first = false): void {
    if (this.phase === "gameOver") throw new RuleError("O jogo acabou.");
    if (this.phase === "lottery" && !first) throw new RuleError("O sorteio ainda não terminou.");
    if (!first) this.starter = this.lowestScorer();
    else if (this.players[this.starter].out) this.starter = this.nextActive(this.starter);
    this.round++;
    this.roundStart = new Map(this.players.map((p) => [p.id, { score: p.score, marks: p.marks.length }]));
    this.deal();
    this.addLog({ action: `Rodada ${this.round}: ${this.current.name} começa com a peça que quiser.` });
  }

  /**
   * Anfitrião reinicia a rodada em andamento: os pontos voltam ao que eram no começo dela,
   * as peças são embaralhadas e distribuídas de novo, e quem começou começa outra vez.
   */
  restartRound(): void {
    if (this.phase !== "playing") throw new RuleError("Não há rodada em andamento para reiniciar.");
    for (const p of this.players) {
      const start = this.roundStart.get(p.id);
      if (!start) continue;
      p.score = start.score;
      p.marks.length = start.marks;
    }
    if (this.players[this.starter].out) this.starter = this.nextActive(this.starter);
    this.deal();
    this.addLog({ action: `Rodada ${this.round} reiniciada pelo anfitrião: ${this.current.name} começa.` });
  }

  /** Mesa limpa e peças novas para todos; a vez fica com quem abre a rodada. */
  private deal(): void {
    this.phase = "playing";
    this.finalLap = null;
    this.board.clear();
    this.vertices.clear();
    this.roundSummary = null;
    this.drawsThisTurn = 0;
    this.consecutivePasses = 0;

    this.pool = this.shuffled();
    const n = handSize(this.active.length);
    for (const p of this.players) p.hand = p.out ? [] : this.pool.splice(0, n);

    this.turn = this.starter;
  }

  // ---------- consultas ----------

  /** Valores que a peça teria em cada vértice da célula, ou null se não encaixa. */
  private fits(tile: Tile, r: number, c: number, rot: number): Move | null {
    if (this.board.has(cellKey(r, c))) return null;
    const vals = rotated(tile.v, rot);
    if (this.board.size === 0) return { tileId: tile.id, r, c, rot, vals };
    const neighbors = edgeNeighbors(r, c).flatMap(([nr, nc]) => this.board.get(cellKey(nr, nc)) ?? []);
    if (!neighbors.length) return null;
    // Só os cantos divididos com vizinhas por aresta precisam bater. O canto que encosta numa peça
    // só pela ponta (a ponte) vale com qualquer número — regra da casa.
    const verts = cellVertices(r, c).map((v) => vertexKey(...v));
    for (const n of neighbors)
      for (const [j, v] of cellVertices(n.r, n.c).entries()) {
        const i = verts.indexOf(vertexKey(...v));
        if (i >= 0 && n.vals[j] !== vals[i]) return null;
      }
    return { tileId: tile.id, r, c, rot, vals };
  }

  /** Células vazias vizinhas (por aresta) de alguma peça já no tabuleiro. */
  frontier(): [number, number][] {
    if (this.board.size === 0) return [[0, 0]];
    const seen = new Set<string>();
    const out: [number, number][] = [];
    for (const cell of this.board.values())
      for (const [r, c] of edgeNeighbors(cell.r, cell.c)) {
        const k = cellKey(r, c);
        if (!this.board.has(k) && !seen.has(k)) {
          seen.add(k);
          out.push([r, c]);
        }
      }
    return out;
  }

  validMoves(playerId: string): Move[] {
    const p = this.player(playerId);
    if (!p || this.phase !== "playing" || this.current.id !== playerId) return [];
    const tiles = p.hand;
    const moves: Move[] = [];
    const cells = this.frontier();
    for (const t of tiles)
      for (const [r, c] of cells)
        for (let rot = 0; rot < 3; rot++) {
          const m = this.fits(t, r, c, rot);
          if (m) moves.push(m);
        }
    return moves;
  }

  canDraw(playerId: string): boolean {
    return this.isTurnOf(playerId) && this.board.size > 0 && this.pool.length > 0 && this.drawsThisTurn < SCORE.maxDrawsPerTurn;
  }

  canPass(playerId: string): boolean {
    return this.isTurnOf(playerId) && this.board.size > 0 && (this.pool.length === 0 || this.drawsThisTurn >= SCORE.maxDrawsPerTurn);
  }

  private isTurnOf(playerId: string): boolean {
    return this.phase === "playing" && this.current.id === playerId;
  }

  // ---------- ações ----------

  place(playerId: string, tileId: number, r: number, c: number, rot: number): PlaceResult {
    if (!this.isTurnOf(playerId)) throw new RuleError("Não é a sua vez.");
    const p = this.current;
    const idx = p.hand.findIndex((t) => t.id === tileId);
    if (idx < 0) throw new RuleError("Essa peça não está na sua mão.");
    if (this.board.size === 0 && (r !== 0 || c !== 0)) throw new RuleError("A primeira peça vai no centro da mesa.");
    const tile = p.hand[idx];
    const move = this.fits(tile, r, c, ((rot % 3) + 3) % 3);
    if (!move) throw new RuleError("A peça não encaixa aí.");

    // Pontos da jogada = soma da pedra + bônus − 5 por pedra comprada nesta vez.
    const { points: gross, bonuses, formations } = this.evaluate(move);
    const penalty = this.drawPenalty();
    const points = gross - penalty;
    const verts = cellVertices(r, c);
    p.hand.splice(idx, 1);
    this.board.set(cellKey(r, c), { r, c, vals: move.vals, tileId, by: p.id });
    verts.forEach((v, i) => this.vertices.set(vertexKey(...v), move.vals[i]));

    // Batida: a primeira pessoa a colocar a última pedra da mão ganha +25 na hora.
    const batida = p.hand.length === 0 && !this.finalLap;
    p.score += points + (batida ? SCORE.emptyHand : 0);
    this.mark(p);
    this.consecutivePasses = 0;
    if (formations.length || batida)
      this.celebration = {
        seq: (this.celebration?.seq ?? 0) + 1,
        playerId: p.id,
        points: points + (batida ? SCORE.emptyHand : 0),
        formations,
        ...(batida && { batida }),
      };
    const notes = [...bonuses];
    if (penalty) notes.unshift(`pedra ${tileSum(tile)}`), notes.push(`−${penalty} de ${this.drawsLabel()}`);
    this.addLog({ actor: p.name, action: "jogou", tile: tile.v, points, note: notes.length ? notes.join(", ") : undefined });

    if (batida) {
      this.addLog({ actor: p.name, action: "bateu!", points: SCORE.emptyHand, note: "os outros jogam uma última vez" });
      const pending: string[] = [];
      for (let i = this.nextActive(this.turn); i !== this.turn; i = this.nextActive(i)) pending.push(this.players[i].id);
      this.finalLap = { batedorId: p.id, pending };
    }
    this.advance(true);
    return { points, bonuses, formations };
  }

  /** Desconto pelas pedras compradas nesta vez (cobrado ao jogar ou ao passar). */
  private drawPenalty(): number {
    return this.drawsThisTurn * SCORE.drawPenalty;
  }

  private drawsLabel(): string {
    return this.drawsThisTurn === 1 ? "1 compra" : `${this.drawsThisTurn} compras`;
  }

  /** Pontos que uma jogada válida renderia (peça + bônus), sem alterar o jogo. */
  evaluate(move: Move): PlaceResult {
    const { r, c, tileId } = move;
    const tile = fullSet()[tileId];
    const verts = cellVertices(r, c);
    const bonuses: string[] = [];
    const formations: Formation[] = [];
    let points = tileSum(tile);
    const occupied = (rr: number, cc: number) => this.board.has(cellKey(rr, cc));

    // A abertura vale só a soma dos pontos da pedra (sem bônus): abrir com 0-0-0 vale 0.
    if (this.board.size > 0) {
      // Ponte: um canto encosta numa peça que não é vizinha por aresta.
      const neighbors = edgeNeighbors(r, c).filter(([nr, nc]) => occupied(nr, nc));
      const neighborVerts = new Set<string>();
      for (const [nr, nc] of neighbors) for (const v of cellVertices(nr, nc)) neighborVerts.add(vertexKey(...v));
      const bridged = verts.filter((v) => this.vertices.has(vertexKey(...v)) && !neighborVerts.has(vertexKey(...v)));
      if (bridged.length) {
        points += SCORE.bridge;
        bonuses.push(`ponte +${SCORE.bridge}`);
        // a ponte: a peça nova, as vizinhas por aresta e as peças que encostam só pelo canto
        const across = bridged.flatMap(([x, y]) => cellsAroundVertex(x, y).filter(([cr, cc]) => occupied(cr, cc)));
        formations.push({ kind: "ponte", cells: [[r, c], ...neighbors, ...across].map(([cr, cc]) => ({ r: cr, c: cc })) });
      }
    }

    // Mandala (hexágono): esta peça fecha as seis células ao redor de um de seus cantos.
    const here = cellKey(r, c);
    for (const [x, y] of verts)
      if (cellsAroundVertex(x, y).every(([cr, cc]) => cellKey(cr, cc) === here || this.board.has(cellKey(cr, cc)))) {
        points += SCORE.mandala;
        bonuses.push(`mandala +${SCORE.mandala}`);
        formations.push({ kind: "mandala", cells: cellsAroundVertex(x, y).map(([cr, cc]) => ({ r: cr, c: cc })) });
      }
    return { points, bonuses, formations };
  }

  draw(playerId: string): Tile {
    if (!this.canDraw(playerId)) throw new RuleError("Você não pode comprar agora.");
    const p = this.current;
    const tile = this.pool.pop()!;
    p.hand.push(tile);
    this.drawsThisTurn++;
    // o −5 da compra é cobrado junto com a jogada (ou ao passar)
    this.addLog({ actor: p.name, action: "comprou uma peça" });
    return tile;
  }

  pass(playerId: string): void {
    if (!this.canPass(playerId)) throw new RuleError("Compre até 3 peças antes de passar.");
    const p = this.current;
    const drawn = this.drawPenalty();
    p.score -= SCORE.passPenalty + drawn;
    this.mark(p);
    this.consecutivePasses++;
    this.addLog({
      actor: p.name,
      action: "passou a vez",
      points: -(SCORE.passPenalty + drawn),
      note: drawn ? `−${SCORE.passPenalty} de passar, −${drawn} de ${this.drawsLabel()}` : undefined,
    });
    if (!this.finalLap && this.pool.length === 0 && this.consecutivePasses >= this.active.length) this.endBlocked();
    else this.advance(true);
  }

  /**
   * Passa a vez. Na última volta depois da batida, segue a lista de quem ainda falta jogar
   * (`turnDone`: o jogador da vez acabou de jogar ou passar) e, quando ela acaba, acerta as mãos.
   */
  private advance(turnDone: boolean): void {
    const lap = this.finalLap;
    if (!lap) {
      this.turn = this.nextActive(this.turn);
      this.drawsThisTurn = 0;
      return;
    }
    lap.pending = lap.pending.filter((id) => !this.player(id)?.out && !(turnDone && id === this.current.id));
    if (!lap.pending.length) {
      this.settleBatida();
      return;
    }
    const next = this.players.findIndex((x) => x.id === lap.pending[0]);
    if (next !== this.turn) this.drawsThisTurn = 0;
    this.turn = next;
  }

  /**
   * Jogador desiste: sai das rodadas, as peças da mão voltam para o monte e a partida segue com os demais.
   * Se sobrar um só, ele vence.
   */
  forfeit(playerId: string): void {
    const p = this.player(playerId);
    if (!p || p.out) throw new RuleError("Você não está nesta partida.");
    if (this.phase === "gameOver") throw new RuleError("A partida já terminou.");
    const wasTurn = this.phase === "playing" && this.current === p;
    p.out = true;
    if (p.hand.length) {
      this.pool.push(...p.hand);
      p.hand = [];
      for (let i = this.pool.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
      }
    }
    this.addLog({ actor: p.name, action: "desistiu da partida" });

    const active = this.active;
    if (active.length === 1) {
      this.finish(active[0], "os outros jogadores desistiram");
      return;
    }
    if (this.phase === "lottery") {
      this.lotteryPicks = this.lotteryPicks.filter((x) => x.playerId !== playerId);
      this.lotteryWinnerId = null;
      this.checkLottery();
    } else if (this.phase === "playing") {
      this.consecutivePasses = 0;
      if (this.finalLap) this.advance(false);
      else if (wasTurn) this.advance(true);
    }
  }

  private finish(champ: GamePlayer, note: string): void {
    this.phase = "gameOver";
    this.winnerId = champ.id;
    this.addLog({ actor: `🏆 ${champ.name}`, action: "venceu o jogo!", note });
  }

  /**
   * Fim da batida: cada adversário perde a soma das pedras que sobraram na mão dele,
   * e quem bateu ganha a soma de todas elas (além dos +25 que já levou ao bater).
   */
  private settleBatida(): void {
    const winner = this.player(this.finalLap!.batedorId)!;
    this.finalLap = null;
    const hands = this.active
      .filter((p) => p !== winner)
      .map((p) => ({ playerId: p.id, tiles: p.hand.map((t) => t.v), sum: p.hand.reduce((a, t) => a + tileSum(t), 0) }));
    const rest = hands.reduce((a, h) => a + h.sum, 0);
    for (const h of hands) {
      if (!h.sum) continue;
      const p = this.player(h.playerId)!;
      p.score -= h.sum;
      this.mark(p);
      this.addLog({ actor: p.name, action: "ficou com pedras na mão", points: -h.sum });
    }
    winner.score += rest;
    this.mark(winner, true);
    this.addLog({ actor: winner.name, action: "recebe as pedras dos adversários", points: rest });
    this.roundSummary = { winnerId: winner.id, reason: "emptyHand", points: SCORE.emptyHand + rest, bonus: SCORE.emptyHand, hands };
    this.closeRound();
  }

  /** Jogo travado: quem tem menos pontos na mão ganha a diferença para a soma das mãos dos outros. */
  private endRound(winner: GamePlayer, reason: RoundSummary["reason"]): void {
    const others = this.active.filter((p) => p !== winner);
    const rest = others.reduce((s, p) => s + p.hand.reduce((a, t) => a + tileSum(t), 0), 0);
    const points = rest - winner.hand.reduce((a, t) => a + tileSum(t), 0);
    winner.score += points;
    this.mark(winner, true);
    this.roundSummary = { winnerId: winner.id, reason, points };
    if (reason === "blocked") this.addLog({ action: "Jogo travado: ninguém consegue jogar." });
    this.addLog({ actor: winner.name, action: "tinha menos pontos na mão", points });
    this.closeRound();
  }

  /** Encerra a rodada; a partida acaba se alguém chegou à meta. */
  private closeRound(): void {
    const top = Math.max(...this.active.map((p) => p.score));
    if (top >= this.targetScore) {
      this.finish(this.active.find((p) => p.score === top)!, `${top} pontos`);
    } else {
      this.phase = "roundOver";
    }
  }

  private endBlocked(): void {
    const handValue = (p: GamePlayer) => p.hand.reduce((a, t) => a + tileSum(t), 0);
    const winner = this.active.reduce((a, b) => (handValue(b) < handValue(a) ? b : a));
    this.endRound(winner, "blocked");
  }

  private mark(p: GamePlayer, roundWin = false): void {
    p.marks.push({ round: this.round, total: p.score, ...(roundWin && { roundWin }) });
  }

  private addLog(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > 50) this.log.shift();
  }
}
