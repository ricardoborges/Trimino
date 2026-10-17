import { describe, expect, it } from "vitest";
import { TriminoGame, SCORE } from "./game.ts";
import { cellVertices, cellsAroundVertex, edgeNeighbors, vertexKey } from "./geometry.ts";
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

describe("peças", () => {
  it("o jogo tem 56 peças distintas", () => {
    const set = fullSet();
    expect(set).toHaveLength(56);
    expect(new Set(set.map((t) => t.v.join())).size).toBe(56);
  });
});

describe("TriminoGame", () => {
  it("distribui 9 peças para 2 jogadores e define a abertura", () => {
    const g = new TriminoGame(twoPlayers, 400, seeded(1));
    expect(g.players.every((p) => p.hand.length === 9)).toBe(true);
    expect(g.pool).toHaveLength(56 - 18);
    expect(g.current.hand.some((t) => t.id === g.openingTileId)).toBe(true);
    expect(g.canDraw(g.current.id)).toBe(false);
  });

  it("toda jogada válida é aceita e respeita os cantos", () => {
    const g = new TriminoGame(twoPlayers, 10_000, seeded(7));
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
    const g = new TriminoGame(twoPlayers, 400, seeded(3));
    const m = g.validMoves(g.current.id)[0];
    g.place(g.current.id, m.tileId, m.r, m.c, m.rot);
    const p = g.current;
    const valid = new Set(g.validMoves(p.id).map((v) => `${v.tileId}/${v.r}/${v.c}/${v.rot}`));
    const bad = p.hand.flatMap((t) => [0, 1, 2].map((rot) => ({ t, rot }))).find(({ t, rot }) => !valid.has(`${t.id}/0/1/${rot}`));
    expect(() => g.place(p.id, bad!.t.id, 0, 1, bad!.rot)).toThrow();
    expect(() => g.place(p.id, p.hand[0].id, 5, 5, 0)).toThrow(); // sem vizinho
  });

  it("comprar custa pontos e passar só depois de 3 compras", () => {
    const g = new TriminoGame(twoPlayers, 400, seeded(5));
    const m = g.validMoves(g.current.id)[0];
    g.place(g.current.id, m.tileId, m.r, m.c, m.rot);
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
    const g = new TriminoGame(twoPlayers, 10_000, seeded(9));
    // Monta o tabuleiro manualmente com cinco peças 0-0-0 ao redor de um vértice.
    g.openingTileId = null;
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
    const g = new TriminoGame(twoPlayers, 10_000, seeded(11));
    const p = g.current;
    p.hand = p.hand.filter((t) => t.id === g.openingTileId);
    const m = g.validMoves(p.id)[0];
    g.place(p.id, m.tileId, m.r, m.c, m.rot);
    expect(g.phase).toBe("roundOver");
    expect(g.roundSummary?.winnerId).toBe(p.id);
    expect(g.roundSummary!.points).toBeGreaterThanOrEqual(SCORE.emptyHand);
  });
});
