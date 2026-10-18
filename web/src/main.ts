import "./style.css";
import { rotated, type GameState, type LogEntry, type ServerMessage, type Values } from "@trimino/shared";
import { VALUE_COLORS } from "./board3d/textures.ts";
import { BoardView, handTileSvg, type Board, type Ghost } from "./board.ts";
import { Board3D, webglAvailable } from "./board3d/Board3D.ts";
import { tilePhoto } from "./board3d/tilePhotos.ts";
import { Confetti, DURATION_MS as CONFETTI_MS } from "./confetti.ts";
import { enableHandDrag } from "./handDrag.ts";
import { Connection } from "./net.ts";
import { Mesh } from "./rtc.ts";
import { Settlement } from "./settlement.ts";
import { enterSite, mesaUrl, whatsappUrl, type Entry } from "./site.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PLAYER_COLORS = ["#d9534f", "#3a7bd5", "#e0a526", "#8e5cc8"];

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

/**
 * Última identidade usada em cada mesa, no localStorage: se a aba ou o navegador fechar sem querer,
 * quem volta para a mesa recupera o lugar (o servidor só devolve se ele estiver vago).
 */
const seatKey = (room: string) => `trimino.seat.${room}`;
function lastSeat(room: string): string | undefined {
  try { return localStorage.getItem(seatKey(room)) ?? undefined; } catch { return undefined; }
}
function rememberSeat(room: string, id: string): void {
  try { localStorage.setItem(seatKey(room), id); } catch { /* sem storage */ }
}

// ---------------- site ----------------

// Landing e varanda até o jogador escolher uma mesa (/mesa/CODIGO); daí em diante, o jogo.
void enterSite().then((entry) => {
  $("app").hidden = false;
  return start(entry);
});

// ---------------- jogo ----------------

let state: GameState | null = null;
let selectedTile: number | null = null;
let preview: { r: number; c: number; rot: number } | null = null;
let lastBoardSize = -1;
let lastRound = -1;
let seenLog: string[] = []; // entradas serializadas, para comparar com o próximo estado
/** Última comemoração já mostrada (null até o primeiro estado, para não repetir ao entrar/recarregar). */
let seenCelebration: number | null = null;
/** Ordem das pedras na mão escolhida pelo jogador (ids); pedras novas entram no fim. */
let handOrder: number[] = [];
let draggingHand = false;
/** Painel "Adversários" (começa ligado), e os adversários cuja quantidade de pedras o jogador tocou para ver. */
let showSeats = true;
/** Quando termina a comemoração em andamento (a conferência da batida espera por ela). */
let celebrationEndsAt = 0;
/** Células já vistas no tabuleiro (para saber qual pedra acabou de ser jogada). */
let seenCells: Set<string> | null = null;
/** Conferência da batida da rodada que acabou (chave: rodada + vencedor), mantida entre os estados. */
let settlement: { key: string; view: Settlement } | null = null;
const revealedSeats = new Set<string>();

async function start({ name, room, watch, media: withMedia }: Entry): Promise<void> {
  document.title = `Mesa ${room} · Triminó`;
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
  // Jogadores entram na conversa já com câmera; espectadores só pedem acesso se o anfitrião liberar.
  if (withMedia && !watch && navigator.mediaDevices) {
    await mesh.startLocal();
    if (!mesh.local) toast("Não foi possível acessar câmera/microfone.");
  }
  let inCall = false;

  const confetti = new Confetti($("table"));

  // Reorganizar a mão (também na vez: clicar escolhe a pedra, arrastar muda a ordem); a ordem fica salva no navegador.
  const orderKey = `trimino.handOrder.${room}`;
  try { handOrder = JSON.parse(localStorage.getItem(orderKey) ?? "[]"); } catch { handOrder = []; }
  const handDrag = enableHandDrag($("hand"), {
    canDrag: () => !!state,
    onReorder: (ids) => {
      handOrder = ids;
      try { localStorage.setItem(orderKey, JSON.stringify(ids)); } catch { /* sem storage */ }
      render();
    },
    onDragChange: (active) => {
      draggingHand = active;
      if (!active) render();
    },
  });

  if (import.meta.env.DEV) Object.assign(window, { __trimino: { board, confetti, get state() { return state; } } });

  let myId = "";
  const myClientId = clientId();
  const resume = lastSeat(room);
  const conn = new Connection({ t: "join", room, name, clientId: myClientId, resume: resume !== myClientId ? resume : undefined, watch }, onMessage, (online) => {
    $("status").textContent = online ? "" : "reconectando…";
    $("status").classList.toggle("offline", !online);
  });

  conn.onKicked = () => toast("Você entrou nesta sala em outra janela. Esta foi desconectada.");
  conn.onRefused = (reason) => location.replace(`/varanda?aviso=${encodeURIComponent(reason)}`);

  function onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        myId = msg.you;
        rememberSeat(room, myClientId);
        mesh.iceServers = msg.iceServers;
        mesh.closeAll();
        if (msg.inCall ?? true) void enterCall(msg.peers);
        else leaveCall();
        break;
      case "call":
        void enterCall(msg.peers);
        break;
      case "callEnded":
        leaveCall();
        break;
      case "notice":
        toast(msg.message);
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
      case "error":
        toast(msg.message);
        break;
    }
  }

  // ---------- vídeo ----------

  /** Entra na videoconferência e oferta para quem já está nela. */
  async function enterCall(peers: string[]): Promise<void> {
    mesh.closeAll();
    // Espectador liberado pelo anfitrião: só agora pede câmera e microfone.
    if (!mesh.local && (withMedia || watch) && navigator.mediaDevices) {
      await mesh.startLocal();
      if (!mesh.local) toast("Não foi possível acessar câmera/microfone.");
    }
    inCall = true;
    setVideo(myId, mesh.local, true);
    syncMediaButtons();
    for (const p of peers) mesh.call(p).catch(console.error);
    render();
  }

  /** Fora da videoconferência (espectador): desliga a câmera e some com os vídeos. */
  function leaveCall(): void {
    inCall = false;
    mesh.closeAll();
    mesh.local?.getTracks().forEach((t) => t.stop());
    mesh.local = null;
    videos.get(myId)?.remove();
    videos.delete(myId);
    syncMediaButtons();
    render();
  }

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
      box.append(v, Object.assign(document.createElement("span"), { className: "role" }), document.createElement("figcaption"));
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
      // Papel na mesa: jogador (com a cor do assento, igual ao placar) ou espectador.
      const spectator = !!p?.spectator;
      box.classList.toggle("spectator", spectator);
      const role = box.querySelector<HTMLElement>(".role")!;
      role.textContent = p ? (spectator ? "👁 Espectador" : "🎲 Jogador") : "";
      role.hidden = !p;
      // anfitrião: ✕ para tirar o espectador da conversa
      const host = !!state?.players.find((x) => x.id === myId)?.isHost;
      let kick = box.querySelector<HTMLButtonElement>(".kick");
      if (host && spectator && id !== myId) {
        if (!kick) {
          kick = Object.assign(document.createElement("button"), { className: "kick", textContent: "✕", title: "Tirar da conversa" });
          kick.dataset.action = "end";
          kick.dataset.id = id;
          box.append(kick);
        }
      } else kick?.remove();
      const seat = state?.players.filter((x) => !x.spectator).findIndex((x) => x.id === id) ?? -1;
      box.style.setProperty("--owner", !spectator && seat >= 0 ? PLAYER_COLORS[seat % 4] : "transparent");
    }
  }

  const mic = $("mic");
  const cam = $("cam");
  const syncMediaButtons = () => {
    mic.hidden = cam.hidden = !inCall;
    const setTool = (btn: HTMLElement, on: boolean, icon: string, what: string) => {
      btn.classList.toggle("off", !on);
      btn.setAttribute("aria-pressed", String(on));
      btn.querySelector(".ms")!.textContent = on ? icon : `${icon}_off`;
      btn.title = `${on ? "Desligar" : "Ligar"} ${what}`;
    };
    setTool(mic, mesh.isEnabled("audio"), "mic", "microfone");
    setTool(cam, mesh.isEnabled("video"), "videocam", "câmera");
    mic.toggleAttribute("disabled", !mesh.hasTrack("audio"));
    cam.toggleAttribute("disabled", !mesh.hasTrack("video"));
  };
  mic.onclick = () => { mesh.setEnabled("audio", !mesh.isEnabled("audio")); syncMediaButtons(); };
  cam.onclick = () => { mesh.setEnabled("video", !mesh.isEnabled("video")); syncMediaButtons(); };
  syncMediaButtons();

  // Espectador: pedir para entrar na conversa, cancelar o pedido ou sair dela.
  $("call-request").onclick = () => {
    const me = state?.players.find((p) => p.id === state?.you.id);
    conn.send(me?.inCall || me?.callRequested ? { t: "leaveCall" } : { t: "requestCall" });
  };

  // Espectadores: o anfitrião libera (pedidos abaixo das câmeras) ou tira da conversa (✕ no vídeo).
  const callAction = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id!;
    if (btn.dataset.action === "allow") conn.send({ t: "answerCall", id, allow: true });
    if (btn.dataset.action === "deny") conn.send({ t: "answerCall", id, allow: false });
    if (btn.dataset.action === "end") conn.send({ t: "endCall", id });
  };
  $("call-requests").addEventListener("click", callAction);
  $("videos").addEventListener("click", callAction);

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

  // Adversários: as mãos dos adversários viradas para baixo; tocar numa mostra quantas pedras ela tem.
  $("seats-toggle").onclick = () => {
    showSeats = !showSeats;
    revealedSeats.clear();
    render();
  };
  $("seats").addEventListener("click", (e) => {
    const seat = (e.target as HTMLElement).closest<HTMLElement>(".seat");
    if (!seat) return;
    const id = seat.dataset.id!;
    if (!revealedSeats.delete(id)) revealedSeats.add(id);
    render();
  });

  // Reiniciar (só o anfitrião), sempre com confirmação.
  const setRestartOpen = (open: boolean) => {
    $("restart-menu").hidden = !open;
    $("restart").setAttribute("aria-expanded", String(open));
    $("restart").classList.toggle("active", open);
  };
  $("restart").onclick = () => setRestartOpen($("restart-menu").hidden);
  $("restart-round").onclick = () => {
    setRestartOpen(false);
    if (confirm("Reiniciar a rodada? As peças são distribuídas de novo e os pontos desta rodada são desfeitos."))
      conn.send({ t: "restartRound" });
  };
  $("restart-game").onclick = () => {
    setRestartOpen(false);
    if (confirm("Reiniciar a partida? O placar volta a zero e começa um novo sorteio."))
      conn.send({ t: "restartGame" });
  };
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#restart, #restart-menu")) setRestartOpen(false);
  });
  // Painéis do topo (histórico e folha de pontos): um aberto por vez.
  const panels = [
    { panel: "log-panel", toggle: "log-toggle", close: "log-close", body: "log" },
    { panel: "sheet-panel", toggle: "sheet-toggle", close: "sheet-close", body: "sheet" },
    { panel: "tokens-panel", toggle: "tokens-toggle", close: "tokens-close", body: "tokens" },
  ];
  const openPanel = (open: string | null) => {
    for (const p of panels) {
      const on = p.panel === open;
      $(p.panel).hidden = !on;
      $(p.toggle).setAttribute("aria-expanded", String(on));
      $(p.toggle).classList.toggle("active", on);
      if (on) $(p.body).scrollTop = $(p.body).scrollHeight;
    }
  };
  for (const p of panels) {
    $(p.toggle).onclick = () => openPanel($(p.panel).hidden ? p.panel : null);
    $(p.close).onclick = () => openPanel(null);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") openPanel(null);
  });

  // Sair: durante a partida, desiste (os outros continuam) e volta para o lobby.
  $("leave").onclick = () => {
    const me = state?.players.find((p) => p.id === state?.you.id);
    const playing = !!state && state.phase !== "lobby" && state.phase !== "gameOver" && !!me && !me.spectator && !me.out;
    const question = playing
      ? "Desistir da partida? Os outros jogadores continuam o jogo sem você."
      : "Sair da sala?";
    if (!confirm(question)) return;
    if (playing) conn.send({ t: "forfeit" });
    // dá tempo de a mensagem sair antes de fechar a conexão
    setTimeout(() => {
      mesh.closeAll();
      mesh.local?.getTracks().forEach((t) => t.stop());
      conn.close();
      location.href = "/varanda";
    }, 200);
  };

  document.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "r" || e.key === "R") rotate();
    if (e.key === "Enter") play();
    if (e.key === "Escape") { preview = null; selectedTile = null; render(); }
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
    board.render(s.board, colorOf, ghosts);
    const cellKeys = new Set(s.board.map((b) => `${b.r},${b.c}`));
    const placed = seenCells && s.round === lastRound ? s.board.filter((b) => !seenCells!.has(`${b.r},${b.c}`)) : [];
    seenCells = cellKeys;
    if (s.round !== lastRound || (s.board.length > 0) !== (lastBoardSize > 0)) board.fit(s.board);
    lastRound = s.round;
    lastBoardSize = s.board.length;

    // ponte/mandala nova: destaca as pedras e comemora (depois de a peça terminar de cair)
    const cel = s.celebration;
    let celebrated: string | null = null;
    if (cel && seenCelebration !== null && cel.seq > seenCelebration) {
      const cells = cel.formations.flatMap((f) => f.cells);
      const kinds = [...new Set(cel.formations.map((f) => f.kind))].map((k) => (k === "ponte" ? "PONTE" : "MANDALA")).join(" + ");
      const who = s.players.find((p) => p.id === cel.playerId)?.name ?? "";
      const label = cel.batida
        ? `${who} bateu!${kinds ? ` ${kinds}` : ""} +${cel.points}`
        : `${who ? `${who}: ` : ""}${kinds}! +${cel.points}`;
      if (cel.batida) showNotice(`${who} bateu!`);
      celebrationEndsAt = performance.now() + 480 + CONFETTI_MS;
      celebrated = cel.playerId;
      setTimeout(() => {
        const at = board.celebrate?.(cells);
        const rect = $("table").getBoundingClientRect();
        confetti.burst(at?.x ?? rect.left + rect.width / 2, at?.y ?? rect.top + rect.height / 2, label);
      }, 480);
    }
    seenCelebration = cel?.seq ?? 0;

    // placar (espectadores ficam no painel próprio)
    $<HTMLAnchorElement>("share-wa").href = whatsappUrl(s.room, s.title);
    if (s.title) document.title = `${s.title} · Triminó`;
    // anfitrião, durante a partida: ✕ para tirar um jogador (ex.: sumiu sem avisar); a vez passa se for dele
    const iAmHost = !!s.players.find((p) => p.id === s.you.id)?.isHost;
    const inMatch = s.phase === "lottery" || s.phase === "playing" || s.phase === "roundOver";
    $("scores").replaceChildren(
      ...s.players.filter((p) => !p.spectator).map((p, i) => {
        const li = document.createElement("li");
        li.className = `score${p.id === s.turnPlayerId ? " turn" : ""}${p.connected ? "" : " away"}${p.out ? " out" : ""}`;
        li.style.setProperty("--owner", p.spectator ? "#888" : PLAYER_COLORS[i % 4]);
        li.innerHTML = `<span class="dot"></span><span class="nm"></span><b>${p.score}</b>${p.out ? "<small>desistiu</small>" : !p.connected ? "<small>offline</small>" : ""}`;
        li.querySelector(".nm")!.textContent = p.name;
        if (iAmHost && inMatch && !p.out && p.id !== s.you.id) {
          const x = Object.assign(document.createElement("button"), { className: "score-remove", textContent: "✕", title: `Tirar ${p.name} da partida` });
          x.setAttribute("aria-label", x.title);
          x.onclick = () => {
            if (confirm(`Tirar ${p.name} da partida? Conta como desistência${p.id === s.turnPlayerId ? " e a vez passa para o próximo" : ""}.`))
              conn.send({ t: "removePlayer", id: p.id });
          };
          li.append(x);
        }
        return li;
      }),
    );
    renderSheet(s);
    renderTokens(s);
    if (!s.tokens && !$("tokens-panel").hidden) openPanel(null);

    // banner / overlay
    const me = s.players.find((p) => p.id === s.you.id);
    const turnName = s.players.find((p) => p.id === s.turnPlayerId)?.name;
    const batedor = s.finalLap && s.players.find((p) => p.id === s.finalLap!.batedorId)?.name;
    renderWatchers(s, !!me?.isHost);
    $("banner").textContent =
      s.phase !== "playing" ? "" :
      me?.spectator ? `Você está assistindo · vez de ${turnName}` :
      batedor ? (myTurn ? `${batedor} bateu! Sua última vez.` : `${batedor} bateu! Última vez de ${turnName}.`) :
      myTurn ? (selectedTile === null ? (s.board.length ? "Sua vez! Escolha uma peça." : "Sua vez! Abra com a peça que quiser.") : preview ? "Toque de novo para girar, depois Jogar." : "Toque num espaço livre.") :
      `Vez de ${turnName}`;
    $("banner").classList.toggle("mine", myTurn);
    document.querySelector(".dock")!.classList.toggle("mine", myTurn);
    renderOverlay(s, !!me?.isHost);
    const midGame = s.phase === "lottery" || s.phase === "playing" || s.phase === "roundOver";
    $("restart").hidden = !(me?.isHost && midGame);
    if ($("restart").hidden) setRestartOpen(false);
    $("restart-round").toggleAttribute("disabled", s.phase !== "playing");
    renderSeats(s);

    // mão (não redesenha no meio de um arrasto; render() é chamado de novo quando o jogador solta)
    const pos = new Map(handOrder.map((id, i) => [id, i]));
    const hand = [...s.you.hand].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    handOrder = hand.map((t) => t.id);
    if (!draggingHand)
      $("hand").replaceChildren(
        ...hand.map((t) => {
          const b = document.createElement("button");
          b.className = `hand-tile${t.id === selectedTile ? " selected" : ""} draggable`;
          b.dataset.id = String(t.id);
          b.title = myTurn ? "Clique para escolher, arraste para reorganizar" : "Arraste para reorganizar";
          b.append(tileVisual(t.v));
          b.onclick = () => {
            if (handDrag.consumeClick()) return;
            selectedTile = selectedTile === t.id ? null : t.id;
            preview = null;
            render();
          };
          return b;
        }),
      );

    // ações: só aparecem as possíveis agora; se sobrar uma só, ela fica maior
    const actions = { play: !!preview, rotate: !!preview, draw: s.you.canDraw, pass: s.you.canPass };
    const available = Object.values(actions).filter(Boolean).length;
    for (const [id, on] of Object.entries(actions)) {
      $(id).toggleAttribute("disabled", !on);
      $(id).hidden = !on;
      $(id).classList.toggle("solo", on && available === 1);
    }

    // log
    // O servidor manda as últimas linhas; só acrescentamos as novas.
    const keys = s.log.map((e) => JSON.stringify(e));
    let overlap = Math.min(seenLog.length, keys.length);
    const same = (a: string[], b: string[]) => a.every((x, i) => x === b[i]);
    while (overlap > 0 && !same(seenLog.slice(-overlap), keys.slice(0, overlap))) overlap--;
    const fresh = s.log.slice(overlap);
    for (const entry of fresh) addLog(entry);
    // avisa quando um adversário compra (não na primeira carga, para não repetir o histórico)
    if (seenLog.length)
      for (const entry of fresh)
        if (entry.action === "comprou uma peça" && entry.actor && entry.actor !== me?.name) notifyDraw(entry.actor);
    // pontos de cada pedra jogada sobem dela (a comemoração de ponte/mandala/batida já mostra os seus)
    if (seenLog.length)
      for (const b of placed) {
        if (b.by === celebrated) continue;
        const who = s.players.find((p) => p.id === b.by)?.name;
        const sorted = (v: readonly number[]) => [...v].sort().join();
        const entry = fresh.find((e) => e.action === "jogou" && e.actor === who && e.tile && sorted(e.tile) === sorted(b.vals));
        if (entry?.points !== undefined) floatPoints(b.r, b.c, entry.points);
      }
    seenLog = keys;
    labelVideos();
  }

  /** "+12" (azul) ou "−5" (vermelho) subindo da pedra, depois de ela terminar de cair. */
  function floatPoints(r: number, c: number, points: number): void {
    setTimeout(() => {
      const at = board.cellToScreen?.(r, c);
      if (!at) return;
      const el = Object.assign(document.createElement("div"), {
        className: `float-pts ${points > 0 ? "pos" : points < 0 ? "neg" : "zero"}`,
        textContent: points < 0 ? `−${-points}` : `+${points}`,
      });
      el.setAttribute("aria-hidden", "true");
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      document.body.append(el);
      el.addEventListener("animationend", () => el.remove());
    }, 480);
  }

  function renderOverlay(s: GameState, isHost: boolean): void {
    const ov = $("overlay");
    if ((s.phase === "roundOver" || s.phase === "gameOver") && s.roundSummary?.hands) {
      renderSettlement(ov, s, isHost);
      return;
    }
    ov.replaceChildren();
    ov.classList.remove("reveal");
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
    const seated = s.players.filter((x) => x.connected && !x.spectator).length;
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
        await navigator.clipboard?.writeText(mesaUrl(s.room)).catch(() => {});
        toast("Link da mesa copiado!");
      };
      const wa = Object.assign(document.createElement("a"), {
        className: "secondary button-link wa",
        href: whatsappUrl(s.room, s.title),
        target: "_blank",
        rel: "noopener",
        textContent: "WhatsApp",
      });
      const shareButtons = document.createElement("div");
      shareButtons.className = "row";
      shareButtons.append(copy, wa);
      code.append(big, shareButtons);
      p.after(code);
      const me = s.players.find((x) => x.id === s.you.id);
      if (me?.spectator) {
        // Espectador na espera: pode sentar se houver lugar.
        h.textContent = "Você está assistindo";
        btn.textContent = seated >= 4 ? "Mesa cheia" : "Sentar à mesa";
        btn.disabled = seated >= 4;
        btn.onclick = () => conn.send({ t: "sit" });
        box.append(h, p, code, btn);
        ov.append(box);
        return;
      }
      btn.textContent = isHost ? (seated < 2 ? "Precisa de 2 jogadores" : "Começar partida") : "Aguardando o anfitrião…";
      btn.disabled = !isHost || seated < 2;
      btn.onclick = () => conn.send({ t: "start" });
      box.append(h, p, code, botsSection(s, !!s.you.canManageBots, seated), btn);
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
        const champ = s.players.find((x) => x.id === s.winnerId) ?? [...s.players].sort((a, b) => b.score - a.score)[0];
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

  /**
   * Batida: quando a comemoração termina, a mesa dá lugar às mãos de cada adversário e às contas,
   * passo a passo. No fim aparece o botão da próxima rodada (ou o resultado da partida).
   */
  function renderSettlement(ov: HTMLElement, s: GameState, isHost: boolean): void {
    const key = `${s.round}:${s.roundSummary!.winnerId}`;
    if (settlement?.key !== key) {
      settlement?.view.abort();
      const view = new Settlement(s, tileVisual, (id) => colorOfSeat(s, id));
      settlement = { key, view };
      const wait = Math.max(400, celebrationEndsAt - performance.now() + 300);
      setTimeout(() => {
        if (settlement?.view !== view) return;
        void view.play(() => render());
        render();
      }, wait);
    }
    const view = settlement!.view;
    ov.hidden = !view.started;
    ov.classList.add("reveal");
    // rodapé: próxima rodada ou fim da partida
    const p = document.createElement("p");
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.disabled = !isHost;
    if (s.phase === "roundOver") {
      p.textContent = `Meta: ${s.targetScore} pontos.`;
      btn.textContent = isHost ? "Próxima rodada" : "Aguardando o anfitrião…";
      btn.onclick = () => conn.send({ t: "nextRound" });
    } else {
      const champ = s.players.find((x) => x.id === s.winnerId) ?? [...s.players].sort((a, b) => b.score - a.score)[0];
      p.textContent = `🏆 ${champ.name} venceu a partida com ${champ.score} pontos!`;
      btn.textContent = isHost ? "Nova partida" : "Aguardando o anfitrião…";
      btn.onclick = () => conn.send({ t: "start" });
    }
    view.footer.replaceChildren(p, btn);
    // reinserir o elemento reiniciaria as animações, então só entra uma vez
    if (ov.firstChild !== view.el) ov.replaceChildren(view.el);
  }

  /** Jogadores IA na sala; só o administrador do site adiciona (até 4 lugares) e remove. */
  function botsSection(s: GameState, canManage: boolean, seated: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "bots";
    for (const bot of s.players.filter((x) => x.bot)) {
      const chip = document.createElement("span");
      chip.className = "bot-chip";
      chip.textContent = bot.name;
      if (canManage) {
        const x = document.createElement("button");
        x.title = `Remover ${bot.name}`;
        x.textContent = "✕";
        x.onclick = () => conn.send({ t: "removeBot", id: bot.id });
        chip.append(x);
      }
      wrap.append(chip);
    }
    if (canManage) {
      const add = document.createElement("button");
      add.className = "secondary";
      add.textContent = "+ Adicionar IA";
      add.disabled = seated >= 4;
      add.title = seated >= 4 ? "A sala já tem 4 jogadores" : "Adicionar um jogador controlado por IA";
      add.onclick = () => conn.send({ t: "addBot" });
      wrap.append(add);
    }
    return wrap;
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

/**
 * Pedidos de espectadores para entrar na conversa: só o anfitrião vê, abaixo das câmeras, para permitir ou recusar.
 * Quem já está na conversa aparece nas câmeras com a etiqueta "Espectador". O próprio espectador tem o botão de pedir.
 */
function renderWatchers(s: GameState, isHost: boolean): void {
  const requests = isHost ? s.players.filter((p) => p.spectator && p.connected && p.callRequested) : [];
  const list = $("call-requests");
  list.hidden = !requests.length;
  list.replaceChildren(
    ...requests.map((p) => {
      const li = document.createElement("li");
      const text = Object.assign(document.createElement("span"), { textContent: `✋ ${p.name}${p.guest ? " (convidado)" : ""} quer entrar na conversa` });
      const action = (label: string, act: string, cls: string) => {
        const b = Object.assign(document.createElement("button"), { className: `${cls} small`, textContent: label });
        b.dataset.action = act;
        b.dataset.id = p.id;
        return b;
      };
      const row = document.createElement("div");
      row.className = "row";
      row.append(action("Permitir", "allow", "primary"), action("Recusar", "deny", "secondary"));
      li.append(text, row);
      return li;
    }),
  );

  // botão do próprio espectador
  const me = s.players.find((p) => p.id === s.you.id);
  const btn = $("call-request");
  btn.hidden = !me?.spectator;
  btn.textContent = me?.inCall ? "Sair da conversa" : me?.callRequested ? "Cancelar pedido" : "✋ Pedir para entrar na conversa";
  btn.classList.toggle("waiting", !!me?.callRequested);
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

/**
 * Adversários: os adversários empilhados à esquerda do tabuleiro, na ordem da vez, com a mão virada para baixo.
 * Quem está jogando ganha uma borda dourada.
 */
function renderSeats(s: GameState): void {
  const layer = $("seats");
  const inRound = s.phase === "playing" || s.phase === "roundOver";
  $("seats-toggle").hidden = !inRound;
  $("seats-toggle").classList.toggle("active", showSeats);
  $("seats-toggle").setAttribute("aria-pressed", String(showSeats));
  layer.hidden = !(showSeats && inRound);
  if (layer.hidden) return;
  const seated = s.players.filter((p) => !p.spectator);
  const mine = seated.findIndex((p) => p.id === s.you.id);
  // adversários na ordem da vez, a partir de quem joga depois de você
  const others = seated.length ? [...seated.slice(mine + 1), ...seated.slice(0, Math.max(0, mine))].filter((p) => p.id !== s.you.id) : [];
  layer.replaceChildren(
    ...others.map((p) => {
      const seat = document.createElement("button");
      seat.className = `seat${p.id === s.turnPlayerId ? " turn" : ""}${p.out ? " out" : ""}`;
      seat.dataset.id = p.id;
      seat.style.setProperty("--owner", colorOfSeat(s, p.id));
      seat.title = "Ver quantas pedras tem na mão";
      const name = document.createElement("span");
      name.className = "seat-name";
      name.textContent = p.name;
      const tiles = document.createElement("span");
      tiles.className = "seat-tiles";
      for (let k = 0; k < p.handCount; k++) {
        const back = document.createElement("span");
        back.className = "tile-back";
        tiles.append(back);
      }
      seat.append(name, tiles);
      if (revealedSeats.has(p.id)) {
        const count = document.createElement("span");
        count.className = "seat-count";
        count.textContent = p.out ? "desistiu" : p.handCount === 1 ? "1 pedra" : `${p.handCount} pedras`;
        seat.append(count);
      }
      return seat;
    }),
  );
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Registro de tokens dos jogadores IA: uma linha por jogada de robô, com os totais da partida no topo. */
function renderTokens(s: GameState): void {
  const log = s.tokens;
  $("tokens-toggle").hidden = !log;
  if (!log) return;
  const t = log.totals;
  $("tokens-summary").innerHTML = "";
  const summary = document.createElement("div");
  summary.append(
    Object.assign(document.createElement("b"), { textContent: `${fmt(t.total)} tokens` }),
    ` em ${t.calls} ${t.calls === 1 ? "chamada" : "chamadas"} · entrada ${fmt(t.prompt)} · saída ${fmt(t.completion)}`,
    t.reasoning ? ` (raciocínio ${fmt(t.reasoning)})` : "",
  );
  const model = Object.assign(document.createElement("small"), { textContent: `Modelo: ${log.model}` });
  $("tokens-summary").append(summary, model);

  const list = $("tokens");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
  if (!log.entries.length) {
    list.replaceChildren(Object.assign(document.createElement("li"), { className: "tokens-empty", textContent: "Nenhuma jogada de IA ainda." }));
    return;
  }
  list.replaceChildren(
    ...log.entries.map((e) => {
      const li = document.createElement("li");
      li.className = e.source === "ia" ? "" : "fallback";
      const head = document.createElement("div");
      head.className = "tokens-head";
      const who = Object.assign(document.createElement("b"), { textContent: e.bot });
      const tile = Object.assign(document.createElement("span"), { className: "log-tile", textContent: e.tile.join("-") });
      const pts = Object.assign(document.createElement("span"), {
        className: e.points < 0 ? "pts neg" : "pts pos",
        textContent: e.points < 0 ? `−${-e.points}` : `+${e.points}`,
      });
      const total = Object.assign(document.createElement("span"), { className: "tokens-total", textContent: e.total ? `${fmt(e.total)} tokens` : "0 tokens" });
      head.append(Object.assign(document.createElement("small"), { textContent: `R${e.round}` }), who, tile, pts, total);
      const detail = document.createElement("small");
      detail.className = "tokens-detail";
      const parts = [e.source === "ia" ? "IA escolheu" : "melhor pontuação", e.note];
      if (e.total) parts.push(`entrada ${fmt(e.prompt)} · saída ${fmt(e.completion)}${e.reasoning ? ` (raciocínio ${fmt(e.reasoning)})` : ""}`);
      if (e.ms) parts.push(`${(e.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);
      detail.textContent = parts.filter(Boolean).join(" · ");
      li.append(head, detail);
      return li;
    }),
  );
  if (atBottom) list.scrollTop = list.scrollHeight;
}

/**
 * Folha de pontos, como a anotada no papel: uma coluna por jogador com o total depois de cada vez que ele pontua.
 * As rodadas ficam alinhadas entre as colunas; o bônus de quem venceu a rodada aparece circulado.
 */
function renderSheet(s: GameState): void {
  const sheet = $("sheet");
  const atBottom = sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight < 8;
  const cols = s.scoreSheet.map((c) => ({ ...c, player: s.players.find((p) => p.id === c.playerId) }));
  if (!cols.some((c) => c.marks.length)) {
    const empty = document.createElement("p");
    empty.className = "sheet-empty";
    empty.textContent = "Os totais de cada jogador vão sendo anotados aqui a cada jogada.";
    sheet.replaceChildren(empty);
    return;
  }
  sheet.style.setProperty("--cols", String(cols.length));
  const cells: HTMLElement[] = cols.map((c) => {
    const name = document.createElement("strong");
    name.className = `sheet-name${c.player?.out ? " out" : ""}`;
    name.style.setProperty("--owner", colorOfSeat(s, c.playerId));
    name.textContent = c.player?.name ?? "?";
    return name;
  });
  const lastRound = Math.max(...cols.flatMap((c) => c.marks.map((m) => m.round)));
  for (let r = 1; r <= lastRound; r++) {
    const sep = document.createElement("div");
    sep.className = "sheet-round";
    sep.textContent = `Rodada ${r}`;
    cells.push(sep);
    for (const c of cols) {
      const ol = document.createElement("ol");
      for (const m of c.marks.filter((m) => m.round === r)) {
        const li = document.createElement("li");
        li.textContent = String(m.total);
        if (m.roundWin) li.className = "win";
        ol.append(li);
      }
      cells.push(ol);
    }
  }
  sheet.replaceChildren(...cells);
  if (atBottom) sheet.scrollTop = sheet.scrollHeight;
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

/** Aviso passageiro abaixo da mensagem da vez: "Ana comprou uma pedra" (soma se a mesma pessoa comprar de novo). */
let drawNotice = { actor: "", count: 0 };
let noticeTimer = 0;
function notifyDraw(actor: string): void {
  const again = drawNotice.actor === actor && $("notice").classList.contains("show");
  drawNotice = { actor, count: again ? drawNotice.count + 1 : 1 };
  showNotice(`${actor} comprou ${drawNotice.count === 1 ? "uma pedra" : `${drawNotice.count} pedras`}`);
}

function showNotice(text: string): void {
  const n = $("notice");
  if (!text.includes("comprou")) drawNotice = { actor: "", count: 0 };
  n.textContent = text;
  n.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => n.classList.remove("show"), 3500);
}

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}
