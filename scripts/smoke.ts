// Partida completa contra um servidor rodando, só pelo protocolo.
// Uso: npm run smoke   (TRIMINO_WS=ws://localhost:8787/ws para outra porta)
import { cellKey, cellVertices, edgeNeighbors, rotated, vertexKey, type GameState, type ServerMessage } from "@trimino/shared";
import WebSocket from "ws";

const url = process.env.TRIMINO_WS ?? "ws://localhost:8080/ws";
const room = "SMOKE" + Math.floor(Math.random() * 1e4);

interface Client {
  ws: WebSocket;
  id: string;
  peers: string[];
  state: GameState | null;
  signals: number;
  errors: string[];
  send(msg: object): void;
}

function client(name: string): Promise<Client> {
  const ws = new WebSocket(url);
  const c: Client = { ws, id: "", peers: [], state: null, signals: 0, errors: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as ServerMessage;
    if (m.t === "welcome") [c.id, c.peers] = [m.you, m.peers];
    if (m.t === "state") c.state = m.state;
    if (m.t === "signal") c.signals++;
    if (m.t === "error") c.errors.push(m.message);
  });
  return new Promise((r) => ws.on("open", () => (c.send({ t: "join", room, name, clientId: `${name}-smoke-${room}` }), r(c))));
}

/** O cliente não recebe dicas: calcula sozinho uma jogada que encaixa. */
function findMove(s: GameState) {
  const verts = new Map<string, number>();
  const occupied = new Set(s.board.map((b) => cellKey(b.r, b.c)));
  for (const b of s.board) cellVertices(b.r, b.c).forEach((v, i) => verts.set(vertexKey(...v), b.vals[i]));
  for (const t of s.you.hand)
    for (const f of s.you.frontier)
      for (let rot = 0; rot < 3; rot++) {
        const vals = rotated(t.v, rot);
        const touches = s.board.length === 0 || edgeNeighbors(f.r, f.c).some(([r, c]) => occupied.has(cellKey(r, c)));
        const matches = cellVertices(f.r, f.c).every((v, i) => !verts.has(vertexKey(...v)) || verts.get(vertexKey(...v)) === vals[i]);
        if (touches && matches) return { tileId: t.id, r: f.r, c: f.c, rot };
      }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

const a = await client("Ana");
await wait(200);
const b = await client("Bia");
await wait(200);
check("quem entra recebe os pares para ofertar WebRTC", b.peers.includes(a.id));
b.send({ t: "signal", to: a.id, data: { type: "offer", sdp: "x" } });
await wait(100);
check("sinalização é repassada", a.signals === 1);
b.send({ t: "start" });
await wait(100);
check("só o anfitrião inicia", b.errors.at(-1) === "Só o anfitrião pode iniciar.");

a.send({ t: "start" });
await wait(150);
check("partida começa pelo sorteio", a.state?.phase === "lottery");
a.send({ t: "pickLot", slot: 0 });
b.send({ t: "pickLot", slot: 1 });
await wait(300);
const lotteryWinner = a.state?.lottery?.winnerId;
check("o sorteio revela um vencedor", !!lotteryWinner);
await wait(4000);
check("depois do sorteio, a rodada começa", a.state?.phase === "playing");
check("o vencedor do sorteio começa", a.state?.turnPlayerId === lotteryWinner);
check("o estado não traz dicas de jogada", !("validMoves" in (a.state!.you as object)));

let moves = 0;
let draws = 0;
let passes = 0;
for (let i = 0; i < 500 && a.state?.phase === "playing"; i++) {
  const cur = [a, b].find((c) => c.id === a.state!.turnPlayerId)!;
  const s = cur.state!;
  const m = findMove(s);
  if (m) {
    cur.send({ t: "place", ...m });
    moves++;
  } else if (s.you.canDraw) {
    cur.send({ t: "draw" });
    draws++;
  } else {
    cur.send({ t: "pass" });
    passes++;
  }
  await wait(15);
}
const s = a.state!;
console.log({ fase: s.phase, pecas: s.board.length, moves, draws, passes, placar: s.players.map((p) => `${p.name}=${p.score}`) });
check("a rodada termina", s.phase === "roundOver" || s.phase === "gameOver");
check("nenhum erro durante as jogadas", [...a.errors, ...b.errors].length === 1);

b.ws.close();
await wait(200);
const b2 = await client("Bia");
await wait(200);
check("reconexão mantém o assento", b2.id === b.id);
process.exit();
