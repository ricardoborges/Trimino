// Tabuleiro 3D: mesa de feltro iluminada por um abajur, peças de resina com números gravados.
// Coordenadas: a grade 2D (x, y) de shared/geometry vira o plano (x, z) da cena, com aresta = 1.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cellAt, cellKey, cellVertices, isUp, vertexToPixel, type BoardCell, type Values } from "@trimino/shared";
import type { Board, Ghost } from "../board.ts";
import { digitTexture, feltTexture, glowTexture, ivoryTexture } from "./textures.ts";

const H = Math.sqrt(3) / 2;
const THICK = 0.12; // espessura total da peça
const BEVEL = 0.03;
const GAP = 0.03; // sulco entre peças vizinhas
const CORNER = 0.07; // raio dos cantos arredondados
const DIGIT_SIZE = 0.28;
const DIGIT_PULL = 0.43; // quanto o número é puxado do canto para o centro
const ACCENT = new THREE.Color("#f2b33d");

const PITCH_3D = THREE.MathUtils.degToRad(52);
const PITCH_TOP = THREE.MathUtils.degToRad(89);

type Corners = [THREE.Vector2, THREE.Vector2, THREE.Vector2];

/** Cantos da célula no plano (x, z) e o centroide. */
function cellGeometry(r: number, c: number): { pts: Corners; center: THREE.Vector2 } {
  const pts = cellVertices(r, c).map((v) => new THREE.Vector2(...vertexToPixel(v, 1))) as Corners;
  const center = new THREE.Vector2().add(pts[0]).add(pts[1]).add(pts[2]).divideScalar(3);
  return { pts, center };
}

/** Triângulo de cantos arredondados, centrado no centroide, encolhido por `inset` em cada aresta. */
function roundedTriangle(up: boolean, inset: number): THREE.Shape {
  const s = 1 - 2 * Math.sqrt(3) * inset;
  const raw = up
    ? [[0, (-2 * H) / 3], [0.5, H / 3], [-0.5, H / 3]]
    : [[0, (2 * H) / 3], [-0.5, -H / 3], [0.5, -H / 3]];
  // No Shape, y = -z para que rotateX(-90°) leve o desenho ao plano da mesa.
  const p = raw.map(([x, z]) => new THREE.Vector2(x * s, -z * s));
  const shape = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const prev = p[(i + 2) % 3];
    const cur = p[i];
    const next = p[(i + 1) % 3];
    const a = cur.clone().add(prev.clone().sub(cur).setLength(CORNER));
    const b = cur.clone().add(next.clone().sub(cur).setLength(CORNER));
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

/** Contorno fino (anel triangular) e preenchimento de um encaixe livre, deitados na mesa. */
function slotGeometries(up: boolean): { ring: THREE.BufferGeometry; fill: THREE.BufferGeometry } {
  const outer = roundedTriangle(up, GAP / 2 + 0.01);
  const inner = new THREE.Path(roundedTriangle(up, GAP / 2 + 0.035).getPoints(6));
  const ringShape = roundedTriangle(up, GAP / 2 + 0.01);
  ringShape.holes.push(inner);
  const ring = new THREE.ShapeGeometry(ringShape, 6).rotateX(-Math.PI / 2);
  const fill = new THREE.ShapeGeometry(outer, 6).rotateX(-Math.PI / 2);
  return { ring, fill };
}

function tileGeometry(up: boolean): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(roundedTriangle(up, GAP / 2 + BEVEL), {
    depth: THICK - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 4,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, BEVEL, 0);
  return geo;
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
  private cam = { target: new THREE.Vector2(0, 0), dist: 9, pitch: PITCH_3D };
  private goal = { target: new THREE.Vector2(0, 0), dist: 9, pitch: PITCH_3D };
  private velocity = new THREE.Vector2();

  private lamp: THREE.SpotLight;
  private tiles = new Map<string, TileEntry>();
  private ghostLayer = new THREE.Group();
  private lastGlow: THREE.Mesh;
  private ghostCells = new Map<string, Ghost>();
  private hoverKey: string | null = null;
  private renderedOnce = false;

  private geo = { up: tileGeometry(true), down: tileGeometry(false) };
  private digitGeo = new THREE.PlaneGeometry(DIGIT_SIZE, DIGIT_SIZE).rotateX(-Math.PI / 2);
  private glowGeo = new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2);
  private slotGeo = { up: slotGeometries(true), down: slotGeometries(false) };
  private boardCenter = new THREE.Vector2();
  private boardRadius = 1;
  private gemGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.008, 24);
  private tileMat: THREE.MeshPhysicalMaterial;
  private previewMat: THREE.MeshPhysicalMaterial;
  private digitMats: THREE.MeshStandardMaterial[];
  private glowTex = glowTexture();
  private gemMats = new Map<string, THREE.MeshPhysicalMaterial>();

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
    const vignette = document.createElement("div");
    vignette.className = "vignette";
    host.append(vignette);

    // Sala escura; a mesa some na penumbra fora do cone do abajur.
    const bg = new THREE.Color("#0a1712");
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.045);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    this.lamp = new THREE.SpotLight("#ffeccc", 4.2, 0, 0.5, 0.75, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.015;
    this.lamp.shadow.camera.near = 4;
    this.lamp.shadow.camera.far = 40;
    this.scene.add(this.lamp, this.lamp.target);
    const fill = new THREE.DirectionalLight("#9fc4ff", 0.18);
    fill.position.set(6, 5, 8);
    this.scene.add(fill, new THREE.HemisphereLight("#fff6e5", "#0b2219", 0.12));

    const felt = feltTexture();
    felt.repeat.set(40, 40);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        map: felt,
        bumpMap: felt,
        bumpScale: 0.6,
        color: "#c9d8cf",
        roughness: 0.95,
        sheen: 1,
        sheenColor: new THREE.Color("#3f8a6a"),
        sheenRoughness: 0.6,
      }),
    );
    table.receiveShadow = true;
    this.scene.add(table);

    const ivory = ivoryTexture();
    ivory.repeat.set(1.3, 1.3);
    this.tileMat = new THREE.MeshPhysicalMaterial({
      map: ivory,
      color: "#ffffff",
      roughness: 0.3,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      sheen: 0.25,
      sheenColor: new THREE.Color("#fff3d6"),
    });
    this.previewMat = this.tileMat.clone();
    this.previewMat.emissive = ACCENT.clone();
    this.previewMat.emissiveIntensity = 0.07;

    this.digitMats = [0, 1, 2, 3, 4, 5].map(
      (n) =>
        new THREE.MeshStandardMaterial({
          map: digitTexture(n),
          transparent: true,
          roughness: 0.5,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
    );

    this.lastGlow = new THREE.Mesh(
      this.glowGeo,
      new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
    );
    this.lastGlow.position.y = 0.002;
    this.lastGlow.visible = false;
    this.scene.add(this.lastGlow, this.ghostLayer);

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- API usada pelo main.ts ----------------

  render(board: BoardCell[], colorOf: (playerId: string) => string, ghosts: Ghost[], lastTile: string | null): void {
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
      const group = this.buildTile(cell.r, cell.c, cell.vals, this.tileMat, colorOf(cell.by));
      this.scene.add(group);
      // Só anima o que chegou depois da primeira renderização (não ao entrar numa partida em andamento).
      this.tiles.set(k, { group, key: k, dropStart: this.renderedOnce && board.length > 1 ? now : null });
    }
    this.renderedOnce = true;
    // Peça nova fora da vista (e ninguém arrastando a mesa): reenquadra suavemente.
    if (board.length && !this.pointers.size && !this.allVisible(board)) this.fit(board);
    if (board.length) {
      const pts = board.flatMap((b) => cellGeometry(b.r, b.c).pts);
      const box = new THREE.Box2().setFromPoints(pts);
      box.getCenter(this.boardCenter);
      this.boardRadius = box.getSize(new THREE.Vector2()).length() / 2;
    } else {
      this.boardCenter.set(0, 0);
      this.boardRadius = 1;
    }

    const last = lastTile ? board.find((b) => cellKey(b.r, b.c) === lastTile) : undefined;
    this.lastGlow.visible = !!last;
    if (last) {
      const { center } = cellGeometry(last.r, last.c);
      this.lastGlow.position.set(center.x, 0.002, center.y);
      this.lastGlow.rotation.y = isUp(last.r, last.c) ? 0 : Math.PI;
      (this.lastGlow.material as THREE.MeshBasicMaterial).color.set(colorOf(last.by));
    }

    this.ghostLayer.clear();
    this.ghostCells.clear();
    for (const g of ghosts) {
      const k = cellKey(g.r, g.c);
      this.ghostCells.set(k, g);
      const { center } = cellGeometry(g.r, g.c);
      // Encaixe livre: contorno dourado fino + preenchimento quase invisível (sem dica de encaixe).
      const geos = isUp(g.r, g.c) ? this.slotGeo.up : this.slotGeo.down;
      const fill = new THREE.Mesh(geos.fill, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, depthWrite: false }));
      const ring = new THREE.Mesh(geos.ring, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, depthWrite: false }));
      for (const m of [fill, ring]) m.position.set(center.x, 0.003, center.y);
      fill.userData = { key: k, slotFill: true };
      ring.userData = { key: k, slotRing: true, active: !!g.vals };
      this.ghostLayer.add(fill, ring);
      if (g.vals) {
        const preview = this.buildTile(g.r, g.c, g.vals, this.previewMat, null);
        preview.userData = { preview: true };
        this.ghostLayer.add(preview);
      }
    }
  }

  fit(board: { r: number; c: number }[]): void {
    const pts = (board.length ? board : [{ r: 0, c: 0 }]).flatMap((b) => cellGeometry(b.r, b.c).pts);
    const box = new THREE.Box2().setFromPoints(pts).expandByScalar(1.2);
    const size = box.getSize(new THREE.Vector2());
    box.getCenter(this.goal.target);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const byWidth = size.x / 2 / (tan * this.camera.aspect);
    const byDepth = (size.y / 2 / tan) * (1.15 + Math.cos(this.goal.pitch));
    this.goal.dist = THREE.MathUtils.clamp(Math.max(byWidth, byDepth, 5), 4, 60);
    this.velocity.set(0, 0);
  }

  /** Posição na tela (px, relativa à janela) do centro de uma célula. Usado nos testes de ponta a ponta. */
  cellToScreen(r: number, c: number): { x: number; y: number } {
    const { center } = cellGeometry(r, c);
    const v = new THREE.Vector3(center.x, THICK, center.y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Todas as peças cabem na tela com margem, considerando a câmera de destino? */
  private allVisible(board: { r: number; c: number }[]): boolean {
    const cam = this.camera.clone();
    const { target, dist, pitch } = this.goal;
    cam.position.set(target.x, Math.sin(pitch) * dist, target.y + Math.cos(pitch) * dist);
    cam.lookAt(target.x, 0, target.y);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    return board.every((b) =>
      cellGeometry(b.r, b.c).pts.every((p) => {
        v.set(p.x, THICK, p.y).project(cam);
        return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85;
      }),
    );
  }

  toggleView(): boolean {
    const top = this.goal.pitch < PITCH_TOP - 0.01;
    this.goal.pitch = top ? PITCH_TOP : PITCH_3D;
    return top;
  }

  // ---------------- construção ----------------

  private buildTile(r: number, c: number, vals: Values, mat: THREE.Material, owner: string | null): THREE.Group {
    const up = isUp(r, c);
    const { pts, center } = cellGeometry(r, c);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.y);

    const body = new THREE.Mesh(up ? this.geo.up : this.geo.down, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    pts.forEach((p, i) => {
      const local = p.clone().sub(center);
      const pos = local.clone().multiplyScalar(1 - DIGIT_PULL);
      const digit = new THREE.Mesh(this.digitGeo, this.digitMats[vals[i]]);
      digit.position.set(pos.x, THICK + 0.0015, pos.y);
      // O "alto" do número aponta para o seu canto, como nas peças reais.
      digit.rotation.y = Math.atan2(-local.x, -local.y);
      digit.renderOrder = 1;
      group.add(digit);
    });

    if (owner) {
      const gem = new THREE.Mesh(this.gemGeo, this.gemMaterial(owner));
      gem.position.y = THICK + 0.002;
      group.add(gem);
    }
    return group;
  }

  private gemMaterial(color: string): THREE.MeshPhysicalMaterial {
    let m = this.gemMats.get(color);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
      this.gemMats.set(color, m);
    }
    return m;
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

    // Abajur sobre o jogo: o cone cobre as peças e a mesa escurece em volta.
    const lampH = 13;
    const pool = Math.max(this.boardRadius + 2.6, 3.6);
    this.lamp.position.set(this.boardCenter.x - 2, lampH, this.boardCenter.y + 2.5);
    this.lamp.target.position.set(this.boardCenter.x, 0, this.boardCenter.y);
    this.lamp.angle = THREE.MathUtils.clamp(Math.atan(pool / lampH), 0.2, 1.1);

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

    // encaixes pulsando; o que está sob o cursor brilha mais
    const pulse = 0.5 + Math.sin(t / 420) * 0.5;
    for (const obj of this.ghostLayer.children) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const hovered = obj.userData.key === this.hoverKey;
      if (obj.userData.slotFill) mat.opacity = hovered ? 0.22 : 0.04 + pulse * 0.04;
      else if (obj.userData.slotRing) mat.opacity = obj.userData.active || hovered ? 1 : 0.35 + pulse * 0.25;
      else if (obj.userData.preview) {
        obj.position.y = 0.06 + Math.sin(t / 300) * 0.025;
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
    this.cam.target.add(d);
    this.goal.target.add(d);
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime) / 1000;
    this.velocity.lerp(d.divideScalar(dt), 0.5);
    this.lastMoveTime = now;
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const before = this.goal.dist;
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

export function webglAvailable(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}
