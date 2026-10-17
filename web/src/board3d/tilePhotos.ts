// "Fotos" das peças para a mão do jogador e o sorteio: a mesma peça 3D do tabuleiro, sob a mesma luz,
// renderizada uma vez num canvas fora da tela e guardada como imagem. Assim a mão casa visualmente
// com a mesa sem abrir um contexto WebGL por peça.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Values } from "@trimino/shared";
import { LIGHTING, THICK, TileKit } from "./tileKit.ts";

const WIDTH = 200; // px da imagem (exibida a ~64 px; sobra resolução para telas densas)
const HEIGHT = 150;
const DIST = 2.45; // distância da câmera; enquadra a peça de ponta a ponta na largura

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

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = LIGHTING.envIntensity;
    // A mesa é vista de ~10 unidades através da névoa da sala; aqui a câmera está bem mais perto,
    // então a densidade é ajustada para a peça ganhar o mesmo tom.
    this.scene.fog = new THREE.FogExp2(LIGHTING.roomColor, (LIGHTING.fogDensity * 10) / DIST);
    // Abajur na mesma direção relativa do tabuleiro (acima, um pouco à esquerda e à frente).
    const lamp = new THREE.DirectionalLight(LIGHTING.lampColor, LIGHTING.lampIntensity);
    lamp.position.set(-2, 13, 2.5);
    const fill = new THREE.DirectionalLight(LIGHTING.fillColor, LIGHTING.fillIntensity);
    fill.position.set(6, 5, 8);
    this.scene.add(lamp, fill, new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity));

    // Mesmo ângulo da câmera do tabuleiro (inclinada), enquadrando uma peça com a ponta para cima.
    const pitch = THREE.MathUtils.degToRad(58);
    this.camera.position.set(0, Math.sin(pitch) * DIST, Math.cos(pitch) * DIST);
    this.camera.lookAt(0, THICK / 2, -0.07); // a base fica mais perto da câmera; mira um pouco na ponta
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
