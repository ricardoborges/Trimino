// Site: landing page com login (e-mail e senha, Google ou convidado) e a varanda, onde ficam as
// mesas abertas. Quando o jogador escolhe uma mesa, a página vai para /mesa/CODIGO e o jogo começa.

import type { MesaSummary, PlayerStats, RankingRow, UserInfo, Values } from "@trimino/shared";
import { cellVertices, vertexToPixel } from "@trimino/shared";
import { EDGE, handTileSvg, tileShape } from "./board.ts";
import { webglAvailable } from "./board3d/Board3D.ts";
import { HERO_BOARD, HeroScene } from "./board3d/HeroScene.ts";
import { arrangementPhoto, tilePhoto, type PlacedTile } from "./board3d/tilePhotos.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* sem storage */ } },
};

/** O que o jogo precisa para entrar na mesa. */
export interface Entry {
  room: string;
  /** Entrar só para assistir. */
  watch: boolean;
  name: string;
  /** Câmera e microfone ligados ao entrar. */
  media: boolean;
  user: UserInfo | null;
}

interface Me {
  user: UserInfo | null;
  stats: PlayerStats | null;
}

const GUEST_KEY = "trimino.guest";
const NAME_KEY = "trimino.name";
const MEDIA_KEY = "trimino.media";

const mesaPath = (code: string, watch = false) => `/mesa/${encodeURIComponent(code)}${watch ? "?assistir=1" : ""}`;
export const mesaUrl = (code: string) => `${location.origin}/mesa/${encodeURIComponent(code)}`;

/** Link do WhatsApp com o convite para a mesa. */
export function whatsappUrl(code: string, title?: string): string {
  const where = title ? `na mesa "${title}"` : "na minha mesa";
  return `https://wa.me/?text=${encodeURIComponent(`Bora jogar Triminó? Entra ${where}: ${mesaUrl(code)}`)}`;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Não foi possível falar com o servidor.");
  return data;
}

const guestName = () => (storage.get(GUEST_KEY) ? storage.get(NAME_KEY) : null);
const wantsMedia = () => storage.get(MEDIA_KEY) !== "0";

/**
 * Mostra o site até o jogador escolher uma mesa. Resolve com a mesa escolhida
 * (direto, se a página já abriu em /mesa/CODIGO e o jogador já entrou antes).
 */
export async function enterSite(): Promise<Entry> {
  // Links antigos: ?sala=CODIGO
  const legacy = new URLSearchParams(location.search).get("sala");
  if (legacy) history.replaceState(null, "", mesaPath(legacy.toUpperCase()));

  const me = await api<Me>("/api/me").catch((): Me => ({ user: null, stats: null }));
  const config = await api<{ google: boolean }>("/api/config").catch(() => ({ google: false }));

  return new Promise<Entry>((resolve) => {
    const go = (path: string) => {
      history.pushState(null, "", path);
      route();
    };

    function route(): void {
      const path = location.pathname;
      const mesa = path.match(/^\/mesa\/([A-Za-z0-9]{1,12})\/?$/);
      const name = me.user?.name ?? guestName();
      if (mesa && name) {
        $("site").hidden = true;
        resolve({
          room: mesa[1].toUpperCase(),
          watch: new URLSearchParams(location.search).has("assistir"),
          name,
          media: wantsMedia(),
          user: me.user,
        });
        return;
      }
      $("site").hidden = false;
      if (path === "/varanda" && name) return showVaranda(me, name);
      showLanding(me, config.google, mesa?.[1].toUpperCase() ?? null, path === "/varanda" ? "/varanda" : mesa ? path + location.search : null);
    }

    // Links internos sem recarregar a página.
    document.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-link]");
      if (!a || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      go(a.getAttribute("href")!);
    });
    window.addEventListener("popstate", route);
    onLoggedIn = (user, stats) => {
      me.user = user;
      me.stats = stats;
      const next = new URLSearchParams(location.search).get("next");
      go(next && next.startsWith("/") && !next.startsWith("//") ? next : "/varanda");
    };
    route();
  });
}

let onLoggedIn: (user: UserInfo | null, stats: PlayerStats | null) => void = () => {};

// ---------------- landing ----------------

let landingReady = false;

function showLanding(me: Me, google: boolean, invitedTo: string | null, next: string | null): void {
  $("varanda").hidden = true;
  $("landing").hidden = false;
  stopPolling();
  document.title = "Triminó · dominó triangular online";
  if (next) history.replaceState(null, "", `/?next=${encodeURIComponent(next)}`);

  const err = new URLSearchParams(location.search).get("erro");
  $("auth-error").textContent = err ?? "";

  const name = me.user?.name ?? guestName();
  $("auth-welcome").hidden = !name;
  $("auth-forms").hidden = !!name;
  $("auth-welcome-name").textContent = name ?? "";
  $("google-block").hidden = !google;
  $<HTMLAnchorElement>("google-login").href = `/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  $("auth-invite").hidden = !invitedTo;
  $("auth-invite").textContent = invitedTo ? `Você foi chamado para a mesa ${invitedTo}. Entre para sentar.` : "";
  if (invitedTo) selectTab("guest");
  const wantsAccount = new URLSearchParams(location.search).has("criar");
  if (wantsAccount && !name) {
    selectTab("signup");
    history.replaceState(null, "", "/");
  }
  // Quem já entrou vai direto para a varanda; quem chegou por um convite cai no cartão de entrada.
  const cta = $<HTMLAnchorElement>("hero-cta");
  cta.href = name ? "/varanda" : "#entrar";
  cta.toggleAttribute("data-link", !!name);
  cta.textContent = name ? "Ir para a varanda" : "Armar uma mesa";
  if (!name && (invitedTo || next || wantsAccount)) requestAnimationFrame(() => $("entrar").scrollIntoView({ block: "center" }));

  if (landingReady) {
    heroScene?.replay();
    return;
  }
  landingReady = true;
  decorateLanding();

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) tab.onclick = () => selectTab(tab.dataset.tab!);
  $("auth-switch").onclick = async () => {
    await signOut();
    me.user = null;
    me.stats = null;
    $("auth-welcome").hidden = true;
    $("auth-forms").hidden = false;
  };
  (($<HTMLFormElement>("guest-form").elements.namedItem("name")) as HTMLInputElement).value = storage.get(NAME_KEY) ?? "";

  const submit = (id: string, handler: (data: FormData) => Promise<void>) => {
    const form = $<HTMLFormElement>(id);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      btn.disabled = true;
      $("auth-error").textContent = "";
      try {
        await handler(new FormData(form));
      } catch (err) {
        $("auth-error").textContent = (err as Error).message;
      } finally {
        btn.disabled = false;
      }
    });
  };
  submit("login-form", async (d) => {
    const { user } = await api<{ user: UserInfo }>("/api/login", { email: d.get("email"), password: d.get("password") });
    storage.del(GUEST_KEY);
    const fresh = await api<Me>("/api/me");
    onLoggedIn(user, fresh.stats);
  });
  submit("signup-form", async (d) => {
    const { user } = await api<{ user: UserInfo }>("/api/signup", { name: d.get("name"), email: d.get("email"), password: d.get("password") });
    storage.del(GUEST_KEY);
    onLoggedIn(user, null);
  });
  submit("guest-form", async (d) => {
    const name = String(d.get("name")).replace(/\(\s*ia\s*\)/gi, "").trim().slice(0, 24);
    if (!name) throw new Error("Informe um nome.");
    storage.set(NAME_KEY, name);
    storage.set(GUEST_KEY, "1");
    onLoggedIn(null, null);
  });
}

function selectTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", String(on));
  }
  for (const form of document.querySelectorAll<HTMLElement>(".auth-form")) form.hidden = form.dataset.panel !== name;
  $("google-block").classList.toggle("dim", name === "guest");
  $("auth-error").textContent = "";
}

let heroScene: HeroScene | null = null;

/** Tabuleiro como o da mesa (mandala do herói), para os desenhos da landing. */
const heroCells = (from: number, to: number, glow = false): PlacedTile[] =>
  HERO_BOARD.slice(from, to).map(([r, c, ...vals]) => ({ r, c, vals: vals as Values, glow }));

/** Exemplos das regras, com pedras de verdade; a pedra em destaque é a jogada. */
const RULE_ART: Record<string, PlacedTile[]> = {
  encaixe: [
    { r: 0, c: -1, vals: [0, 3, 0] },
    { r: 0, c: 0, vals: [3, 3, 0] },
    { r: 0, c: 1, vals: [3, 2, 3], glow: true },
  ],
  // A pedra nova encosta pela aresta numa e só pelo canto na outra.
  ponte: [
    { r: 0, c: 0, vals: [2, 4, 1] },
    { r: 0, c: 1, vals: [2, 3, 4], glow: true },
    { r: -1, c: 2, vals: [0, 1, 3] },
  ],
  mandala: [...heroCells(0, 6, true), ...heroCells(6, 8), ...heroCells(16, 17)],
  bater: [{ r: 0, c: 0, vals: [5, 5, 5], glow: true }],
};

/** Mesmo arranjo em SVG, quando não há WebGL. */
function arrangementSvg(tiles: PlacedTile[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const pts = tiles.map((t) => cellVertices(t.r, t.c).map((v) => vertexToPixel(v, EDGE)));
  const xs = pts.flat().map((p) => p[0]);
  const ys = pts.flat().map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs) - 4, Math.min(...ys) - 4];
  svg.setAttribute("viewBox", `${x0} ${y0} ${Math.max(...xs) - x0 + 4} ${Math.max(...ys) - y0 + 4}`);
  svg.setAttribute("class", "hand-svg");
  tiles.forEach((t, i) => svg.append(tileShape(pts[i], t.vals, t.glow ? "tile glow" : "tile")));
  return svg;
}

function tileImage(url: string | null, fallback: () => Element, alt = ""): Element {
  if (!url) return fallback();
  return Object.assign(document.createElement("img"), { src: url, alt, draggable: false, decoding: "async" });
}

/** Cena 3D do herói, desenhos das regras, revelação ao rolar e a barra de navegação. */
function decorateLanding(): void {
  const gl = webglAvailable();
  if (gl) {
    try {
      heroScene = new HeroScene($("hero-scene"));
    } catch {
      heroScene = null;
    }
  }
  $("landing").classList.toggle("no-webgl", !heroScene);
  if (!heroScene) renderHeroTiles();

  // As fotos das pedras saem de um renderizador fora da tela; espera o primeiro quadro do herói.
  setTimeout(() => {
    for (const el of document.querySelectorAll<HTMLElement>(".step-art")) {
      const tiles = RULE_ART[el.dataset.art!];
      el.replaceChildren(tileImage(gl ? arrangementPhoto(tiles, 640, 440) : null, () => arrangementSvg(tiles)));
    }
    const mandala = RULE_ART.mandala.slice(0, 6);
    $("video-board").replaceChildren(tileImage(gl ? arrangementPhoto(mandala, 520, 440) : null, () => arrangementSvg(mandala)));
    const fan: Values[] = [[0, 1, 2], [1, 3, 5], [5, 5, 5], [2, 4, 4], [0, 0, 3]];
    $("final-tiles").replaceChildren(
      ...fan.map((v, i) => {
        const span = document.createElement("span");
        span.style.setProperty("--i", String(i - 2));
        span.append(tileImage(gl ? tilePhoto(v) : null, () => handTileSvg(v)));
        return span;
      }),
    );
  }, 60);

  // Seções aparecem ao entrar na tela.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
    },
    { root: $("site"), rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of document.querySelectorAll(".scroll-in")) io.observe(el);

  // Navegação transparente sobre o herói; ganha fundo ao rolar.
  const site = $("site");
  const nav = $("landing-nav");
  site.addEventListener("scroll", () => nav.classList.toggle("scrolled", site.scrollTop > 24), { passive: true });
}

/** Sem WebGL: pedras em SVG espalhadas no herói. */
function renderHeroTiles(): void {
  const tiles: Values[] = [[5, 5, 5], [0, 2, 4], [1, 3, 5], [3, 3, 4], [2, 5, 0]];
  $("hero-tiles").replaceChildren(
    ...tiles.map((v, i) => {
      const span = document.createElement("span");
      span.className = "hero-tile";
      span.style.setProperty("--i", String(i));
      span.append(handTileSvg(v));
      return span;
    }),
  );
}

async function signOut(): Promise<void> {
  storage.del(GUEST_KEY);
  await api("/api/logout", {}).catch(() => {});
}

// ---------------- varanda ----------------

let varandaReady = false;
/** Quem está na varanda entrou como convidado (não pode armar mesa). */
let guest = false;
let pollTimer = 0;
const stopPolling = () => clearInterval(pollTimer);

function showVaranda(me: Me, name: string): void {
  $("landing").hidden = true;
  $("varanda").hidden = false;
  document.title = "Varanda · Triminó";

  const chip = $("me-chip");
  chip.replaceChildren();
  if (me.user?.avatarUrl) {
    const img = Object.assign(document.createElement("img"), { src: me.user.avatarUrl, alt: "", referrerPolicy: "no-referrer" });
    chip.append(img);
  }
  chip.append(name);
  if (!me.user) chip.append(Object.assign(document.createElement("small"), { textContent: "convidado" }));

  // Convidado não arma mesa: no lugar do formulário, o convite para criar conta.
  guest = !me.user;
  $("create-form").hidden = guest;
  $("create-guest").hidden = !guest;
  // Aviso vindo de uma mesa que recusou a entrada (?aviso=...).
  const params = new URLSearchParams(location.search);
  const notice = params.get("aviso");
  $("varanda-notice").hidden = !notice;
  $("varanda-notice").textContent = notice ?? "";
  if (notice) history.replaceState(null, "", "/varanda");

  renderStats(me);
  loadRanking();
  refreshMesas();
  stopPolling();
  pollTimer = window.setInterval(() => !document.hidden && refreshMesas(), 4000);

  if (varandaReady) return;
  varandaReady = true;

  $("logout").onclick = async () => {
    await signOut();
    me.user = null;
    me.stats = null;
    stopPolling();
    location.href = "/";
  };
  const media = $<HTMLInputElement>("media-pref");
  media.checked = wantsMedia();
  media.onchange = () => storage.set(MEDIA_KEY, media.checked ? "1" : "0");

  $("guest-signup").onclick = async () => {
    await signOut();
    location.href = "/?criar=1";
  };

  $<HTMLFormElement>("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const d = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>("button")!;
    btn.disabled = true;
    try {
      const { code } = await api<{ code: string }>("/api/mesas", { private: d.get("private") === "on" });
      location.href = mesaPath(code);
    } catch (err) {
      alertInline(form, (err as Error).message);
      btn.disabled = false;
    }
  });

  $<HTMLFormElement>("code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const code = String(new FormData(form).get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) return;
    const watch = (e as SubmitEvent).submitter?.getAttribute("value") === "watch";
    location.href = mesaPath(code, watch);
  });
}

function alertInline(form: HTMLElement, text: string): void {
  let p = form.querySelector<HTMLElement>(".form-error");
  if (!p) {
    p = Object.assign(document.createElement("p"), { className: "form-error" });
    form.append(p);
  }
  p.textContent = text;
}

function renderStats(me: Me): void {
  const card = $("stats-card");
  const h = Object.assign(document.createElement("h2"), { textContent: "Suas estatísticas" });
  if (!me.user) {
    const p = Object.assign(document.createElement("p"), {
      className: "muted",
      textContent: "Você está como convidado. Crie uma conta para guardar partidas, vitórias e pontuações e aparecer no ranking.",
    });
    const a = Object.assign(document.createElement("a"), { href: "/?next=/varanda", className: "secondary button-link", textContent: "Criar conta" });
    a.onclick = async (e) => {
      e.preventDefault();
      await signOut();
      location.href = "/?next=/varanda";
    };
    card.replaceChildren(h, p, a);
    return;
  }
  const s = me.stats ?? { matches: 0, wins: 0, forfeits: 0, totalPoints: 0, bestScore: 0, rounds: 0, lastPlayedAt: null };
  const grid = document.createElement("dl");
  grid.className = "stats";
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const items: [string, string][] = [
    ["Partidas", fmt(s.matches)],
    ["Vitórias", fmt(s.wins)],
    ["Aproveitamento", s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : "–"],
    ["Melhor placar", fmt(s.bestScore)],
    ["Pontos somados", fmt(s.totalPoints)],
    ["Média por partida", s.matches ? fmt(Math.round(s.totalPoints / s.matches)) : "–"],
  ];
  for (const [k, v] of items) {
    const div = document.createElement("div");
    div.append(Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v }));
    grid.append(div);
  }
  card.replaceChildren(h, grid);
}

async function loadRanking(): Promise<void> {
  const { ranking } = await api<{ ranking: RankingRow[] }>("/api/ranking").catch(() => ({ ranking: [] as RankingRow[] }));
  $("ranking-card").hidden = !ranking.length;
  $("ranking").replaceChildren(
    ...ranking.slice(0, 10).map((r) => {
      const li = document.createElement("li");
      li.append(
        Object.assign(document.createElement("span"), { textContent: r.name }),
        Object.assign(document.createElement("small"), { textContent: `${r.wins} ${r.wins === 1 ? "vitória" : "vitórias"} · ${r.matches} ${r.matches === 1 ? "partida" : "partidas"}` }),
      );
      return li;
    }),
  );
}

const PHASE_LABEL: Record<MesaSummary["phase"], string> = {
  lobby: "Esperando jogadores",
  lottery: "Sorteio",
  playing: "Em jogo",
  roundOver: "Fim de rodada",
  gameOver: "Partida encerrada",
};

async function refreshMesas(): Promise<void> {
  let mesas: MesaSummary[];
  try {
    ({ mesas } = await api<{ mesas: MesaSummary[] }>("/api/mesas"));
  } catch {
    $("mesas-count").textContent = "sem conexão com o servidor";
    return;
  }
  $("mesas-count").textContent = mesas.length === 1 ? "1 mesa" : `${mesas.length} mesas`;
  if (!mesas.length) {
    const empty = document.createElement("div");
    empty.className = "mesas-empty";
    empty.innerHTML = guest
      ? "<strong>A varanda está vazia.</strong><span>Quando alguém armar uma mesa, ela aparece aqui para você entrar.</span>"
      : "<strong>A varanda está vazia.</strong><span>Arme a primeira mesa e chame a turma pelo WhatsApp.</span>";
    $("mesas").replaceChildren(empty);
    return;
  }
  $("mesas").replaceChildren(...mesas.map(mesaCard));
}

function mesaCard(m: MesaSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = `mesa${m.phase === "lobby" ? " open" : ""}`;

  const head = document.createElement("header");
  const title = Object.assign(document.createElement("h3"), { textContent: m.title });
  const phase = Object.assign(document.createElement("span"), {
    className: `phase phase-${m.phase}`,
    textContent: m.phase === "playing" || m.phase === "roundOver" ? `${PHASE_LABEL[m.phase]} · rodada ${m.round}` : PHASE_LABEL[m.phase],
  });
  head.append(title, phase);

  const seats = document.createElement("ul");
  seats.className = "mesa-seats";
  for (const p of m.players) {
    const li = document.createElement("li");
    li.className = `${p.connected ? "" : "away"}`;
    li.append(Object.assign(document.createElement("span"), { className: "seat-avatar", textContent: p.bot ? "🤖" : p.name.slice(0, 1).toUpperCase() }));
    li.append(Object.assign(document.createElement("span"), { className: "seat-name", textContent: p.name }));
    if (m.phase !== "lobby") li.append(Object.assign(document.createElement("b"), { textContent: String(p.score) }));
    seats.append(li);
  }
  for (let i = 0; i < m.seatsFree; i++) {
    const li = document.createElement("li");
    li.className = "free";
    li.append(Object.assign(document.createElement("span"), { className: "seat-avatar", textContent: "+" }), "Lugar livre");
    seats.append(li);
  }

  const foot = document.createElement("footer");
  foot.append(Object.assign(document.createElement("span"), { className: "muted", textContent: `👁 ${m.spectators} assistindo` }));
  if (m.seatsFree > 0) {
    const sit = Object.assign(document.createElement("a"), { className: "primary button-link", href: mesaPath(m.code), textContent: "Entrar" });
    foot.append(sit);
  }
  foot.append(Object.assign(document.createElement("a"), { className: "secondary button-link", href: mesaPath(m.code, true), textContent: "Assistir" }));
  card.append(head, seats, foot);
  return card;
}
