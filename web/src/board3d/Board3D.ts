// Tabuleiro 3D: mesa de feltro iluminada por um abajur, peças de resina com números gravados.
// Coordenadas: a grade 2D (x, y) de shared/geometry vira o plano (x, z) da cena, com aresta = 1.

import * as THREE from "three";
import { cellAt, cellKey, edgeNeighbors, isUp, type BoardCell } from "@trimino/shared";
import type { Board, Ghost } from "../board.ts";
import { feltTexture } from "./textures.ts";
import { ACCENT, GAP, TABLE_COLOR, THICK, TileKit, addFlatLighting, cellGeometry, roundedTriangle } from "./tileKit.ts";

const PITCH_3D = THREE.MathUtils.degToRad(52);
const PITCH_TOP = THREE.MathUtils.degToRad(89);
/** Até onde (na tela, de -1 a 1) o enquadramento automático deixa as pedras chegarem. */
const FIT_MARGIN = 0.94;
/** Giro da pedra posicionada: um terço de volta, rápido. */
const SPIN_MS = 280;
/** Sentido de um passo de giro (rot + 1) visto de cima. */
const SPIN_STEP = -(Math.PI * 2) / 3;

/** Contorno fino (anel triangular) e preenchimento de um encaixe livre, deitados na mesa. */
/** Anel triangular grosso, por cima da borda da peça, usado no destaque de ponte/mandala. */
function thickRing(up: boolean): THREE.BufferGeometry {
  const shape = roundedTriangle(up, GAP / 2 + 0.035);
  shape.holes.push(new THREE.Path(roundedTriangle(up, GAP / 2 + 0.085).getPoints(6)));
  return new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2);
}

function slotGeometries(up: boolean): { ring: THREE.BufferGeometry; fill: THREE.BufferGeometry } {
  const outer = roundedTriangle(up, GAP / 2 + 0.01);
  const inner = new THREE.Path(roundedTriangle(up, GAP / 2 + 0.035).getPoints(6));
  const ringShape = roundedTriangle(up, GAP / 2 + 0.01);
  ringShape.holes.push(inner);
  const ring = new THREE.ShapeGeometry(ringShape, 6).rotateX(-Math.PI / 2);
  const fill = new THREE.ShapeGeometry(outer, 6).rotateX(-Math.PI / 2);
  return { ring, fill };
}

interface TileEntry {
  group: THREE.Group;
  key: string;
  dropStart: number | null;
}

export class Board3D implements Board {
  onCellClick: (r: number, c: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private host: HTMLElement;

  // câmera: valores atuais seguem os desejados com amortecimento
  // Padrão: vista de cima; o botão alterna para a câmera inclinada.
  private cam = { target: new THREE.Vector2(0, 0), dist: 9, pitch: PITCH_TOP };
  private goal = { target: new THREE.Vector2(0, 0), dist: 9, pitch: PITCH_TOP };
  /** Último enquadramento automático; refeito quando a área muda de tamanho, se o jogador não mexeu na câmera. */
  private lastFit: { r: number; c: number }[] | null = null;
  private userMoved = false;
  private velocity = new THREE.Vector2();

  private sun: THREE.DirectionalLight;
  private tiles = new Map<string, TileEntry>();
  private ghostLayer = new THREE.Group();
  /** Destaque das pedras de uma ponte/mandala: contornos dourados + brilho, até `until`. */
  private highlight = { layer: new THREE.Group(), until: 0, bodies: [] as THREE.Mesh[] };
  private glowMat: THREE.MeshStandardMaterial;
  /** Contorno grosso do destaque (mais largo que o contorno dos encaixes livres). */
  private highlightRing = { up: thickRing(true), down: thickRing(false) };
  private ghostCells = new Map<string, Ghost>();
  /** Pedra posicionada da renderização anterior, para animar quando só o giro muda. */
  private lastPreview: { key: string; tile?: number; rot?: number } | null = null;
  /** Giro em andamento: a pedra começa `from` radianos atrás e volta a 0. */
  private spin = { start: 0, from: 0 };
  /** Materiais da pedra que outro jogador está posicionando, um por cor. */
  private ownerMats = new Map<string, THREE.MeshStandardMaterial>();
  private hoverKey: string | null = null;
  private renderedOnce = false;

  private kit = new TileKit();
  private slotGeo = { up: slotGeometries(true), down: slotGeometries(false) };
  private boardCenter = new THREE.Vector2();
  private boardRadius = 1;

  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private lastMoveTime = 0;
  private clock = new THREE.Clock();

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.className = "board board3d";
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(TABLE_COLOR);
    this.sun = addFlatLighting(this.scene);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.sun.shadow.radius = 3;

    const felt = feltTexture();
    felt.repeat.set(40, 40);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: felt, bumpMap: felt, bumpScale: 0.25, color: "#b7c9be", roughness: 1 }),
    );
    table.receiveShadow = true;
    this.scene.add(table);

    // Última jogada: contorno fino na cor de quem jogou (sem brilho).
    this.scene.add(this.ghostLayer, this.highlight.layer);
    this.glowMat = this.kit.tileMat.clone();
    this.glowMat.emissive = new THREE.Color("#f2b33d");

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- API usada pelo main.ts ----------------

  render(board: BoardCell[], _colorOf: (playerId: string) => string, ghosts: Ghost[]): void {
    const now = performance.now();
    const wanted = new Set(board.map((b) => cellKey(b.r, b.c)));
    for (const [k, t] of this.tiles)
      if (!wanted.has(k)) {
        this.scene.remove(t.group);
        this.tiles.delete(k);
      }
    for (const cell of board) {
      const k = cellKey(cell.r, cell.c);
      if (this.tiles.has(k)) continue;
      const group = this.kit.build(cell.r, cell.c, cell.vals);
      this.scene.add(group);
      // Só anima o que chegou depois da primeira renderização (não ao entrar numa partida em andamento).
      this.tiles.set(k, { group, key: k, dropStart: this.renderedOnce && board.length > 1 ? now : null });
    }
    this.renderedOnce = true;
    // Peça nova ou espaço vizinho fora da vista (e ninguém arrastando a mesa): reenquadra suavemente.
    // Usa os vizinhos de todas as peças, e não só os encaixes visíveis, para a câmera não pular
    // quando o jogador seleciona uma peça.
    const frame = [...board, ...board.flatMap((b) => edgeNeighbors(b.r, b.c).map(([r, c]) => ({ r, c })))];
    if (board.length && !this.pointers.size && !this.allVisible(frame)) this.fit(board);
    if (board.length) {
      const pts = board.flatMap((b) => cellGeometry(b.r, b.c).pts);
      const box = new THREE.Box2().setFromPoints(pts);
      box.getCenter(this.boardCenter);
      this.boardRadius = box.getSize(new THREE.Vector2()).length() / 2;
    } else {
      this.boardCenter.set(0, 0);
      this.boardRadius = 1;
    }

    this.ghostLayer.clear();
    this.ghostCells.clear();
    let previewed: typeof this.lastPreview = null;
    for (const g of ghosts) {
      const k = cellKey(g.r, g.c);
      // a pedra de outro jogador só aparece; não dá para tocar nela
      if (!g.owner) this.ghostCells.set(k, g);
      const color = g.owner ? new THREE.Color(g.owner) : ACCENT;
      const { center } = cellGeometry(g.r, g.c);
      // Encaixe livre: contorno dourado fino + preenchimento quase invisível (sem dica de encaixe).
      const geos = isUp(g.r, g.c) ? this.slotGeo.up : this.slotGeo.down;
      const fill = new THREE.Mesh(geos.fill, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      const ring = new THREE.Mesh(geos.ring, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      for (const m of [fill, ring]) m.position.set(center.x, 0.003, center.y);
      fill.userData = { key: k, slotFill: true, owned: !!g.owner };
      ring.userData = { key: k, slotRing: true, active: !!g.vals, owned: !!g.owner };
      this.ghostLayer.add(fill, ring);
      if (g.vals) {
        const preview = this.kit.build(g.r, g.c, g.vals, g.owner ? this.ownerMat(g.owner) : this.kit.previewMat);
        preview.userData = { preview: true };
        if (g.owner) {
          // contorno grosso na cor do jogador, em cima da pedra (flutua e gira com ela)
          const halo = new THREE.Mesh(isUp(g.r, g.c) ? this.highlightRing.up : this.highlightRing.down, new THREE.MeshBasicMaterial({ color, transparent: true }));
          halo.position.y = THICK + 0.006;
          halo.userData = { halo: true };
          preview.add(halo);
        }
        this.ghostLayer.add(preview);
        // mesma pedra, mesma célula, outro giro: ela gira até a posição nova
        const prev = this.lastPreview;
        if (prev && prev.key === k && prev.tile === g.tile && prev.rot !== undefined && g.rot !== undefined && prev.rot !== g.rot) {
          const steps = (g.rot - prev.rot + 3) % 3;
          this.spin = { start: now, from: this.spinOffset(now) + (steps === 1 ? -SPIN_STEP : SPIN_STEP) };
        }
        previewed = { key: k, tile: g.tile, rot: g.rot };
      }
    }
    if (!previewed || previewed.key !== this.lastPreview?.key || previewed.tile !== this.lastPreview?.tile) this.spin.from = 0;
    this.lastPreview = previewed;
  }

  private ownerMat(color: string): THREE.MeshStandardMaterial {
    let mat = this.ownerMats.get(color);
    if (!mat) {
      mat = this.kit.tileMat.clone();
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 0.16;
      this.ownerMats.set(color, mat);
    }
    return mat;
  }

  /** Quanto falta girar (radianos) para a pedra posicionada chegar ao giro atual. */
  private spinOffset(t: number): number {
    const p = Math.min(1, (t - this.spin.start) / SPIN_MS);
    return this.spin.from * Math.pow(1 - p, 3);
  }

  /** Enquadra as peças e os espaços vizinhos a elas (onde a próxima peça pode ir). */
  /**
   * Enquadra o jogo o mais perto possível: todas as pedras inteiras e pelo menos metade de cada espaço livre
   * em volta (o centro, para dar para tocar). A distância é achada projetando os pontos na câmera de destino.
   */
  fit(board: { r: number; c: number }[]): void {
    const cells = board.length ? board : [{ r: 0, c: 0 }];
    const pts = [
      ...cells.flatMap((b) => cellGeometry(b.r, b.c).pts),
      ...cells.flatMap((b) => edgeNeighbors(b.r, b.c).map(([r, c]) => cellGeometry(r, c).center)),
    ];
    new THREE.Box2().setFromPoints(pts).getCenter(this.goal.target);
    // Com a câmera inclinada, o centro do retângulo não cai no meio da tela: recentraliza pela projeção.
    for (let pass = 0; pass < 3; pass++) {
      let lo = 2, hi = 80;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (this.projectedBounds(pts, mid).fits) hi = mid;
        else lo = mid;
      }
      this.goal.dist = hi;
      const b = this.projectedBounds(pts, hi);
      // desloca o alvo (no plano da mesa) para equilibrar as margens da tela
      const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.goal.target.x += ((b.minX + b.maxX) / 2) * hi * tan * this.camera.aspect;
      this.goal.target.y -= (((b.minY + b.maxY) / 2) * hi * tan) / Math.sin(this.goal.pitch);
    }
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist, 3, 60);
    this.velocity.set(0, 0);
    this.lastFit = board;
    this.userMoved = false;
  }

  /** Limites dos pontos na tela (coordenadas -1..1) vistos da câmera de destino a uma distância `dist`. */
  private projectedBounds(pts: THREE.Vector2[], dist = this.goal.dist) {
    const cam = this.camera.clone();
    const { target, pitch } = this.goal;
    cam.position.set(target.x, Math.sin(pitch) * dist, target.y + Math.cos(pitch) * dist);
    cam.lookAt(target.x, 0, target.y);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      v.set(p.x, THICK, p.y).project(cam);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { minX, maxX, minY, maxY, fits: minX > -FIT_MARGIN && maxX < FIT_MARGIN && minY > -FIT_MARGIN && maxY < FIT_MARGIN };
  }

  /** Posição na tela (px, relativa à janela) do centro de uma célula. Usado nos testes de ponta a ponta. */
  cellToScreen(r: number, c: number): { x: number; y: number } {
    const { center } = cellGeometry(r, c);
    const v = new THREE.Vector3(center.x, THICK, center.y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Todas as peças cabem na tela, considerando a câmera de destino? */
  private allVisible(board: { r: number; c: number }[]): boolean {
    return this.projectedBounds(board.flatMap((b) => cellGeometry(b.r, b.c).pts)).fits;
  }

  /**
   * Destaca as pedras de uma ponte/mandala por `ms` milissegundos.
   * Devolve o centro da formação na tela, para a comemoração sair dali.
   */
  celebrate(cells: { r: number; c: number }[], ms = 3200): { x: number; y: number } | null {
    this.clearHighlight();
    const h = this.highlight;
    const sum = new THREE.Vector2();
    for (const { r, c } of cells) {
      const tile = this.tiles.get(cellKey(r, c));
      if (!tile) continue;
      const body = tile.group.children[0] as THREE.Mesh;
      body.material = this.glowMat;
      h.bodies.push(body);
      const { center } = cellGeometry(r, c);
      sum.add(center);
      const ring = new THREE.Mesh(isUp(r, c) ? this.highlightRing.up : this.highlightRing.down, new THREE.MeshBasicMaterial({ color: "#ffc531", transparent: true }));
      ring.position.set(center.x, THICK + 0.006, center.y);
      h.layer.add(ring);
    }
    if (!h.bodies.length) return null;
    h.until = performance.now() + ms;
    sum.divideScalar(h.bodies.length);
    const v = new THREE.Vector3(sum.x, THICK, sum.y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private clearHighlight(): void {
    const h = this.highlight;
    for (const body of h.bodies) body.material = this.kit.tileMat;
    h.bodies = [];
    h.layer.clear();
    h.until = 0;
  }

  toggleView(): boolean {
    const top = this.goal.pitch < PITCH_TOP - 0.01;
    this.goal.pitch = top ? PITCH_TOP : PITCH_3D;
    // a distância ideal muda com o ângulo; reenquadra se o jogador não tinha mexido na câmera
    if (this.lastFit && !this.userMoved) this.fit(this.lastFit);
    return top;
  }

  // ---------------- loop ----------------

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = performance.now();

    // inércia do arrasto
    if (!this.pointers.size && this.velocity.lengthSq() > 1e-6) {
      this.goal.target.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(Math.exp(-dt * 5));
    }
    const k = 1 - Math.exp(-dt * 9);
    this.cam.target.lerp(this.goal.target, k);
    this.cam.dist += (this.goal.dist - this.cam.dist) * k;
    this.cam.pitch += (this.goal.pitch - this.cam.pitch) * k;

    const { target, dist, pitch } = this.cam;
    this.camera.position.set(target.x, Math.sin(pitch) * dist, target.y + Math.cos(pitch) * dist);
    this.camera.lookAt(target.x, 0, target.y);

    // A luz direcional acompanha o jogo para a sombra cobrir todas as peças.
    const reach = this.boardRadius + 3;
    this.sun.position.set(this.boardCenter.x - 2, 10, this.boardCenter.y + 3);
    this.sun.target.position.set(this.boardCenter.x, 0, this.boardCenter.y);
    const sc = this.sun.shadow.camera;
    if (sc.right !== reach) {
      sc.left = sc.bottom = -reach;
      sc.right = sc.top = reach;
      sc.near = 1;
      sc.far = 25;
      sc.updateProjectionMatrix();
    }

    // queda das peças recém-jogadas
    for (const tile of this.tiles.values()) {
      if (tile.dropStart === null) continue;
      const p = Math.min(1, (t - tile.dropStart) / 520);
      const fall = 1 - Math.pow(1 - Math.min(1, p / 0.75), 3);
      tile.group.position.y = (1 - fall) * 1.4;
      const squash = p > 0.75 ? Math.sin(((p - 0.75) / 0.25) * Math.PI) * 0.12 : 0;
      tile.group.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
      if (p >= 1) {
        tile.group.position.y = 0;
        tile.group.scale.set(1, 1, 1);
        tile.dropStart = null;
      }
    }

    // destaque de ponte/mandala: brilho pulsando e sumindo no fim
    if (this.highlight.until) {
      const left = this.highlight.until - t;
      if (left <= 0) this.clearHighlight();
      else {
        const fadeOut = Math.min(1, left / 600);
        const beat = 0.5 + 0.5 * Math.sin(t / 140);
        this.glowMat.emissiveIntensity = (0.35 + beat * 0.45) * fadeOut;
        for (const ring of this.highlight.layer.children)
          ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (0.6 + beat * 0.4) * fadeOut;
      }
    }

    // encaixes pulsando; o que está sob o cursor brilha mais
    const pulse = 0.5 + Math.sin(t / 420) * 0.5;
    for (const obj of this.ghostLayer.children) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const hovered = obj.userData.key === this.hoverKey;
      if (obj.userData.slotFill) mat.opacity = obj.userData.owned ? 0.12 + pulse * 0.12 : hovered ? 0.22 : 0.04 + pulse * 0.04;
      else if (obj.userData.slotRing) mat.opacity = obj.userData.owned ? 0.7 + pulse * 0.3 : obj.userData.active || hovered ? 1 : 0.35 + pulse * 0.25;
      else if (obj.userData.preview) {
        obj.position.y = 0.06 + Math.sin(t / 300) * 0.025;
        obj.rotation.y = this.spinOffset(t);
        for (const child of obj.children)
          if (child.userData.halo) ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.65 + pulse * 0.35;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lastFit && !this.userMoved) this.fit(this.lastFit);
  }

  // ---------------- entrada ----------------

  /** Ponto da mesa (x, z) sob a posição de tela. */
  private groundAt(x: number, y: number): THREE.Vector2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    return hit ? new THREE.Vector2(hit.x, hit.z) : null;
  }

  private ghostAt(x: number, y: number): Ghost | null {
    const p = this.groundAt(x, y);
    if (!p) return null;
    const [r, c] = cellAt(p.x, p.y, 1);
    return this.ghostCells.get(cellKey(r, c)) ?? null;
  }

  /** Move o alvo da câmera para que o ponto da mesa sob `from` fique sob `to`. */
  private panBetween(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const a = this.groundAt(from.x, from.y);
    const b = this.groundAt(to.x, to.y);
    if (!a || !b) return;
    const d = a.sub(b);
    this.userMoved = true;
    this.cam.target.add(d);
    this.goal.target.add(d);
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime) / 1000;
    this.velocity.lerp(d.divideScalar(dt), 0.5);
    this.lastMoveTime = now;
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const before = this.goal.dist;
    this.userMoved = true;
    this.goal.dist = THREE.MathUtils.clamp(before * factor, 3, 60);
    const p = this.groundAt(x, y);
    if (p) this.goal.target.lerp(p, 1 - this.goal.dist / before);
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0012));
    }, { passive: false });

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = false;
      this.velocity.set(0, 0);
      this.lastMoveTime = performance.now();
    });

    el.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      if (!prev) {
        const g = this.ghostAt(cur.x, cur.y);
        this.hoverKey = g ? cellKey(g.r, g.c) : null;
        el.style.cursor = g ? "pointer" : "grab";
        return;
      }
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
        if (d0 > 0) {
          this.zoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d0 / d1);
          this.cam.dist = this.goal.dist;
        }
        this.dragged = true;
      } else {
        if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 3) this.dragged = true;
        if (!this.dragged) return;
        el.style.cursor = "grabbing";
        this.panBetween(prev, cur);
      }
      this.pointers.set(e.pointerId, cur);
    });

    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      el.style.cursor = "grab";
      if (performance.now() - this.lastMoveTime > 80) this.velocity.set(0, 0);
      if (!this.dragged && e.type === "pointerup") {
        const g = this.ghostAt(e.clientX, e.clientY);
        if (g) this.onCellClick(g.r, g.c);
      }
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
}

let webgl: boolean | undefined;
export function webglAvailable(): boolean {
  if (webgl === undefined)
    try {
      webgl = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl = false;
    }
  return webgl;
}
