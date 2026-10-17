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
