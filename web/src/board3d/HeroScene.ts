// Cena 3D do topo da landing: uma partida de verdade montada sobre o feltro, com as mesmas peças
// do tabuleiro (TileKit). As pedras caem uma a uma, a última fecha a mandala, que acende em dourado.
// Depois a câmera fica girando devagar e acompanha o ponteiro.

import * as THREE from "three";
import type { Values } from "@trimino/shared";
import { feltTexture } from "./textures.ts";
import { ACCENT, GAP, THICK, TileKit, addFlatLighting, cellGeometry, roundedTriangle } from "./tileKit.ts";

/**
 * Partida armada para a cena: (linha, coluna, valores em sentido horário). Todas as pontas batem,
 * nenhuma pedra se repete e todas são pedras do jogo. As seis primeiras formam a mandala do vértice (1, 0).
 */
export const HERO_BOARD: [number, number, ...Values][] = [
  [-1, -1, 1, 3, 0], [-1, 0, 1, 2, 3], [-1, 1, 2, 2, 3], [0, -1, 0, 3, 0], [0, 0, 3, 3, 0], [0, 1, 3, 2, 3],
  [-2, 0, 2, 2, 1], [-2, 1, 2, 0, 2], [-2, 2, 0, 0, 2], [-1, -2, 0, 1, 0], [-2, -2, 1, 1, 0], [-3, 1, 4, 0, 2],
  [-1, -3, 0, 0, 5], [-3, 2, 4, 4, 0], [0, -3, 5, 0, 2], [-3, 3, 4, 5, 0], [1, 0, 0, 3, 5], [-2, -1, 1, 2, 1],
  [0, -4, 5, 2, 5], [-3, 4, 4, 5, 5], [-3, 0, 2, 4, 2], [0, -5, 1, 5, 5], [-4, 0, 4, 4, 2], [-4, 2, 5, 4, 4],
  [1, 1, 3, 3, 5], [1, 2, 3, 3, 3], [1, -4, 5, 2, 2], [-4, 3, 5, 1, 4], [0, -6, 1, 5, 1], [1, -3, 2, 2, 2],
];
const MANDALA = 6;
/** Pedras soltas pairando sobre a mesa: valores, posição e inclinação. */
const FLOATERS: { vals: Values; pos: [number, number, number]; tilt: [number, number] }[] = [
  { vals: [5, 5, 5], pos: [3.6, 1.1, -2.4], tilt: [0.35, -0.25] },
  { vals: [0, 4, 5], pos: [-3.2, 0.9, -2.2], tilt: [-0.3, 0.35] },
  { vals: [1, 1, 4], pos: [3.4, 1.3, 1.9], tilt: [0.3, 0.4] },
];

const DROP_MS = 620;
const STAGGER_MS = 70;
const BG = new THREE.Color("#0b241b");

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Queda com um quique curto no fim. */
function drop(t: number): number {
  if (t >= 1) return 0;
  if (t < 0.72) return 1 - easeOut(t / 0.72);
  const k = (t - 0.72) / 0.28;
  return Math.sin(k * Math.PI) * 0.06;
}

function thickRing(up: boolean): THREE.BufferGeometry {
  const shape = roundedTriangle(up, GAP / 2 + 0.035);
  shape.holes.push(new THREE.Path(roundedTriangle(up, GAP / 2 + 0.085).getPoints(6)));
  return new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2);
}

interface Dropping {
  group: THREE.Group;
  start: number;
  spin: number;
}

export class HeroScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private kit = new TileKit();
  private dropping: Dropping[] = [];
  private floaters: { group: THREE.Group; base: THREE.Vector3; phase: number; tilt: [number, number] }[] = [];
  private glowMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private center = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private look = new THREE.Vector2();
  private t0 = performance.now();
  private glowAt: number;
  private visible = true;
  private running = false;
  private still: boolean;
  private wide = true;

  constructor(private host: HTMLElement) {
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.className = "hero-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(this.renderer.domElement);

    // Mesa que some no escuro: a névoa leva o feltro até a cor da página.
    this.scene.background = BG;
    this.scene.fog = new THREE.Fog(BG, 9, 21);
    const sun = addFlatLighting(this.scene);
    sun.intensity = 1.5;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
    sun.shadow.camera.right = sun.shadow.camera.top = 8;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015;
    sun.shadow.radius = 4;
    // Luz quente rasante, só para o brilho da mesa de casa.
    const lamp = new THREE.PointLight("#ffc979", 14, 14, 1.6);
    lamp.position.set(1.5, 3.2, -1.2);
    this.scene.add(lamp);

    const felt = feltTexture();
    felt.repeat.set(30, 30);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: felt, bumpMap: felt, bumpScale: 0.25, color: "#a9bfb2", roughness: 1 }),
    );
    table.receiveShadow = true;
    this.scene.add(table);

    this.glowMat = this.kit.tileMat.clone();
    this.glowMat.emissive = ACCENT.clone();
    this.glowMat.emissiveIntensity = 0;
    this.ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
    const rings = { up: thickRing(true), down: thickRing(false) };

    // A mandala fecha por último: as outras pedras caem antes, do centro para fora.
    const order = [...HERO_BOARD.slice(MANDALA), ...HERO_BOARD.slice(0, MANDALA)];
    for (const [r, c] of HERO_BOARD) {
      const { center } = cellGeometry(r, c);
      this.center.add(new THREE.Vector3(center.x, 0, center.y));
    }
    this.center.divideScalar(HERO_BOARD.length);
    const mandalaCenter = new THREE.Vector2(0.5, 0); // vértice (1, 0)
    const fromMandala = ([r, c]: [number, number, ...number[]]) => cellGeometry(r, c).center.distanceTo(mandalaCenter);
    const rest = order.slice(0, -MANDALA).sort((a, b) => fromMandala(a) - fromMandala(b));
    [...rest, ...order.slice(-MANDALA)].forEach(([r, c, ...vals], i) => {
      const inMandala = i >= order.length - MANDALA;
      const group = this.kit.build(r, c, vals as Values, inMandala ? this.glowMat : this.kit.tileMat);
      if (inMandala) {
        const ring = new THREE.Mesh(((r + c) & 1) === 0 ? rings.up : rings.down, this.ringMat);
        ring.position.y = THICK + 0.003;
        ring.renderOrder = 3;
        group.add(ring);
      }
      this.scene.add(group);
      const extra = inMandala ? 260 : 0;
      this.dropping.push({ group, start: i * STAGGER_MS + extra, spin: (i % 2 ? 1 : -1) * (0.4 + (i % 5) * 0.12) });
    });
    this.glowAt = (order.length - 1) * STAGGER_MS + 260 + DROP_MS;

    for (const [i, f] of FLOATERS.entries()) {
      const group = this.kit.build(0, 0, f.vals);
      const base = new THREE.Vector3(...f.pos).add(this.center);
      group.position.copy(base);
      this.scene.add(group);
      this.floaters.push({ group, base, phase: i * 2.1, tilt: f.tilt });
    }

    if (this.still) this.t0 -= 60_000;

    addEventListener("pointermove", (e) => {
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    }, { passive: true });
    new ResizeObserver(() => this.resize()).observe(host);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.sync();
    }).observe(host);
    document.addEventListener("visibilitychange", () => this.sync());
    this.resize();
    this.sync();
  }

  /** Recomeça a queda das pedras (ao voltar para a landing). */
  replay(): void {
    if (!this.still) this.t0 = performance.now();
  }

  private sync(): void {
    const run = this.visible && !document.hidden;
    if (run === this.running) return;
    this.running = run;
    this.renderer.setAnimationLoop(run ? () => this.frame() : null);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.wide = w / h > 1.15 && w > 860;
    this.camera.aspect = w / h;
    // Em tela larga a mesa vai para a direita, deixando o texto sobre o feltro escuro.
    if (this.wide) this.camera.setViewOffset(w, h, -w * 0.25, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now() - this.t0;
    const sec = now / 1000;

    for (const d of this.dropping) {
      const t = Math.min(1, Math.max(0, (now - d.start) / DROP_MS));
      const h = drop(t);
      d.group.visible = now >= d.start;
      d.group.position.y = h * 2.6;
      d.group.rotation.y = h * d.spin;
      d.group.rotation.x = h * 0.35;
    }

    // Mandala: acende de uma vez e depois fica respirando.
    const g = (now - this.glowAt) / 1000;
    if (g > 0) {
      const flash = Math.exp(-g * 2.2);
      const breathe = 0.5 + 0.5 * Math.sin(g * 1.6);
      this.glowMat.emissiveIntensity = 0.06 + 0.32 * flash + 0.06 * breathe;
      this.ringMat.opacity = Math.min(1, g * 3) * (0.55 + 0.35 * breathe) + 0.1 * flash;
    } else {
      this.glowMat.emissiveIntensity = 0;
      this.ringMat.opacity = 0;
    }

    for (const f of this.floaters) {
      const k = this.still ? 0 : sec;
      const rise = easeOut(Math.min(1, Math.max(0, (now - 300 - f.phase * 150) / 1400)));
      f.group.position.set(f.base.x, f.base.y - (1 - rise) * 1.5 + Math.sin(k * 0.9 + f.phase) * 0.12, f.base.z);
      f.group.rotation.set(f.tilt[0] + Math.sin(k * 0.5 + f.phase) * 0.12, k * 0.25 + f.phase, f.tilt[1] + Math.cos(k * 0.6 + f.phase) * 0.1);
    }

    // Câmera em órbita lenta; o ponteiro inclina um pouco a vista.
    this.look.lerp(this.pointer, this.still ? 1 : 0.04);
    const az = (this.still ? 0.35 : 0.35 + Math.sin(sec * 0.07) * 0.32) + this.look.x * 0.12;
    const pitch = THREE.MathUtils.degToRad(this.wide ? 40 : 52) - this.look.y * 0.05;
    const dist = this.wide ? 11.5 : 11;
    const intro = this.still ? 0 : 1 - easeOut(Math.min(1, now / 2600));
    const d = dist + intro * 2.5;
    this.camera.position.set(
      this.center.x + Math.sin(az) * Math.cos(pitch) * d,
      Math.sin(pitch) * d,
      this.center.z + Math.cos(az) * Math.cos(pitch) * d,
    );
    this.camera.lookAt(this.center.x, 0, this.center.z + (this.wide ? 0 : 0.6));
    this.renderer.render(this.scene, this.camera);
  }
}
