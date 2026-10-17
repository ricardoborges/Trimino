import { describe, expect, it } from "vitest";
import { LOTTERY_SLOTS, TriminoGame, SCORE, lotRank } from "./game.ts";
import { cellAt, cellVertices, cellsAroundVertex, edgeNeighbors, vertexKey, vertexToPixel } from "./geometry.ts";
import { fullSet } from "./tiles.ts";

/** RNG determinístico (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const twoPlayers = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }];

/** Cria o jogo, faz o sorteio (cada um pega a pedra i) e dá as cartas. */
function started(seed: number, target = 400): TriminoGame {
  const g = new TriminoGame(twoPlayers, target, seeded(seed));
  g.players.forEach((p, i) => g.pickLot(p.id, i));
  g.beginFirstRound();
  return g;
}

/** Primeira jogada: qualquer peça da mão na origem. */
function open(g: TriminoGame) {
  g.place(g.current.id, g.current.hand[0].id, 0, 0, 0);
}

describe("geometria", () => {
  it("vizinhos por aresta compartilham exatamente dois vértices", () => {
    for (const [r, c] of [[0, 0], [0, 1], [3, -2], [-1, 4]]) {
      const mine = new Set(cellVertices(r, c).map((v) => vertexKey(...v)));
      for (const [nr, nc] of edgeNeighbors(r, c)) {
        const shared = cellVertices(nr, nc).filter((v) => mine.has(vertexKey(...v)));
        expect(shared).toHaveLength(2);
      }
    }
  });

  it("as seis células ao redor de um vértice contêm esse vértice", () => {
    const [x, y] = cellVertices(2, 2)[0];
    for (const [r, c] of cellsAroundVertex(x, y))
      expect(cellVertices(r, c).map((v) => vertexKey(...v))).toContain(vertexKey(x, y));
  });
});

describe("cellAt", () => {
  it("o centro de cada célula aponta para ela mesma", () => {
    for (const [r, c] of [[0, 0], [0, 1], [2, -3], [-1, 4], [-3, -3]]) {
      const pts = cellVertices(r, c).map((v) => vertexToPixel(v, 1));
      const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      expect(cellAt(cx, cy, 1)).toEqual([r, c]);
    }
  });
});

describe("peças", () => {
  it("o jogo tem 56 peças distintas", () => {
    const set = fullSet();
    expect(set).toHaveLength(56);
    expect(new Set(set.map((t) => t.v.join())).size).toBe(56);
  });
});

describe("TriminoGame", () => {
  it("sorteio: quem tira a maior pedra começa", () => {
    const g = new TriminoGame(twoPlayers, 400, seeded(1));
    expect(g.phase).toBe("lottery");
    expect(g.lotteryPool).toHaveLength(LOTTERY_SLOTS);
    expect(() => g.beginFirstRound()).toThrow();
    g.pickLot("a", 3);
    expect(() => g.pickLot("a", 4)).toThrow(); // só uma pedra por jogador
    expect(() => g.pickLot("b", 3)).toThrow(); // pedra já escolhida
    g.pickLot("b", 7);
    const winner = lotRank(g.lotteryPool[3]) > lotRank(g.lotteryPool[7]) ? "a" : "b";
    expect(g.lotteryWinnerId).toBe(winner);
    g.beginFirstRound();
    expect(g.phase).toBe("playing");
    expect(g.current.id).toBe(winner);
    expect(g.players.every((p) => p.hand.length === 9)).toBe(true);
    expect(g.pool).toHaveLength(56 - 18);
  });

  it("abre com qualquer peça, só na origem, sem comprar antes", () => {
    const g = started(1);
    const p = g.current;
    expect(g.canDraw(p.id)).toBe(false);
    const last = p.hand.at(-1)!;
    expect(() => g.place(p.id, last.id, 2, 2, 0)).toThrow();
    g.place(p.id, last.id, 0, 0, 1);
    expect(g.board.size).toBe(1);
    expect(g.log.at(-1)).toMatchObject({ actor: p.name, action: "jogou", tile: last.v });
    expect(g.log.at(-1)!.points).toBeGreaterThanOrEqual(0);
  });

  it("as rodadas seguintes começam com o próximo jogador", () => {
    const g = started(11, 10_000);
    const first = g.current.id;
    g.current.hand = [g.current.hand[0]];
    open(g);
    expect(g.phase).toBe("roundOver");
    g.startRound();
    expect(g.current.id).not.toBe(first);
  });

  it("toda jogada válida é aceita e respeita os cantos", () => {
    const g = started(7, 10_000);
    for (let step = 0; step < 200 && g.phase === "playing"; step++) {
      const id = g.current.id;
      const moves = g.validMoves(id);
      if (moves.length) {
        const m = moves[Math.floor(moves.length / 2)];
        g.place(id, m.tileId, m.r, m.c, m.rot);
      } else if (g.canDraw(id)) g.draw(id);
      else g.pass(id);
    }
    // Todos os vértices compartilhados têm o mesmo número em todas as peças.
    const seen = new Map<string, number>();
    for (const cell of g.board.values())
      cellVertices(cell.r, cell.c).forEach((v, i) => {
        const k = vertexKey(...v);
        if (seen.has(k)) expect(seen.get(k)).toBe(cell.vals[i]);
        seen.set(k, cell.vals[i]);
      });
    expect(g.board.size).toBeGreaterThan(5);
  });

  it("rejeita peça que não encaixa", () => {
    const g = started(3);
    open(g);
    const p = g.current;
    const valid = new Set(g.validMoves(p.id).map((v) => `${v.tileId}/${v.r}/${v.c}/${v.rot}`));
    const bad = p.hand.flatMap((t) => [0, 1, 2].map((rot) => ({ t, rot }))).find(({ t, rot }) => !valid.has(`${t.id}/0/1/${rot}`));
    expect(() => g.place(p.id, bad!.t.id, 0, 1, bad!.rot)).toThrow();
    expect(() => g.place(p.id, p.hand[0].id, 5, 5, 0)).toThrow(); // sem vizinho
  });

  it("comprar custa pontos e passar só depois de 3 compras", () => {
    const g = started(5);
    open(g);
    const p = g.current;
    const before = p.score;
    expect(g.canPass(p.id)).toBe(false);
    g.draw(p.id); g.draw(p.id); g.draw(p.id);
    expect(g.canDraw(p.id)).toBe(false);
    g.pass(p.id);
    expect(p.score).toBe(before - 3 * SCORE.drawPenalty - SCORE.passPenalty);
    expect(g.current.id).not.toBe(p.id);
  });

  it("dá bônus de hexágono ao fechar seis peças ao redor de um vértice", () => {
    const g = started(9, 10_000);
    // Monta o tabuleiro manualmente com cinco peças 0-0-0 ao redor de um vértice.
    const [cx, cy] = cellVertices(0, 0)[2];
    const ring = cellsAroundVertex(cx, cy);
    const zero = { id: 0, v: [0, 0, 0] as [number, number, number] };
    for (const [r, c] of ring.slice(0, 5)) {
      g.board.set(`${r},${c}`, { r, c, vals: [0, 0, 0], tileId: -1, by: "x" });
      for (const v of cellVertices(r, c)) g.vertices.set(vertexKey(...v), 0);
    }
    const p = g.current;
    p.hand = [zero, { id: 99, v: [1, 1, 1] }];
    const [r, c] = ring[5];
    const res = g.place(p.id, 0, r, c, 0);
    expect(res.bonuses.some((b) => b.startsWith("hexágono"))).toBe(true);
  });

  it("esvaziar a mão encerra a rodada com bônus", () => {
    const g = started(11, 10_000);
    const p = g.current;
    p.hand = [p.hand[0]];
    open(g);
    expect(g.phase).toBe("roundOver");
    expect(g.roundSummary?.winnerId).toBe(p.id);
    expect(g.roundSummary!.points).toBeGreaterThanOrEqual(SCORE.emptyHand);
  });
});
