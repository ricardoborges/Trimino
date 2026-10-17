import { cellVertices, vertexToPixel, type BoardCell, type Values } from "@trimino/shared";

const SVG = "http://www.w3.org/2000/svg";
export const EDGE = 64;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

function corners(r: number, c: number): [number, number][] {
  return cellVertices(r, c).map((v) => vertexToPixel(v, EDGE));
}

/** Desenha um triângulo com os números puxados para dentro, perto de cada canto. */
export function tileShape(pts: [number, number][], vals: Values, cls: string, color?: string): SVGGElement {
  const g = el("g", { class: cls });
  const poly = el("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "tile-face" });
  if (color) poly.style.setProperty("--owner", color);
  g.append(poly);
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
  pts.forEach(([x, y], i) => {
    const t = el("text", { x: x + (cx - x) * 0.42, y: y + (cy - y) * 0.42, class: "tile-num" });
    t.textContent = String(vals[i]);
    g.append(t);
  });
  return g;
}

/** Peça "solta" (mão do jogador), sempre com a ponta para cima. */
export function handTileSvg(vals: Values): SVGSVGElement {
  const svg = el("svg", { viewBox: `-2 -2 ${EDGE + 4} ${EDGE * 0.866 + 4}`, class: "hand-svg" });
  svg.append(tileShape([[EDGE / 2, 0], [EDGE, EDGE * 0.866], [0, EDGE * 0.866]], vals, "tile"));
  return svg;
}

/** Implementado pelo tabuleiro 2D (SVG, fallback) e pelo 3D (WebGL). */
export interface Board {
  onCellClick: (r: number, c: number) => void;
  render(board: BoardCell[], colorOf: (playerId: string) => string, ghosts: Ghost[], lastTile: string | null): void;
  fit(board: { r: number; c: number }[]): void;
  /** Alterna câmera inclinada / vista de cima; devolve true se ficou de cima. */
  toggleView?(): boolean;
}

export interface Ghost {
  r: number;
  c: number;
  vals: Values | null; // null = apenas destaca a célula
  active: boolean;
}

export class BoardView implements Board {
  readonly svg: SVGSVGElement;
  private world: SVGGElement;
  private cam = { x: 0, y: 0, k: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  onCellClick: (r: number, c: number) => void = () => {};

  constructor(host: HTMLElement) {
    this.svg = el("svg", { class: "board" });
    this.world = el("g");
    this.svg.append(this.world);
    host.append(this.svg);
    this.bindGestures();
    new ResizeObserver(() => this.apply()).observe(this.svg);
  }

  render(board: BoardCell[], colorOf: (playerId: string) => string, ghosts: Ghost[], lastTile: string | null): void {
    this.world.replaceChildren();
    for (const cell of board) {
      const g = tileShape(corners(cell.r, cell.c), cell.vals, `tile${lastTile === `${cell.r},${cell.c}` ? " last" : ""}`, colorOf(cell.by));
      this.world.append(g);
    }
    for (const gh of ghosts) {
      const pts = corners(gh.r, gh.c);
      const g = gh.vals ? tileShape(pts, gh.vals, `ghost preview${gh.active ? " active" : ""}`) : el("g", { class: "ghost" });
      if (!gh.vals) g.append(el("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "ghost-face" }));
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.dragged) this.onCellClick(gh.r, gh.c);
      });
      this.world.append(g);
    }
  }

  /** Enquadra todas as peças (ou a origem, com o tabuleiro vazio). */
  fit(board: { r: number; c: number }[]): void {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width) return;
    const pts = (board.length ? board : [{ r: 0, c: 0 }]).flatMap((b) => corners(b.r, b.c));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = EDGE * 2;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    this.cam.k = Math.min(1.6, rect.width / w, rect.height / h);
    this.cam.x = rect.width / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * this.cam.k;
    this.cam.y = rect.height / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * this.cam.k;
    this.apply();
  }

  private apply(): void {
    this.world.setAttribute("transform", `translate(${this.cam.x} ${this.cam.y}) scale(${this.cam.k})`);
  }

  private zoomAt(px: number, py: number, factor: number): void {
    const k = Math.min(3, Math.max(0.25, this.cam.k * factor));
    const f = k / this.cam.k;
    this.cam.x = px - (px - this.cam.x) * f;
    this.cam.y = py - (py - this.cam.y) * f;
    this.cam.k = k;
    this.apply();
  }

  private bindGestures(): void {
    const s = this.svg;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = s.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    s.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, local(e));
      this.dragged = false;
    });
    s.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = local(e);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const other = a === prev ? b : a;
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
        if (d0 > 0) this.zoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d1 / d0);
        this.dragged = true;
      } else {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragged = true;
        if (this.dragged) {
          if (!s.hasPointerCapture(e.pointerId)) s.setPointerCapture(e.pointerId);
          this.cam.x += dx;
          this.cam.y += dy;
          this.apply();
        }
      }
      this.pointers.set(e.pointerId, cur);
    });
    const up = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    s.addEventListener("pointerup", up);
    s.addEventListener("pointercancel", up);
  }
}
