import WebSocket from "ws";
import { writeFileSync } from "node:fs";
// Gera exemplos reais de estado para o teste de protocolo do Android.
// Uso: TRIMINO_WS=ws://localhost:8787/ws node scripts/capture-fixtures.mjs
const out = process.argv[2] ?? "android/app/src/test/resources";
const url = process.env.TRIMINO_WS ?? "ws://localhost:8080/ws";
const room = "CAP" + Date.now() % 10000;
function client(name) {
  const ws = new WebSocket(url);
  const c = { ws, state: null, raw: null };
  ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.t === "state") { c.state = m.state; c.raw = String(raw); } });
  c.send = (m) => ws.send(JSON.stringify(m));
  return new Promise((r) => ws.on("open", () => { c.send({ t: "join", room, name, clientId: name + "-cap-0001" }); r(c); }));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const a = await client("Ana"); await wait(150);
const b = await client("Bia"); await wait(150);
a.send({ t: "start" }); await wait(150);
a.send({ t: "pickLot", slot: 2 }); await wait(150);
writeFileSync(out + "/state-lottery.json", a.raw);
b.send({ t: "pickLot", slot: 5 }); await wait(4200);
const cur = [a, b].find((c) => c.state.turnPlayerId === c.state.you.id);
cur.send({ t: "place", tileId: cur.state.you.hand[0].id, r: 0, c: 0, rot: 0 }); await wait(200);
writeFileSync(out + "/state-playing.json", a.raw);
console.log("fase:", a.state.phase, "peças:", a.state.board.length, "fronteira:", a.state.you.frontier.length);
process.exit(0);
