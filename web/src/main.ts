import "./style.css";
import { rotated, type GameState, type LogEntry, type ServerMessage, type Values } from "@trimino/shared";
import { VALUE_COLORS } from "./board3d/textures.ts";
import { BoardView, handTileSvg, type Board, type Ghost } from "./board.ts";
import { Board3D, webglAvailable } from "./board3d/Board3D.ts";
import { tilePhoto } from "./board3d/tilePhotos.ts";
import { Connection } from "./net.ts";
import { Mesh } from "./rtc.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PLAYER_COLORS = ["#d9534f", "#3a7bd5", "#e0a526", "#8e5cc8"];

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};

/**
 * Identidade do jogador para reconexão. Fica no sessionStorage (uma por aba): sobrevive a recarregar
 * a página, mas duas abas do mesmo navegador são jogadores diferentes em vez de derrubarem uma à outra.
 */
function clientId(): string {
  let id: string | null = null;
  try { id = sessionStorage.getItem("trimino.clientId"); } catch { /* sem storage */ }
  if (!id) {
    id = crypto.randomUUID();
    try { sessionStorage.setItem("trimino.clientId", id); } catch { /* sem storage */ }
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
let preview: { r: number; c: number; rot: number } | null = null;
let lastBoardSize = -1;
let lastRound = -1;
let seenLog: string[] = []; // entradas serializadas, para comparar com o próximo estado

async function start(name: string, room: string, withMedia: boolean): Promise<void> {
  const board: Board = webglAvailable() ? new Board3D($("table")) : new BoardView($("table"));
  $("view").hidden = !board.toggleView;
  $("view").onclick = () => {
    const top = board.toggleView?.();
    $("view").textContent = top ? "3D" : "Topo";
  };
  const videos = new Map<string, HTMLElement>();

  const mesh = new Mesh(
    (to, data) => conn.send({ t: "signal", to, data }),
    (peerId, stream) => setVideo(peerId, stream),
  );
  if (withMedia && navigator.mediaDevices) {
    await mesh.startLocal();
    if (!mesh.local) toast("Não foi possível acessar câmera/microfone.");
  }

  if (import.meta.env.DEV) Object.assign(window, { __trimino: { board, get state() { return state; } } });

  let myId = "";
  const conn = new Connection({ t: "join", room, name, clientId: clientId() }, onMessage, (online) => {
    $("status").textContent = online ? "" : "reconectando…";
    $("status").classList.toggle("offline", !online);
  });

  conn.onKicked = () => toast("Você entrou nesta sala em outra janela. Esta foi desconectada.");

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
        addChat(msg.name, msg.text);
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

  // Sem dicas: qualquer espaço livre encostado no jogo pode ser tentado; o servidor decide se encaixa.
  const isFrontier = (r: number, c: number) => !!state?.you.frontier.some((f) => f.r === r && f.c === c);

  board.onCellClick = (r, c) => {
    if (selectedTile === null || !isFrontier(r, c)) return;
    if (preview && preview.r === r && preview.c === c) preview.rot = (preview.rot + 1) % 3;
    else preview = { r, c, rot: 0 };
    render();
  };

  const play = () => {
    if (!preview || selectedTile === null) return;
    conn.send({ t: "place", tileId: selectedTile, r: preview.r, c: preview.c, rot: preview.rot });
  };
  const rotate = () => {
    if (preview) {
      preview.rot = (preview.rot + 1) % 3;
      render();
    }
  };
  $("play").onclick = play;
  $("rotate").onclick = rotate;
  $("draw").onclick = () => conn.send({ t: "draw" });
  $("pass").onclick = () => conn.send({ t: "pass" });
  $("fit").onclick = () => state && board.fit(state.board);
  const setLogOpen = (open: boolean) => {
    $("log-panel").hidden = !open;
    $("log-toggle").setAttribute("aria-expanded", String(open));
    $("log-toggle").classList.toggle("active", open);
    if (open) $("log").scrollTop = $("log").scrollHeight;
  };
  $("log-toggle").onclick = () => setLogOpen($("log-panel").hidden);
  $("log-close").onclick = () => setLogOpen(false);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("log-panel").hidden) setLogOpen(false);
  });

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
    if (!myTurn || selectedTile === null || (preview && !isFrontier(preview.r, preview.c))) preview = null;

    // tabuleiro
    const ghosts: Ghost[] = [];
    const tile = s.you.hand.find((t) => t.id === selectedTile);
    if (myTurn && tile)
      for (const f of s.you.frontier) {
        const active = preview?.r === f.r && preview?.c === f.c;
        ghosts.push({ r: f.r, c: f.c, vals: active ? rotated(tile.v, preview!.rot) : null, active });
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
        li.innerHTML = `<span class="dot"></span><span class="nm"></span><b>${p.score}</b>`;
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
      myTurn ? (selectedTile === null ? (s.board.length ? "Sua vez! Escolha uma peça." : "Sua vez! Abra com a peça que quiser.") : preview ? "Toque de novo para girar, depois Jogar." : "Toque num espaço livre.") :
      `Vez de ${turnName}`;
    $("banner").classList.toggle("mine", myTurn);
    renderOverlay(s, !!me?.isHost);

    // mão
    $("hand").replaceChildren(
      ...s.you.hand.map((t) => {
        const b = document.createElement("button");
        b.className = `hand-tile${t.id === selectedTile ? " selected" : ""}`;
        b.append(tileVisual(t.v));
        b.onclick = () => {
          selectedTile = selectedTile === t.id ? null : t.id;
          preview = null;
          render();
        };
        return b;
      }),
    );

    $("play").toggleAttribute("disabled", !preview);
    $("rotate").toggleAttribute("disabled", !preview);
    $("draw").toggleAttribute("disabled", !s.you.canDraw);
    $("pass").toggleAttribute("disabled", !s.you.canPass);

    // log
    // O servidor manda as últimas linhas; só acrescentamos as novas.
    const keys = s.log.map((e) => JSON.stringify(e));
    let overlap = Math.min(seenLog.length, keys.length);
    const same = (a: string[], b: string[]) => a.every((x, i) => x === b[i]);
    while (overlap > 0 && !same(seenLog.slice(-overlap), keys.slice(0, overlap))) overlap--;
    for (const entry of s.log.slice(overlap)) addLog(entry);
    seenLog = keys;
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
    if (s.phase === "lottery" && s.lottery) {
      renderLottery(box, h, p, s);
      ov.append(box);
      return;
    }
    if (s.phase === "lobby") {
      h.textContent = "Esperando jogadores";
      p.textContent =
        seated < 2
          ? "Só você está nesta sala. Os outros jogadores precisam entrar com o mesmo código:"
          : `${seated} jogadores na sala.`;
      // Código em destaque + copiar link: sem isso cada um acaba criando uma sala própria.
      const code = document.createElement("div");
      code.className = "room-share";
      const big = document.createElement("strong");
      big.textContent = s.room;
      const copy = document.createElement("button");
      copy.className = "secondary";
      copy.textContent = "Copiar link";
      copy.onclick = async () => {
        await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?sala=${s.room}`).catch(() => {});
        toast("Link da sala copiado!");
      };
      code.append(big, copy);
      p.after(code);
      btn.textContent = isHost ? (seated < 2 ? "Precisa de 2 jogadores" : "Começar partida") : "Aguardando o anfitrião…";
      btn.disabled = !isHost || seated < 2;
      btn.onclick = () => conn.send({ t: "start" });
      box.append(h, p, code, btn);
      ov.append(box);
      return;
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

  function renderLottery(box: HTMLElement, h: HTMLElement, p: HTMLElement, s: GameState): void {
    const lot = s.lottery!;
    const mine = lot.picks.find((x) => x.playerId === s.you.id);
    const seated = s.players.some((x) => x.id === s.you.id && !x.spectator);
    const nameOf = (id: string) => s.players.find((x) => x.id === id)?.name ?? "?";
    const winner = lot.winnerId ? nameOf(lot.winnerId) : null;
    h.textContent = "Sorteio";
    p.textContent = winner
      ? `${winner} tirou a maior pedra e começa!`
      : mine || !seated
        ? "Aguardando os outros jogadores…"
        : "Escolha uma pedra. Quem tirar a maior começa.";
    const grid = document.createElement("div");
    grid.className = "lots";
    for (let i = 0; i < lot.slots; i++) {
      const pick = lot.picks.find((x) => x.slot === i);
      const b = document.createElement("button");
      b.className = `lot${pick ? " revealed" : ""}${pick && pick.playerId === lot.winnerId ? " winner" : ""}`;
      if (pick) {
        b.disabled = true;
        b.append(tileVisual(pick.tile.v));
        const who = document.createElement("span");
        who.textContent = nameOf(pick.playerId);
        b.append(who);
        b.style.setProperty("--owner", colorOfSeat(s, pick.playerId));
      } else {
        b.disabled = !!mine || !seated || !!winner;
        b.onclick = () => conn.send({ t: "pickLot", slot: i });
      }
      grid.append(b);
    }
    box.classList.add("wide");
    box.append(h, p, grid);
  }

  window.addEventListener("beforeunload", () => {
    mesh.closeAll();
    conn.close();
  });
}

/** Peça da mão com o mesmo visual 3D do tabuleiro; desenho SVG se não houver WebGL. */
function tileVisual(v: Values): Element {
  const url = webglAvailable() ? tilePhoto(v) : null;
  if (!url) return handTileSvg(v);
  const img = document.createElement("img");
  img.className = "tile-photo";
  img.src = url;
  img.alt = v.join("-");
  img.draggable = false;
  return img;
}

function colorOfSeat(s: GameState, playerId: string): string {
  return PLAYER_COLORS[Math.max(0, s.players.findIndex((p) => p.id === playerId)) % 4];
}

/** Mensagem de chat na lateral. */
function addChat(name: string, text: string): void {
  const li = document.createElement("li");
  const who = document.createElement("b");
  who.textContent = `${name}: `;
  li.append(who, text);
  const list = $("chat-log");
  list.append(li);
  list.scrollTop = list.scrollHeight;
}

/**
 * Linha do histórico: "**Ana jogou:** <1-5-5> | +11".
 * Nome e ação em negrito; cada número da peça na cor dele; pontos em azul (ganho) ou vermelho (perda).
 */
function addLog(e: LogEntry): void {
  const li = document.createElement("li");
  if (e.actor) {
    const b = document.createElement("b");
    b.textContent = `${e.actor} ${e.action}${e.tile ? ":" : ""}`;
    li.append(b);
  } else {
    li.append(e.action);
  }
  if (e.tile) {
    const tile = document.createElement("span");
    tile.className = "log-tile";
    tile.setAttribute("aria-label", e.tile.join("-"));
    tile.append("<");
    e.tile.forEach((n, i) => {
      if (i) tile.append("-");
      const d = document.createElement("span");
      d.textContent = String(n);
      d.style.color = VALUE_COLORS[n];
      tile.append(d);
    });
    tile.append(">");
    li.append(" ", tile);
  }
  if (e.points !== undefined) {
    const pts = document.createElement("span");
    pts.className = e.points < 0 ? "pts neg" : "pts pos";
    pts.textContent = e.points < 0 ? `−${-e.points}` : `+${e.points}`;
    li.append(" | ", pts);
  }
  if (e.note) {
    const note = document.createElement("small");
    note.textContent = ` (${e.note})`;
    li.append(note);
  }
  const log = $("log");
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}
