// "Fotos" das peças para a mão do jogador e o sorteio: a mesma peça 3D do tabuleiro, sob a mesma luz,
// renderizada uma vez num canvas fora da tela e guardada como imagem. Assim a mão casa visualmente
// com a mesa sem abrir um contexto WebGL por peça.

import * as THREE from "three";
import type { Values } from "@trimino/shared";
import { THICK, TileKit, addFlatLighting } from "./tileKit.ts";

const WIDTH = 200; // px da imagem (exibida a ~64 px; sobra resolução para telas densas)
const HEIGHT = 176; // proporção do triângulo visto de cima (1 : 0,87) mais a sombra
const DIST = 3.1; // distância da câmera; enquadra a peça de ponta a ponta

class TilePhotographer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(18, WIDTH / HEIGHT, 0.1, 50);
  private kit = new TileKit();
  private cache = new Map<string, string>();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    addFlatLighting(this.scene);

    // Vista de cima, com a ponta para cima. O centro do retângulo que envolve o triângulo
    // fica entre a ponta (z = -0,577) e a base (z = +0,289).
    const centerZ = -0.144;
    this.camera.position.set(0, DIST, centerZ + 0.001);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, THICK / 2, centerZ);
  }

  /** URL (data:) da foto da peça com os números `vals` em sentido horário a partir da ponta. */
  photo(vals: Values): string {
    const key = vals.join("-");
    let url = this.cache.get(key);
    if (url) return url;
    // Célula (0, 0) aponta para cima; centraliza no centroide.
    const tile = this.kit.build(0, 0, vals);
    tile.position.set(0, 0, 0);
    this.scene.add(tile);
    this.renderer.render(this.scene, this.camera);
    url = this.renderer.domElement.toDataURL("image/png");
    this.scene.remove(tile);
    this.cache.set(key, url);
    return url;
  }
}

let photographer: TilePhotographer | null = null;

/** Imagem da peça igual à do tabuleiro, ou null se WebGL não estiver disponível. */
export function tilePhoto(vals: Values): string | null {
  try {
    photographer ??= new TilePhotographer();
    return photographer.photo(vals);
  } catch {
    return null;
  }
}

// ---------------- dioramas da landing ----------------

export interface PlacedTile {
  r: number;
  c: number;
  vals: Values;
  /** Pedra em destaque (brilho dourado), como na comemoração do jogo. */
  glow?: boolean;
}

let diorama: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; kit: TileKit; glow: THREE.MeshStandardMaterial } | null = null;

/**
 * Foto (data:) de um pedaço de tabuleiro, levemente inclinado, com as mesmas peças e a mesma luz da mesa.
 * Fundo transparente; null se WebGL não estiver disponível.
 */
export function arrangementPhoto(tiles: PlacedTile[], width = 560, height = 400): string | null {
  try {
    if (!diorama) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      const sun = addFlatLighting(scene);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.radius = 4;
      sun.shadow.normalBias = 0.015;
      // Chão invisível que só recebe a sombra das pedras.
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
      floor.receiveShadow = true;
      scene.add(floor);
      const kit = new TileKit();
      const glow = kit.tileMat.clone();
      glow.emissive = new THREE.Color("#f2b33d");
      glow.emissiveIntensity = 0.28;
      diorama = { renderer, scene, kit, glow };
    }
    const { renderer, scene, kit, glow } = diorama;
    renderer.setSize(width, height, false);

    const group = new THREE.Group();
    const box = new THREE.Box3();
    for (const t of tiles) {
      const tile = kit.build(t.r, t.c, t.vals, t.glow ? glow : kit.tileMat);
      group.add(tile);
      box.expandByObject(tile);
    }
    const center = box.getCenter(new THREE.Vector3());
    group.position.set(-center.x, 0, -center.z);
    scene.add(group);

    // Enquadra pelo maior lado, com uma inclinação de 30° em relação à vista de cima.
    const size = box.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(22, width / height, 0.1, 100);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(size.z / (2 * Math.tan(fov / 2)), size.x / (2 * Math.tan(fov / 2) * camera.aspect)) * 1.06 + 0.6;
    const pitch = THREE.MathUtils.degToRad(60);
    camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    scene.remove(group);
    return url;
  } catch {
    return null;
  }
}
