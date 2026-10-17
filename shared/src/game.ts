// Regras do Triminó. Roda no servidor; os clientes apenas exibem o estado.

import { cellKey, cellVertices, cellsAroundVertex, edgeNeighbors, vertexKey } from "./geometry.ts";
import type { BoardCell, Move, Phase, RoundSummary } from "./protocol.ts";
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

export class TriminoGame {
  phase: Phase = "playing";
  round = 0;
  players: GamePlayer[];
  pool: Tile[] = [];
  board = new Map<string, BoardCell>();
  vertices = new Map<string, number>();
  turn = 0;
  drawsThisTurn = 0;
  consecutivePasses = 0;
  openingTileId: number | null = null;
  roundSummary: RoundSummary | null = null;
  log: string[] = [];

  constructor(
    players: { id: string; name: string }[],
    readonly targetScore = 400,
    private readonly random: () => number = Math.random,
  ) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS)
      throw new RuleError(`São necessários de ${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores.`);
    this.players = players.map((p) => ({ ...p, hand: [], score: 0 }));
    this.startRound();
  }

  get current(): GamePlayer {
    return this.players[this.turn];
  }

  player(id: string): GamePlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  startRound(): void {
    if (this.phase === "gameOver") throw new RuleError("O jogo acabou.");
    this.round++;
    this.phase = "playing";
    this.board.clear();
    this.vertices.clear();
    this.roundSummary = null;
    this.drawsThisTurn = 0;
    this.consecutivePasses = 0;

    this.pool = fullSet();
    for (let i = this.pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
    }
    const n = handSize(this.players.length);
    for (const p of this.players) p.hand = this.pool.splice(0, n);

    // Começa quem tiver o triplo mais alto; sem triplos, a peça de maior soma.
    let best: { player: number; tile: Tile; rank: number } | null = null;
    this.players.forEach((p, i) => {
      for (const t of p.hand) {
        const rank = (isTriple(t) ? 1000 : 0) + tileSum(t) * 100 + t.id;
        if (!best || rank > best.rank) best = { player: i, tile: t, rank };
      }
    });
    const b = best!;
    this.turn = b.player;
    this.openingTileId = b.tile.id;
    this.addLog(`Rodada ${this.round}: ${this.current.name} abre com ${b.tile.v.join("-")}.`);
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
  private frontier(): [number, number][] {
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
    const tiles = this.openingTileId !== null ? p.hand.filter((t) => t.id === this.openingTileId) : p.hand;
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
    return this.isTurnOf(playerId) && this.openingTileId === null && this.pool.length > 0 && this.drawsThisTurn < SCORE.maxDrawsPerTurn;
  }

  canPass(playerId: string): boolean {
    return this.isTurnOf(playerId) && this.openingTileId === null && (this.pool.length === 0 || this.drawsThisTurn >= SCORE.maxDrawsPerTurn);
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
    if (this.openingTileId !== null && tileId !== this.openingTileId) throw new RuleError("A primeira jogada deve usar a peça de abertura.");
    const tile = p.hand[idx];
    const move = this.fits(tile, r, c, ((rot % 3) + 3) % 3);
    if (!move) throw new RuleError("A peça não encaixa aí.");

    const verts = cellVertices(r, c);
    const bonuses: string[] = [];
    let points = tileSum(tile);

    if (this.openingTileId !== null) {
      if (isTriple(tile)) {
        const bonus = tile.v[0] === 0 ? SCORE.openingZeroTriple : SCORE.openingTriple;
        points += bonus;
        bonuses.push(`abertura com triplo +${bonus}`);
      }
      this.openingTileId = null;
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
    this.addLog(`${p.name} jogou ${tile.v.join("-")}: +${points}${bonuses.length ? ` (${bonuses.join(", ")})` : ""}.`);

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
    this.addLog(`${p.name} comprou uma peça (−${SCORE.drawPenalty}).`);
    return tile;
  }

  pass(playerId: string): void {
    if (!this.canPass(playerId)) throw new RuleError("Compre até 3 peças antes de passar.");
    const p = this.current;
    p.score -= SCORE.passPenalty;
    this.consecutivePasses++;
    this.addLog(`${p.name} passou a vez (−${SCORE.passPenalty}).`);
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
    this.addLog(
      reason === "emptyHand"
        ? `${winner.name} esvaziou a mão e ganhou +${points}!`
        : `Jogo travado. ${winner.name} tinha menos pontos na mão: +${points}.`,
    );
    const top = Math.max(...this.players.map((p) => p.score));
    if (top >= this.targetScore) {
      this.phase = "gameOver";
      const champ = this.players.find((p) => p.score === top)!;
      this.addLog(`🏆 ${champ.name} venceu o jogo com ${top} pontos!`);
    } else {
      this.phase = "roundOver";
    }
  }

  private endBlocked(): void {
    const handValue = (p: GamePlayer) => p.hand.reduce((a, t) => a + tileSum(t), 0);
    const winner = this.players.reduce((a, b) => (handValue(b) < handValue(a) ? b : a));
    this.endRound(winner, "blocked");
  }

  private addLog(line: string): void {
    this.log.push(line);
    if (this.log.length > 50) this.log.shift();
  }
}
