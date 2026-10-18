// Comprar do monte: as pedras viradas para baixo, espalhadas na mesa como depois de embaralhar,
// e o jogador escolhe uma. A posição de cada pedra é a dela no monte (que o servidor embaralhou),
// então escolher continua sendo às cegas.
//
// As pedras ficam no mesmo lugar a rodada inteira: a cada compra some só a escolhida, e o monte
// vai esvaziando. Cada pedra tem a sua casa numa grade frouxa, com folga para girar sem encostar.

import type { GameState, Values } from "@trimino/shared";

const REVEAL_MS = 1200;
const SVG = "http://www.w3.org/2000/svg";
/** Uma pedra girada cabe num círculo de diâmetro lado × 2/√3 ≈ 1,155 × lado; mais um respiro. */
const SPIN_ROOM = 1.22;

/** Aleatório com semente: a mesma rodada sempre espalha as pedras do mesmo jeito. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Verso da pedra: marfim, cantos arredondados, um triângulo gravado e um ponto no meio. */
function tileBack(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 90");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<polygon points="50,7 94,83 6,83" fill="url(#pile-back)" stroke="url(#pile-back)" stroke-width="10" stroke-linejoin="round"/>' +
    '<polygon points="50,24 79,74 21,74" fill="none" stroke="#b9a983" stroke-width="2" stroke-linejoin="round" opacity="0.8"/>' +
    '<circle cx="50" cy="57" r="4.5" fill="#c8b68d"/>';
  return svg;
}

interface Spot {
  x: number; // % da área
  y: number;
  rot: number;
}

export class DrawPile {
  private readonly root: HTMLElement;
  private readonly pile: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly reveal: HTMLElement;
  /** Rodada (e tamanho inicial do monte) a que as casas pertencem. */
  private roundKey = "";
  private spots: Spot[] = [];
  private tileSize = 60;
  /** Casas ainda com pedra, na ordem do monte no servidor: `alive[slot]` é a casa da pedra `slot`. */
  private alive: number[] = [];
  /** Compra enviada: a mão de antes (a pedra nova é a que não estava nela) e a posição escolhida. */
  private pending: { hand: Set<number>; slot: number; timer: number } | null = null;
  private revealing = false;
  open = false;

  constructor(
    root: HTMLElement,
    private readonly onPick: (slot: number) => void,
    private readonly tileVisual: (v: Values) => Element,
    private readonly handIds: () => number[],
  ) {
    this.root = root;
    this.pile = root.querySelector(".pile")!;
    this.hint = root.querySelector(".pile-hint")!;
    this.reveal = root.querySelector(".pile-reveal")!;
    root.addEventListener("click", (e) => {
      if (e.target === root || (e.target as HTMLElement).closest(".pile-close")) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open) this.hide();
    });
  }

  show(s: GameState): void {
    if (!s.you.canDraw) return;
    this.open = true;
    this.root.hidden = false;
    this.update(s);
  }

  hide(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.revealing = false;
    this.open = false;
    this.root.hidden = true;
    this.root.classList.remove("revealing");
  }

  /** Chamado a cada estado novo (com o modal aberto ou não, para acompanhar o monte). */
  update(s: GameState): void {
    if (this.revealing) return;
    if (this.pending) {
      const drawn = s.you.hand.find((t) => !this.pending!.hand.has(t.id));
      if (drawn) {
        this.alive.splice(this.pending.slot, 1);
        this.sync(s);
        return this.showDrawn(drawn.v);
      }
    }
    this.sync(s);
    if (!this.open) return;
    if (!s.you.canDraw) return this.hide();
    const left = s.you.drawsLeft ?? 1;
    this.hint.textContent = `${left === 1 ? "Última compra" : `Até ${left} compras`} nesta vez · cada uma custa 5 pontos`;
    if (!this.pending) for (const b of this.pile.querySelectorAll("button")) b.disabled = false;
  }

  /** Acompanha o tamanho do monte: rodada nova espalha de novo; compras dos outros (a de cima) somem do fim. */
  private sync(s: GameState): void {
    const round = `${s.room}:${s.round}`;
    if (!this.roundKey.startsWith(round + ":") || s.poolCount > this.alive.length) {
      // rodada nova, ou o monte cresceu (alguém desistiu e as pedras dele voltaram): espalha de novo
      this.roundKey = `${round}:${s.poolCount}`;
      this.scatter(s.poolCount);
    }
    while (this.alive.length > s.poolCount) this.alive.pop();
    if (this.open) this.draw();
  }

  /** Sorteia uma casa e um giro para cada pedra, numa grade com folga para não encostarem. */
  private scatter(n: number): void {
    const rand = seeded(this.roundKey);
    // proporção da área de verdade (deitada no computador, em pé no celular)
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    const box = this.pile.getBoundingClientRect();
    this.root.hidden = wasHidden;
    const w = box.width || 600;
    const h = box.height || 380;
    const slack = 1.35; // casas sobrando, para o monte não parecer uma grade
    const cols = Math.max(1, Math.round(Math.sqrt((n * slack * w) / h)));
    const rows = Math.max(1, Math.ceil((n * slack) / cols));
    const cellW = w / cols;
    const cellH = h / rows;
    this.tileSize = Math.round(Math.max(28, Math.min(70, Math.min(cellW, cellH) / SPIN_ROOM)));
    // quanto cada pedra pode escorregar dentro da casa sem invadir a vizinha
    const room = this.tileSize * (SPIN_ROOM / 2);
    const jx = Math.max(0, cellW / 2 - room);
    const jy = Math.max(0, cellH / 2 - room);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    this.spots = cells.slice(0, n).map((cell) => {
      const cx = ((cell % cols) + 0.5) * cellW + (rand() * 2 - 1) * jx;
      const cy = (Math.floor(cell / cols) + 0.5) * cellH + (rand() * 2 - 1) * jy;
      return { x: (cx / w) * 100, y: (cy / h) * 100, rot: Math.round(rand() * 360) };
    });
    this.alive = this.spots.map((_, i) => i);
    this.pile.replaceChildren();
  }

  /** Mostra só as pedras que ainda estão no monte, cada uma na sua casa (sem mexer nas outras). */
  private draw(): void {
    this.pile.style.setProperty("--tile", `${this.tileSize}px`);
    const keep = new Set(this.alive);
    for (const b of [...this.pile.children] as HTMLButtonElement[]) if (!keep.has(Number(b.dataset.spot))) b.remove();
    const present = new Set([...this.pile.children].map((b) => Number((b as HTMLElement).dataset.spot)));
    for (const spot of this.alive) {
      if (present.has(spot)) continue;
      const { x, y, rot } = this.spots[spot];
      const b = document.createElement("button");
      b.className = "pile-tile";
      b.dataset.spot = String(spot);
      b.style.left = `${x}%`;
      b.style.top = `${y}%`;
      b.style.setProperty("--rot", `${rot}deg`);
      b.setAttribute("aria-label", "Pedra virada para baixo");
      b.append(tileBack());
      b.onclick = () => this.pick(b, spot);
      this.pile.append(b);
    }
  }

  private pick(button: HTMLButtonElement, spot: number): void {
    const slot = this.alive.indexOf(spot);
    if (this.pending || slot < 0) return;
    this.pending = {
      hand: new Set(this.handIds()),
      slot,
      // sem resposta (erro ou conexão caiu): libera para tentar de novo
      timer: window.setTimeout(() => {
        this.pending = null;
        for (const b of this.pile.querySelectorAll("button")) b.disabled = false;
        button.classList.remove("picked");
      }, 4000),
    };
    for (const b of this.pile.querySelectorAll("button")) b.disabled = true;
    button.classList.add("picked");
    this.onPick(slot);
  }

  /** A pedra comprada vira para cima no meio do monte (a casa dela fica vazia) e o modal fecha. */
  private showDrawn(v: Values): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.revealing = true;
    const face = document.createElement("div");
    face.className = "pile-drawn";
    face.append(this.tileVisual(v));
    const label = Object.assign(document.createElement("span"), { className: "pile-drawn-label", textContent: "Você comprou" });
    this.reveal.replaceChildren(label, face);
    this.root.classList.add("revealing");
    setTimeout(() => this.hide(), REVEAL_MS);
  }
}
