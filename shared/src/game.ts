// Regras do Triminó. Roda no servidor; os clientes apenas exibem o estado.

import { cellKey, cellVertices, cellsAroundVertex, edgeNeighbors, vertexKey } from "./geometry.ts";
import type { BoardCell, LogEntry, Move, Phase, RoundSummary } from "./protocol.ts";
import { fullSet, isTriple, rotated, tileSum, type Tile } from "./tiles.ts";

export const SCORE = {
  hexagon: 50,
  bridge: 40,
  openingTriple: 10,
  openingZeroTriple: 40,
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
}

export interface PlaceResult {
  points: number;
  bonuses: string[];
}

export class RuleError extends Error {}

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
  private starter = 0;
  roundSummary: RoundSummary | null = null;
  log: LogEntry[] = [];

  constructor(
    players: { id: string; name: string }[],
    readonly targetScore = 400,
    private readonly random: () => number = Math.random,
  ) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS)
      throw new RuleError(`São necessários de ${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores.`);
    this.players = players.map((p) => ({ ...p, hand: [], score: 0 }));
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
    if (!p) throw new RuleError("Você não está nesta partida.");
    if (this.lotteryPicks.some((x) => x.playerId === playerId)) throw new RuleError("Você já tirou sua pedra.");
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.lotteryPool.length) throw new RuleError("Pedra inválida.");
    if (this.lotteryPicks.some((x) => x.slot === slot)) throw new RuleError("Essa pedra já foi escolhida.");
    const tile = this.lotteryPool[slot];
    this.lotteryPicks.push({ playerId, slot, tile });
    this.addLog({ actor: p.name, action: "tirou", tile: tile.v });
    if (this.lotteryPicks.length === this.players.length) {
      const best = this.lotteryPicks.reduce((a, b) => (lotRank(b.tile) > lotRank(a.tile) ? b : a));
      this.lotteryWinnerId = best.playerId;
      this.addLog({ actor: this.player(best.playerId)!.name, action: "tirou a maior pedra e começa!" });
    }
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

  startRound(first = false): void {
    if (this.phase === "gameOver") throw new RuleError("O jogo acabou.");
    if (this.phase === "lottery" && !first) throw new RuleError("O sorteio ainda não terminou.");
    if (!first) this.starter = (this.starter + 1) % this.players.length;
    this.round++;
    this.phase = "playing";
    this.board.clear();
    this.vertices.clear();
    this.roundSummary = null;
    this.drawsThisTurn = 0;
    this.consecutivePasses = 0;

    this.pool = this.shuffled();
    const n = handSize(this.players.length);
    for (const p of this.players) p.hand = this.pool.splice(0, n);

    this.turn = this.starter;
    this.addLog({ action: `Rodada ${this.round}: ${this.current.name} começa com a peça que quiser.` });
  }

  // ---------- consultas ----------

  /** Valores que a peça teria em cada vértice da célula, ou null se não encaixa. */
  private fits(tile: Tile, r: number, c: number, rot: number): Move | null {
    if (this.board.has(cellKey(r, c))) return null;
    const vals = rotated(tile.v, rot);
    if (this.board.size === 0) return { tileId: tile.id, r, c, rot, vals };
    if (!edgeNeighbors(r, c).some(([nr, nc]) => this.board.has(cellKey(nr, nc)))) return null;
    const verts = cellVertices(r, c);
    for (let i = 0; i < 3; i++) {
      const existing = this.vertices.get(vertexKey(...verts[i]));
      if (existing !== undefined && existing !== vals[i]) return null;
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

    const verts = cellVertices(r, c);
    const bonuses: string[] = [];
    let points = tileSum(tile);

    if (this.board.size === 0) {
      if (isTriple(tile)) {
        const bonus = tile.v[0] === 0 ? SCORE.openingZeroTriple : SCORE.openingTriple;
        points += bonus;
        bonuses.push(`abertura com triplo +${bonus}`);
      }
    } else {
      // Ponte: um canto encosta numa peça que não é vizinha por aresta.
      const neighborVerts = new Set<string>();
      for (const [nr, nc] of edgeNeighbors(r, c))
        if (this.board.has(cellKey(nr, nc))) for (const v of cellVertices(nr, nc)) neighborVerts.add(vertexKey(...v));
      if (verts.some((v) => this.vertices.has(vertexKey(...v)) && !neighborVerts.has(vertexKey(...v)))) {
        points += SCORE.bridge;
        bonuses.push(`ponte +${SCORE.bridge}`);
      }
    }

    p.hand.splice(idx, 1);
    this.board.set(cellKey(r, c), { r, c, vals: move.vals, tileId, by: p.id });
    verts.forEach((v, i) => this.vertices.set(vertexKey(...v), move.vals[i]));

    for (const [x, y] of verts)
      if (cellsAroundVertex(x, y).every(([cr, cc]) => this.board.has(cellKey(cr, cc)))) {
        points += SCORE.hexagon;
        bonuses.push(`hexágono +${SCORE.hexagon}`);
      }

    p.score += points;
    this.consecutivePasses = 0;
    this.addLog({ actor: p.name, action: "jogou", tile: tile.v, points, note: bonuses.length ? bonuses.join(", ") : undefined });

    if (p.hand.length === 0) this.endRound(p, "emptyHand");
    else this.nextTurn();
    return { points, bonuses };
  }

  draw(playerId: string): Tile {
    if (!this.canDraw(playerId)) throw new RuleError("Você não pode comprar agora.");
    const p = this.current;
    const tile = this.pool.pop()!;
    p.hand.push(tile);
    p.score -= SCORE.drawPenalty;
    this.drawsThisTurn++;
    this.addLog({ actor: p.name, action: "comprou uma peça", points: -SCORE.drawPenalty });
    return tile;
  }

  pass(playerId: string): void {
    if (!this.canPass(playerId)) throw new RuleError("Compre até 3 peças antes de passar.");
    const p = this.current;
    p.score -= SCORE.passPenalty;
    this.consecutivePasses++;
    this.addLog({ actor: p.name, action: "passou a vez", points: -SCORE.passPenalty });
    if (this.pool.length === 0 && this.consecutivePasses >= this.players.length) this.endBlocked();
    else this.nextTurn();
  }

  private nextTurn(): void {
    this.turn = (this.turn + 1) % this.players.length;
    this.drawsThisTurn = 0;
  }

  private endRound(winner: GamePlayer, reason: RoundSummary["reason"]): void {
    const others = this.players.filter((p) => p !== winner);
    const rest = others.reduce((s, p) => s + p.hand.reduce((a, t) => a + tileSum(t), 0), 0);
    const points = reason === "emptyHand" ? SCORE.emptyHand + rest : rest - winner.hand.reduce((a, t) => a + tileSum(t), 0);
    winner.score += points;
    this.roundSummary = { winnerId: winner.id, reason, points };
    if (reason === "blocked") this.addLog({ action: "Jogo travado: ninguém consegue jogar." });
    this.addLog({
      actor: winner.name,
      action: reason === "emptyHand" ? "esvaziou a mão" : "tinha menos pontos na mão",
      points,
    });
    const top = Math.max(...this.players.map((p) => p.score));
    if (top >= this.targetScore) {
      this.phase = "gameOver";
      const champ = this.players.find((p) => p.score === top)!;
      this.addLog({ actor: `🏆 ${champ.name}`, action: "venceu o jogo!", note: `${top} pontos` });
    } else {
      this.phase = "roundOver";
    }
  }

  private endBlocked(): void {
    const handValue = (p: GamePlayer) => p.hand.reduce((a, t) => a + tileSum(t), 0);
    const winner = this.players.reduce((a, b) => (handValue(b) < handValue(a) ? b : a));
    this.endRound(winner, "blocked");
  }

  private addLog(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > 50) this.log.shift();
  }
}
