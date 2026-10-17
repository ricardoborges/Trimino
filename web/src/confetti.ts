// Comemoração de ponte/mandala: dois lançadores de confete (como os de festa de aniversário) nos
// cantos de baixo da mesa disparam em direção ao centro, e um letreiro mostra os pontos.
// Tudo fica numa camada por cima da mesa, que não captura cliques.

import { VALUE_COLORS } from "./board3d/textures.ts";

const COLORS = [...VALUE_COLORS.slice(1), "#f2b33d", "#ffffff", "#ff6fae"];
/** Quanto dura a comemoração inteira (confete caindo e letreiro). */
export const DURATION_MS = 3600;
const FIRE_AT_MS = 450; // o disparo coincide com o "tranco" da animação do lançador (CSS)
const FIRE_MS = 420; // quanto tempo cada lançador fica soltando confete
const PER_FRAME = 9; // confetes por lançador a cada quadro de ~16 ms enquanto dispara

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  round: boolean;
}

/** Lançador de confete em SVG: tubo listrado com a boca para cima (gira para mirar o centro). */
function popperSvg(): string {
  return `
<svg viewBox="0 0 60 110" aria-hidden="true">
  <defs>
    <linearGradient id="popper-tube" x1="0" x2="1">
      <stop offset="0" stop-color="#b8131f"/><stop offset="0.45" stop-color="#ef3b3b"/><stop offset="1" stop-color="#9c0f1a"/>
    </linearGradient>
    <pattern id="popper-stripes" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="14" height="14" fill="url(#popper-tube)"/><rect width="5" height="14" fill="#ffd34d"/>
    </pattern>
  </defs>
  <path d="M8 8 H52 L42 100 H18 Z" fill="url(#popper-stripes)" stroke="#5c0a10" stroke-width="2"/>
  <ellipse cx="30" cy="8" rx="22" ry="6" fill="#3b0a0f" stroke="#ffd34d" stroke-width="2.5"/>
  <rect x="16" y="98" width="28" height="9" rx="3" fill="#ffd34d" stroke="#8a5a00" stroke-width="1.5"/>
</svg>`;
}

export class Confetti {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private poppers: HTMLElement[];
  private pieces: Piece[] = [];
  private start = 0;
  private last = 0;
  private running = false;
  private origins: { x: number; y: number; angle: number }[] = [];

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "confetti";
    this.ctx = this.canvas.getContext("2d")!;
    this.poppers = ["left", "right"].map((side) => {
      const el = document.createElement("div");
      el.className = `popper popper-${side}`;
      el.innerHTML = popperSvg();
      return el;
    });
    host.append(this.canvas, ...this.poppers);
  }

  /** Comemora: os lançadores disparam rumo ao centro e o letreiro aparece em (x, y) (coordenadas da janela). */
  burst(x: number, y: number, label: string): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.showLabel(x - rect.left, y - rect.top, label);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    this.origins = [];
    for (const el of this.poppers) {
      el.classList.remove("firing");
      void el.offsetWidth; // reinicia a animação se disparar de novo
      el.classList.add("firing");
    }
    this.start = this.last = performance.now();
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.tick);
    }
  }

  /** Boca de cada lançador (já na posição de disparo) e direção até um ponto acima do centro da mesa. */
  private aim(): { x: number; y: number; angle: number }[] {
    const rect = this.host.getBoundingClientRect();
    const target = { x: rect.width / 2, y: rect.height * 0.3 };
    return this.poppers.map((el) => {
      const r = el.getBoundingClientRect();
      const left = el.classList.contains("popper-left");
      const mouth = { x: (left ? r.right - r.width * 0.2 : r.left + r.width * 0.2) - rect.left, y: r.top + r.height * 0.15 - rect.top };
      return { ...mouth, angle: Math.atan2(target.y - mouth.y, target.x - mouth.x) };
    });
  }

  private spawn(o: { x: number; y: number; angle: number }, n: number): void {
    for (let i = 0; i < n; i++) {
      const angle = o.angle + (Math.random() - 0.5) * 0.55;
      const speed = 20 + Math.random() * 14;
      this.pieces.push({
        x: o.x,
        y: o.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.45,
        w: 7 + Math.random() * 7,
        h: 4 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        round: Math.random() < 0.2,
      });
    }
  }

  private showLabel(x: number, y: number, text: string): void {
    const el = document.createElement("div");
    el.className = "celebration-label";
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.host.append(el);
    el.addEventListener("animationend", () => el.remove());
  }

  private tick = (): void => {
    const now = performance.now();
    const t = now - this.start;
    // física em "quadros de 16 ms", para durar igual em telas rápidas e lentas
    const step = Math.min(3, (now - this.last) / 16.67);
    this.last = now;
    if (t >= FIRE_AT_MS && t < FIRE_AT_MS + FIRE_MS) {
      if (!this.origins.length) this.origins = this.aim();
      for (const o of this.origins) this.spawn(o, Math.round(PER_FRAME * step));
    }

    const { width, height } = this.canvas.getBoundingClientRect();
    const fade = Math.max(0, 1 - Math.max(0, t - DURATION_MS * 0.65) / (DURATION_MS * 0.35));
    this.ctx.clearRect(0, 0, width, height);
    // resistência do ar alta + gravidade baixa: o papel desacelera e cai flutuando
    const drag = Math.pow(0.962, step);
    for (const p of this.pieces) {
      p.vy += 0.17 * step; // gravidade
      p.vx += Math.sin((now + p.rot * 400) / 260) * 0.06 * step; // balanço lateral
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.rot += p.vr * step;
      this.ctx.save();
      this.ctx.globalAlpha = fade;
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.fillStyle = p.color;
      if (p.round) {
        this.ctx.beginPath();
        this.ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        // "vira" o papel: a largura oscila para parecer girando no ar
        this.ctx.scale(Math.cos(p.rot * 3), 1);
        this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      this.ctx.restore();
    }
    if (t < DURATION_MS) requestAnimationFrame(this.tick);
    else {
      this.pieces = [];
      this.ctx.clearRect(0, 0, width, height);
      this.running = false;
    }
  };
}
