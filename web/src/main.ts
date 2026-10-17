import "./style.css";
import type { GameState, Move, ServerMessage } from "@trimino/shared";
import { BoardView, handTileSvg, type Ghost } from "./board.ts";
import { Connection } from "./net.ts";
import { Mesh } from "./rtc.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PLAYER_COLORS = ["#d9534f", "#3a7bd5", "#e0a526", "#8e5cc8"];

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};

function clientId(): string {
  let id = storage.get("trimino.clientId");
  if (!id) {
    id = crypto.randomUUID();
    storage.set("trimino.clientId", id);
  }
  return id;
}

const randomRoom = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

// ---------------- lobby ----------------

const form = $<HTMLFormElement>("join-form");
const params = new URLSearchParams(location.search);
(form.elements.namedItem("name") as HTMLInputElement).value = storage.get("trimino.name") ?? "";
(form.elements.namedItem("room") as HTMLInputElement).value = (params.get("sala") ?? randomRoom()).toUpperCase();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const name = String(data.get("name")).trim();
  const room = String(data.get("room")).trim().toUpperCase();
  storage.set("trimino.name", name);
  history.replaceState(null, "", `?sala=${encodeURIComponent(room)}`);
  $("lobby").hidden = true;
  $("app").hidden = false;
  await start(name, room, data.get("media") === "on");
});

// ---------------- jogo ----------------

let state: GameState | null = null;
let selectedTile: number | null = null;
let preview: { r: number; c: number; i: number } | null = null;
let lastBoardSize = -1;
let lastRound = -1;
let seenLog: string[] = [];

async function start(name: string, room: string, withMedia: boolean): Promise<void> {
  const board = new BoardView($("table"));
  const videos = new Map<string, HTMLElement>();

  const mesh = new Mesh(
    (to, data) => conn.send({ t: "signal", to, data }),
    (peerId, stream) => setVideo(peerId, stream),
  );
  if (withMedia && navigator.mediaDevices) {
    await mesh.startLocal();
    if (!mesh.local) toast("Não foi possível acessar câmera/microfone.");
  }

  let myId = "";
  const conn = new Connection({ t: "join", room, name, clientId: clientId() }, onMessage, (online) => {
    $("status").textContent = online ? "" : "reconectando…";
    $("status").classList.toggle("offline", !online);
  });

  function onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        myId = msg.you;
        mesh.iceServers = msg.iceServers;
        mesh.closeAll();
        setVideo(myId, mesh.local, true);
        for (const p of msg.peers) mesh.call(p).catch(console.error);
        break;
      case "signal":
        mesh.onSignal(msg.from, msg.data).catch(console.error);
        break;
      case "peerLeft":
        mesh.close(msg.id);
        break;
      case "state":
        state = msg.state;
        render();
        break;
      case "chat":
        addLog(`${msg.name}: ${msg.text}`, "chat");
        break;
      case "error":
        toast(msg.message);
        break;
    }
  }

  // ---------- vídeo ----------

  function setVideo(id: string, stream: MediaStream | null, self = false): void {
    let box = videos.get(id);
    if (!stream && !self) {
      box?.remove();
      videos.delete(id);
      return;
    }
    if (!box) {
      box = document.createElement("figure");
      box.className = "video";
      box.dataset.id = id;
      const v = document.createElement("video");
      v.autoplay = true;
      v.playsInline = true;
      v.muted = self;
      box.append(v, document.createElement("figcaption"));
      if (self) $("videos").prepend(box);
      else $("videos").append(box);
      videos.set(id, box);
    }
    const v = box.querySelector("video")!;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
    labelVideos();
  }

  function labelVideos(): void {
    for (const [id, box] of videos) {
      const p = state?.players.find((p) => p.id === id);
      box.querySelector("figcaption")!.textContent = (p?.name ?? "…") + (id === myId ? " (você)" : "");
      box.classList.toggle("turn", state?.turnPlayerId === id);
      const seat = state?.players.findIndex((p) => p.id === id) ?? -1;
      box.style.setProperty("--owner", seat >= 0 ? PLAYER_COLORS[seat % 4] : "transparent");
    }
  }

  const mic = $("mic");
  const cam = $("cam");
  const syncMediaButtons = () => {
    mic.classList.toggle("off", !mesh.isEnabled("audio"));
    cam.classList.toggle("off", !mesh.isEnabled("video"));
    mic.toggleAttribute("disabled", !mesh.hasTrack("audio"));
    cam.toggleAttribute("disabled", !mesh.hasTrack("video"));
  };
  mic.onclick = () => { mesh.setEnabled("audio", !mesh.isEnabled("audio")); syncMediaButtons(); };
  cam.onclick = () => { mesh.setEnabled("video", !mesh.isEnabled("video")); syncMediaButtons(); };
  syncMediaButtons();

  // ---------- ações ----------

  const movesFor = (tileId: number | null): Move[] => (state && tileId !== null ? state.you.validMoves.filter((m) => m.tileId === tileId) : []);
  const previewMoves = (): Move[] => (preview ? movesFor(selectedTile).filter((m) => m.r === preview!.r && m.c === preview!.c) : []);

  board.onCellClick = (r, c) => {
    if (preview && preview.r === r && preview.c === c) preview.i++;
    else preview = { r, c, i: 0 };
    render();
  };

  const play = () => {
    const opts = previewMoves();
    if (!opts.length) return;
    const m = opts[preview!.i % opts.length];
    conn.send({ t: "place", tileId: m.tileId, r: m.r, c: m.c, rot: m.rot });
    preview = null;
    selectedTile = null;
  };
  const rotate = () => {
    if (preview) {
      preview.i++;
      render();
    }
  };
  $("play").onclick = play;
  $("rotate").onclick = rotate;
  $("draw").onclick = () => conn.send({ t: "draw" });
  $("pass").onclick = () => conn.send({ t: "pass" });
  $("fit").onclick = () => state && board.fit(state.board);
  $("room-code").onclick = async () => {
    await navigator.clipboard?.writeText(location.href).catch(() => {});
    toast("Link da sala copiado!");
  };
  document.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "r" || e.key === "R") rotate();
    if (e.key === "Enter") play();
    if (e.key === "Escape") { preview = null; selectedTile = null; render(); }
  });
  $<HTMLFormElement>("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("text") as HTMLInputElement;
    if (input.value.trim()) conn.send({ t: "chat", text: input.value });
    input.value = "";
  });

  // ---------- render ----------

  function render(): void {
    if (!state) return;
    const s = state;
    const myTurn = s.phase === "playing" && s.turnPlayerId === s.you.id;
    const colorOf = (pid: string) => PLAYER_COLORS[Math.max(0, s.players.findIndex((p) => p.id === pid)) % 4];

    if (selectedTile !== null && !s.you.hand.some((t) => t.id === selectedTile)) selectedTile = null;
    if (myTurn && s.openingTileId !== null) selectedTile = s.openingTileId;
    if (!myTurn) preview = null;
    if (preview && !previewMoves().length) preview = null;

    // tabuleiro
    const ghosts: Ghost[] = [];
    if (myTurn && selectedTile !== null) {
      const seen = new Set<string>();
      for (const m of movesFor(selectedTile)) {
        const k = `${m.r},${m.c}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const active = preview?.r === m.r && preview?.c === m.c;
        const opts = active ? previewMoves() : [];
        ghosts.push({ r: m.r, c: m.c, vals: active ? opts[preview!.i % opts.length].vals : null, active });
      }
    }
    const last = s.board.at(-1);
    board.render(s.board, colorOf, ghosts, last ? `${last.r},${last.c}` : null);
    if (s.round !== lastRound || (s.board.length > 0) !== (lastBoardSize > 0)) board.fit(s.board);
    lastRound = s.round;
    lastBoardSize = s.board.length;

    // placar
    $("room-code").textContent = `Sala ${s.room}`;
    $("scores").replaceChildren(
      ...s.players.map((p, i) => {
        const li = document.createElement("li");
        li.className = `score${p.id === s.turnPlayerId ? " turn" : ""}${p.connected ? "" : " away"}`;
        li.style.setProperty("--owner", p.spectator ? "#888" : PLAYER_COLORS[i % 4]);
        li.innerHTML = `<span class="dot"></span><span class="nm"></span><b>${p.score}</b>${p.spectator ? "" : `<small>${p.handCount}▲</small>`}`;
        li.querySelector(".nm")!.textContent = p.name + (p.isHost ? " ★" : "");
        return li;
      }),
    );
    $("pool").textContent = s.phase === "lobby" ? "Aguardando" : `Monte: ${s.poolCount}`;

    // banner / overlay
    const me = s.players.find((p) => p.id === s.you.id);
    const turnName = s.players.find((p) => p.id === s.turnPlayerId)?.name;
    $("banner").textContent =
      s.phase !== "playing" ? "" :
      myTurn ? (s.openingTileId !== null ? "Sua vez! Coloque a peça de abertura." : selectedTile === null ? "Sua vez! Escolha uma peça." : preview ? "Toque de novo para girar, depois Jogar." : "Toque num espaço destacado.") :
      `Vez de ${turnName}`;
    $("banner").classList.toggle("mine", myTurn);
    renderOverlay(s, !!me?.isHost);

    // mão
    const playable = new Set(s.you.validMoves.map((m) => m.tileId));
    $("hand").replaceChildren(
      ...s.you.hand.map((t) => {
        const b = document.createElement("button");
        b.className = `hand-tile${t.id === selectedTile ? " selected" : ""}${myTurn && !playable.has(t.id) ? " dim" : ""}`;
        b.append(handTileSvg(t.v));
        b.onclick = () => {
          selectedTile = selectedTile === t.id ? null : t.id;
          preview = null;
          render();
        };
        return b;
      }),
    );

    $("play").toggleAttribute("disabled", !preview);
    $("rotate").toggleAttribute("disabled", previewMoves().length < 2);
    $("draw").toggleAttribute("disabled", !s.you.canDraw);
    $("pass").toggleAttribute("disabled", !s.you.canPass);

    // log
    // O servidor manda as últimas linhas; só acrescentamos as novas.
    let overlap = Math.min(seenLog.length, s.log.length);
    const same = (a: string[], b: string[]) => a.every((x, i) => x === b[i]);
    while (overlap > 0 && !same(seenLog.slice(-overlap), s.log.slice(0, overlap))) overlap--;
    for (const line of s.log.slice(overlap)) addLog(line);
    seenLog = s.log;
    labelVideos();
  }

  function renderOverlay(s: GameState, isHost: boolean): void {
    const ov = $("overlay");
    ov.replaceChildren();
    if (s.phase === "playing") {
      ov.hidden = true;
      return;
    }
    ov.hidden = false;
    const box = document.createElement("div");
    box.className = "card";
    const h = document.createElement("h2");
    const p = document.createElement("p");
    const btn = document.createElement("button");
    btn.className = "primary";
    const seated = s.players.filter((x) => x.connected).length;
    if (s.phase === "lobby") {
      h.textContent = "Esperando jogadores";
      p.textContent = `${seated} na sala. Compartilhe o link: ${location.href}`;
      btn.textContent = "Começar partida";
      btn.disabled = !isHost || seated < 2;
      btn.onclick = () => conn.send({ t: "start" });
      if (!isHost) btn.textContent = "Aguardando o anfitrião…";
    } else {
      const winner = s.players.find((x) => x.id === s.roundSummary?.winnerId);
      if (s.phase === "roundOver") {
        h.textContent = `Fim da rodada ${s.round}`;
        p.textContent = winner ? `${winner.name} levou +${s.roundSummary!.points}. Meta: ${s.targetScore} pontos.` : "";
        btn.textContent = isHost ? "Próxima rodada" : "Aguardando o anfitrião…";
        btn.disabled = !isHost;
        btn.onclick = () => conn.send({ t: "nextRound" });
      } else {
        const champ = [...s.players].sort((a, b) => b.score - a.score)[0];
        h.textContent = `🏆 ${champ.name} venceu!`;
        p.textContent = `${champ.score} pontos.`;
        btn.textContent = isHost ? "Nova partida" : "Aguardando o anfitrião…";
        btn.disabled = !isHost;
        btn.onclick = () => conn.send({ t: "start" });
      }
    }
    box.append(h, p, btn);
    ov.append(box);
  }

  window.addEventListener("beforeunload", () => {
    mesh.closeAll();
    conn.close();
  });
}

function addLog(text: string, cls = ""): void {
  const li = document.createElement("li");
  li.textContent = text;
  li.className = cls;
  $("log").append(li);
  $("log").scrollTop = $("log").scrollHeight;
}

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}
