import WebSocket from "ws";
const url = process.env.TRIMINO_WS ?? "ws://localhost:8080/ws";
function client(name) {
  const ws = new WebSocket(url);
  const c = { ws, name, state: null, id: null, peers: null, signals: [], errors: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "welcome") { c.id = m.you; c.peers = m.peers; }
    if (m.t === "state") c.state = m.state;
    if (m.t === "signal") c.signals.push(m);
    if (m.t === "error") c.errors.push(m.message);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  return new Promise((r) => ws.on("open", () => { c.send({ t: "join", room: "teste", name, clientId: name + "-12345678" }); r(c); }));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const a = await client("Ana"); await wait(200);
const b = await client("Bia"); await wait(200);
console.log("peers de Bia:", b.peers.length, "sala:", b.state.room, "fase:", a.state.phase);
b.send({ t: "signal", to: a.id, data: { type: "offer", sdp: "x" } }); await wait(100);
console.log("sinal repassado:", a.signals.length === 1 && a.signals[0].from === b.id);
b.send({ t: "start" }); await wait(100); console.log("não-anfitrião não inicia:", b.errors.at(-1));
a.send({ t: "start" }); await wait(200);
let moves = 0, draws = 0, passes = 0;
for (let i = 0; i < 400; i++) {
  const s = a.state;
  if (s.phase !== "playing") break;
  const cur = [a, b].find((c) => c.id === s.turnPlayerId);
  const y = cur.state.you;
  if (y.validMoves.length) { const m = y.validMoves[0]; cur.send({ t: "place", tileId: m.tileId, r: m.r, c: m.c, rot: m.rot }); moves++; }
  else if (y.canDraw) { cur.send({ t: "draw" }); draws++; }
  else { cur.send({ t: "pass" }); passes++; }
  await wait(15);
}
const s = a.state;
console.log({ fase: s.phase, rodada: s.round, peçasNoTabuleiro: s.board.length, moves, draws, passes, placar: s.players.map((p) => `${p.name}=${p.score}`), resumo: s.roundSummary, erros: [...a.errors, ...b.errors].slice(1) });
console.log(s.log.slice(-4).join("\n"));
// reconexão mantém o assento
b.ws.close(); await wait(200);
const b2 = await client("Bia"); await wait(200);
console.log("reconectou com mesmo id:", b2.id === b.id, "| peers de Bia agora:", b2.peers);
process.exit(0);
