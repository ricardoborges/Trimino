// Comprar do monte: as pedras viradas para baixo, espalhadas na mesa como depois de embaralhar,
// e o jogador escolhe uma. A posição de cada pedra é a dela no monte (que o servidor embaralhou),
// então escolher continua sendo às cegas.

import type { GameState, Values } from "@trimino/shared";

const REVEAL_MS = 1200;
const SVG = "http://www.w3.org/2000/svg";

/** Aleatório com semente: o monte não se rearruma a cada atualização de estado. */
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

export class DrawPile {
  private readonly root: HTMLElement;
  private readonly pile: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly reveal: HTMLElement;
  private layoutKey = "";
  /** Mão antes da compra: a pedra nova é a que não estava nela. */
  private pending: { hand: Set<number>; timer: number } | null = null;
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

  /** Chamado a cada estado novo. */
  update(s: GameState): void {
    if (!this.open || this.revealing) return;
    if (this.pending) {
      const drawn = s.you.hand.find((t) => !this.pending!.hand.has(t.id));
      if (drawn) return this.showDrawn(drawn.v);
    }
    if (!s.you.canDraw) return this.hide();
    const left = s.you.drawsLeft ?? 1;
    this.hint.textContent = `${left === 1 ? "Última compra" : `Até ${left} compras`} nesta vez · cada uma custa 5 pontos`;
    const key = `${s.room}:${s.round}:${s.poolCount}`;
    if (key !== this.layoutKey) this.layout(s.poolCount, key);
    if (!this.pending) for (const b of this.pile.querySelectorAll("button")) b.disabled = false;
  }

  /** Espalha `n` pedras: uma grade frouxa, com folga, deslocamentos e giros ao acaso (pode encostar uma na outra). */
  private layout(n: number, key: string): void {
    this.layoutKey = key;
    const rand = seeded(key);
    // grade frouxa no formato da área (deitada no computador, em pé no celular)
    const box = this.pile.getBoundingClientRect();
    const w = box.width || 600;
    const h = box.height || 380;
    const cols = Math.max(1, Math.ceil(Math.sqrt(((n * 1.25) * w) / h)));
    const rows = Math.max(1, Math.ceil((n * 1.25) / cols));
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const size = Math.round(Math.max(30, Math.min(72, (w / cols) * 0.95, (h / rows) * 1.05)));
    this.pile.style.setProperty("--tile", `${size}px`);
    // margem para a pedra girada não sair da área
    const mx = ((size * 0.55) / w) * 100;
    const my = ((size * 0.55) / h) * 100;
    const tiles: HTMLElement[] = [];
    for (let slot = 0; slot < n; slot++) {
      const cell = cells[slot];
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      const x = ((col + 0.5 + (rand() - 0.5) * 0.9) / cols) * 100;
      const y = ((row + 0.5 + (rand() - 0.5) * 0.9) / rows) * 100;
      const b = document.createElement("button");
      b.className = "pile-tile";
      b.style.left = `${Math.min(100 - mx, Math.max(mx, x))}%`;
      b.style.top = `${Math.min(100 - my, Math.max(my, y))}%`;
      b.style.setProperty("--rot", `${Math.round(rand() * 360)}deg`);
      b.style.zIndex = String(1 + Math.floor(rand() * 20));
      b.style.animationDelay = `${Math.round(rand() * 160)}ms`;
      b.setAttribute("aria-label", `Pedra virada ${slot + 1}`);
      b.append(tileBack());
      b.onclick = () => this.pick(b, slot);
      tiles.push(b);
    }
    this.pile.replaceChildren(...tiles);
  }

  private pick(button: HTMLButtonElement, slot: number): void {
    if (this.pending) return;
    const hand = new Set(this.handIds());
    this.pending = {
      hand,
      // sem resposta (erro ou conexão caiu): libera para tentar de novo
      timer: window.setTimeout(() => {
        this.pending = null;
        this.layoutKey = "";
        for (const b of this.pile.querySelectorAll("button")) b.disabled = false;
        button.classList.remove("picked");
      }, 4000),
    };
    for (const b of this.pile.querySelectorAll("button")) b.disabled = true;
    button.classList.add("picked");
    this.onPick(slot);
  }

  /** A pedra comprada vira para cima no meio do monte e o modal fecha. */
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
