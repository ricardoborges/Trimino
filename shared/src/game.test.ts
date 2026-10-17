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

/** Depois de uma batida: cada adversário passa a última vez (com o monte vazio), encerrando a rodada. */
function finishLap(g: TriminoGame) {
  g.pool = [];
  while (g.finalLap) g.pass(g.current.id);
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

  it("a abertura vale só a soma da pedra, sem bônus (0-0-0 vale 0)", () => {
    for (const v of [[0, 0, 0], [5, 5, 5], [1, 2, 4]] as [number, number, number][]) {
      const g = started(3);
      const p = g.current;
      const tile = fullSet().find((t) => t.v.join() === v.join())!;
      p.hand = [tile, p.hand[0].id === tile.id ? p.hand[1] : p.hand[0]];
      const before = p.score;
      const res = g.place(p.id, tile.id, 0, 0, 0);
      expect(res.points).toBe(v[0] + v[1] + v[2]);
      expect(res.bonuses).toEqual([]);
      expect(p.score - before).toBe(v[0] + v[1] + v[2]);
    }
  });

  it("as rodadas seguintes começam com quem tem menos pontos", () => {
    const g = started(11, 10_000);
    const first = g.current.id;
    g.current.hand = [g.current.hand[0]];
    open(g); // quem bateu fica com mais pontos
    finishLap(g);
    expect(g.phase).toBe("roundOver");
    g.startRound();
    expect(g.current.id).not.toBe(first);
  });

  it("menor pontuação abre a rodada; no empate, o primeiro na ordem da vez depois de quem abriu a anterior", () => {
    const three = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }, { id: "c", name: "Caio" }];
    const g = new TriminoGame(three, 10_000, seeded(3));
    g.players.forEach((p, i) => g.pickLot(p.id, i));
    g.beginFirstRound();
    const set = (a: number, b: number, c: number) => g.players.forEach((p, i) => (p.score = [a, b, c][i]));
    set(30, 5, 12);
    g.phase = "roundOver";
    g.startRound();
    expect(g.current.id).toBe("b");
    set(7, 20, 7); // empate entre Ana e Caio; a anterior foi aberta por Bia → Caio vem primeiro
    g.phase = "roundOver";
    g.startRound();
    expect(g.current.id).toBe("c");
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

  it("jogada comum: soma da pedra − 5 por pedra comprada na vez", () => {
    for (let seed = 1; seed < 60; seed++) {
      const g = started(seed, 10_000);
      open(g);
      const p = g.current;
      const before = p.score;
      g.draw(p.id);
      g.draw(p.id);
      expect(p.score).toBe(before); // a compra não desconta na hora
      const m = g.validMoves(p.id).find((x) => g.evaluate(x).bonuses.length === 0);
      if (!m) continue;
      const tile = p.hand.find((t) => t.id === m.tileId)!;
      const res = g.place(p.id, m.tileId, m.r, m.c, m.rot);
      const expected = tile.v[0] + tile.v[1] + tile.v[2] - 2 * SCORE.drawPenalty;
      expect(res.points).toBe(expected);
      expect(p.score - before).toBe(expected);
      expect(g.log.at(-1)).toMatchObject({ action: "jogou", points: expected });
      expect(g.log.at(-1)!.note).toContain("2 compras");
      return;
    }
    throw new Error("nenhuma semente com jogada comum após 2 compras");
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

  it("anota o total na folha de pontos a cada jogada e passe", () => {
    const g = started(5);
    const opener = g.current;
    open(g);
    expect(opener.marks).toEqual([{ round: 1, total: opener.score }]);
    const p = g.current;
    g.draw(p.id); g.draw(p.id); g.draw(p.id);
    expect(p.marks).toEqual([]); // comprar não anota: o desconto vem junto com a jogada ou o passe
    g.pass(p.id);
    expect(p.marks).toEqual([{ round: 1, total: p.score }]);
  });

  it("reiniciar a rodada desfaz os pontos dela e dá as cartas de novo, com o mesmo jogador abrindo", () => {
    const g = started(5);
    const starter = g.current.id;
    open(g);
    const p = g.current;
    g.draw(p.id); g.draw(p.id); g.draw(p.id);
    g.pass(p.id);
    expect(g.players.some((x) => x.score !== 0)).toBe(true);
    g.restartRound();
    expect(g.round).toBe(1);
    expect(g.board.size).toBe(0);
    expect(g.current.id).toBe(starter);
    for (const x of g.players) {
      expect(x.score).toBe(0);
      expect(x.marks).toEqual([]);
      expect(x.hand).toHaveLength(9);
    }
  });

  it("ponte: 40 + a soma da pedra jogada", () => {
    // (0,0) encosta por aresta em (0,-1); o canto oposto (2,1) toca (0,2), que não é vizinha por aresta.
    const g = started(4, 10_000);
    for (const [r, c] of [[0, -1], [0, 2]]) {
      g.board.set(`${r},${c}`, { r, c, vals: [1, 1, 1], tileId: -1, by: "x" });
      for (const v of cellVertices(r, c)) g.vertices.set(vertexKey(...v), 1);
    }
    const p = g.current;
    const tile = fullSet().find((t) => t.v.join() === "1,1,1")!;
    p.hand = [tile, fullSet()[0]];
    const res = g.place(p.id, tile.id, 0, 0, 0);
    expect(res.bonuses).toEqual(["ponte +40"]);
    expect(res.points).toBe(40 + 3);
    // a formação inclui a peça nova, a vizinha por aresta e a que encosta pelo canto
    const cells = res.formations[0].cells.map((x) => `${x.r},${x.c}`);
    expect(cells).toEqual(expect.arrayContaining(["0,0", "0,-1", "0,2"]));
    expect(g.celebration).toMatchObject({ seq: 1, playerId: p.id, points: 43 });
  });

  it("ponte: o canto que encosta só pela ponta não precisa bater (regra da casa)", () => {
    // Mesma montagem da ponte acima, mas a peça do canto (0,2) tem 4 onde a nova tem 1.
    const g = started(4, 10_000);
    for (const [r, c, n] of [[0, -1, 1], [0, 2, 4]]) {
      g.board.set(`${r},${c}`, { r, c, vals: [n, n, n], tileId: -1, by: "x" });
      for (const v of cellVertices(r, c)) g.vertices.set(vertexKey(...v), n);
    }
    const p = g.current;
    const tile = fullSet().find((t) => t.v.join() === "1,1,1")!;
    p.hand = [tile, fullSet()[0]];
    const res = g.place(p.id, tile.id, 0, 0, 0);
    expect(res.bonuses).toEqual(["ponte +40"]);
  });

  it("os cantos divididos com a vizinha por aresta continuam tendo que bater", () => {
    const g = started(4, 10_000);
    g.board.set("0,-1", { r: 0, c: -1, vals: [2, 2, 2], tileId: -1, by: "x" });
    for (const v of cellVertices(0, -1)) g.vertices.set(vertexKey(...v), 2);
    const p = g.current;
    const tile = fullSet().find((t) => t.v.join() === "1,1,1")!;
    p.hand = [tile, fullSet()[0]];
    expect(() => g.place(p.id, tile.id, 0, 0, 0)).toThrow("não encaixa");
  });

  it("dá bônus de mandala ao fechar seis peças ao redor de um vértice", () => {
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
    expect(res.bonuses).toEqual(["mandala +50"]);
    expect(res.formations).toEqual([{ kind: "mandala", cells: ring.map(([r, c]) => ({ r, c })) }]);
    expect(res.points).toBe(50 + 0); // 50 + a soma da pedra (0-0-0)
  });

  it("batida: +25 na hora, os outros jogam uma última vez e as pedras da mão são acertadas", () => {
    const g = started(11, 10_000);
    const p = g.current;
    p.hand = [p.hand[0]];
    const tilePoints = p.hand[0].v.reduce((a, b) => a + b, 0);
    open(g);
    expect(p.score).toBe(tilePoints + SCORE.emptyHand);
    expect(g.celebration).toMatchObject({ playerId: p.id, batida: true, points: tilePoints + SCORE.emptyHand });
    expect(g.phase).toBe("playing"); // ainda falta a última vez do adversário
    const other = g.current;
    expect(other.id).not.toBe(p.id);
    expect(g.finalLap).toEqual({ batedorId: p.id, pending: [other.id] });

    other.hand = [{ id: 98, v: [1, 2, 3] }, { id: 99, v: [0, 0, 4] }];
    g.pool = [];
    g.pass(other.id); // monte vazio: pode passar direto (−10)
    expect(g.phase).toBe("roundOver");
    expect(other.score).toBe(-SCORE.passPenalty - 10);
    expect(p.score).toBe(tilePoints + SCORE.emptyHand + 10);
    expect(g.roundSummary).toMatchObject({
      winnerId: p.id,
      reason: "emptyHand",
      points: SCORE.emptyHand + 10,
      bonus: SCORE.emptyHand,
      hands: [{ playerId: other.id, tiles: [[1, 2, 3], [0, 0, 4]], sum: 10 }],
    });
    expect(p.marks.at(-1)).toEqual({ round: 1, total: p.score, roundWin: true });
  });

  it("na última volta, cada adversário joga uma vez na ordem da vez", () => {
    const three = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }, { id: "c", name: "Caio" }];
    const g = new TriminoGame(three, 10_000, seeded(3));
    g.players.forEach((p, i) => g.pickLot(p.id, i));
    g.beginFirstRound();
    const order = [0, 1, 2].map((k) => g.players[(g.turn + k) % 3].id);
    g.current.hand = [g.current.hand[0]];
    open(g);
    expect(g.finalLap!.pending).toEqual(order.slice(1));
    g.pool = [];
    g.pass(order[1]);
    expect(g.phase).toBe("playing");
    expect(g.current.id).toBe(order[2]);
    g.pass(order[2]);
    expect(g.phase).toBe("roundOver");
    expect(g.finalLap).toBeNull();
  });

  describe("desistência", () => {
    const three = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }, { id: "c", name: "Caio" }];
    const startedWith = (players: { id: string; name: string }[], seed: number) => {
      const g = new TriminoGame(players, 400, seeded(seed));
      g.players.forEach((p, i) => g.pickLot(p.id, i));
      g.beginFirstRound();
      return g;
    };

    it("na própria vez: a vez passa, a mão volta ao monte e o jogo segue sem ele", () => {
      const g = startedWith(three, 21);
      open(g);
      const quitter = g.current;
      const handSize = quitter.hand.length;
      const pool = g.pool.length;
      g.forfeit(quitter.id);
      expect(quitter.out).toBe(true);
      expect(quitter.hand).toHaveLength(0);
      expect(g.pool).toHaveLength(pool + handSize);
      expect(g.current.id).not.toBe(quitter.id);
      expect(g.phase).toBe("playing");
      // as próximas vezes nunca caem em quem desistiu
      for (let i = 0; i < 6; i++) {
        expect(g.current.out).toBe(false);
        const id = g.current.id;
        g.draw(id); g.draw(id); g.draw(id); g.pass(id);
      }
      expect(() => g.forfeit(quitter.id)).toThrow();
    });

    it("tirado pelo anfitrião na vez dele: a vez passa e o histórico diz quem tirou", () => {
      const g = startedWith(three, 21);
      open(g);
      const gone = g.current;
      g.forfeit(gone.id, "Ana");
      expect(gone.out).toBe(true);
      expect(g.current.id).not.toBe(gone.id);
      expect(g.phase).toBe("playing");
      expect(g.log.at(-1)?.action).toBe("foi tirado da partida por Ana");
    });

    it("se sobra um só jogador, ele vence a partida", () => {
      const g = started(5);
      const stays = g.players.find((p) => p.id !== g.current.id)!;
      g.forfeit(g.current.id);
      expect(g.phase).toBe("gameOver");
      expect(g.winnerId).toBe(stays.id);
      expect(g.endedByForfeit).toBe(true); // não conta para o ranking
    });

    it("durante o sorteio, o sorteio termina só com quem ficou", () => {
      const g = new TriminoGame(three, 400, seeded(2));
      g.pickLot("a", 0);
      g.pickLot("c", 1);
      expect(g.lotteryWinnerId).toBeNull();
      g.forfeit("b");
      expect(["a", "c"]).toContain(g.lotteryWinnerId);
      g.beginFirstRound();
      expect(g.players.find((p) => p.id === "b")!.hand).toHaveLength(0);
      expect(g.active.every((p) => p.hand.length === 9)).toBe(true); // 2 ativos → 9 peças
    });

    it("rodadas seguintes não dão peças nem a vez a quem desistiu", () => {
      const g = startedWith(three, 8);
      g.forfeit("b");
      g.current.hand = [g.current.hand[0]];
      open(g);
      finishLap(g);
      expect(g.phase).toBe("roundOver");
      for (let r = 0; r < 3; r++) {
        g.startRound();
        expect(g.current.id).not.toBe("b");
        expect(g.player("b")!.hand).toHaveLength(0);
        g.current.hand = [g.current.hand[0]];
        open(g);
        finishLap(g);
      }
    });
  });
});
