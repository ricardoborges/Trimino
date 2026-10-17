// Peça 3D compartilhada pelo tabuleiro e pela mão do jogador: mesma geometria,
// mesmo material e mesmos números, para que o que está na mão seja idêntico ao que vai à mesa.

import * as THREE from "three";
import { cellVertices, isUp, vertexToPixel, type Values } from "@trimino/shared";
import { digitTexture } from "./textures.ts";

export const H = Math.sqrt(3) / 2;
export const THICK = 0.12; // espessura total da peça
export const BEVEL = 0.03;
export const GAP = 0.03; // sulco entre peças vizinhas
const CORNER = 0.07; // raio dos cantos arredondados
const DIGIT_SIZE = 0.28;
const DIGIT_PULL = 0.43; // quanto o número é puxado do canto para o centro
export const ACCENT = new THREE.Color("#f2b33d");

type Corners = [THREE.Vector2, THREE.Vector2, THREE.Vector2];

/** Cantos da célula no plano (x, z) e o centroide. */
export function cellGeometry(r: number, c: number): { pts: Corners; center: THREE.Vector2 } {
  const pts = cellVertices(r, c).map((v) => new THREE.Vector2(...vertexToPixel(v, 1))) as Corners;
  const center = new THREE.Vector2().add(pts[0]).add(pts[1]).add(pts[2]).divideScalar(3);
  return { pts, center };
}

/** Triângulo de cantos arredondados, centrado no centroide, encolhido por `inset` em cada aresta. */
export function roundedTriangle(up: boolean, inset: number): THREE.Shape {
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

/** Geometrias, materiais e montagem de uma peça. Uma instância por renderizador. */
export class TileKit {
  readonly tileMat: THREE.MeshStandardMaterial;
  readonly previewMat: THREE.MeshStandardMaterial;
  private geo = { up: tileGeometry(true), down: tileGeometry(false) };
  private digitGeo = new THREE.PlaneGeometry(DIGIT_SIZE, DIGIT_SIZE).rotateX(-Math.PI / 2);
  private gemGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.008, 24);
  private digitMats: THREE.MeshStandardMaterial[];
  private gemMats = new Map<string, THREE.MeshStandardMaterial>();

  constructor() {
    // Creme liso e fosco: sem verniz, reflexos ou manchas.
    this.tileMat = new THREE.MeshStandardMaterial({ color: "#f3ead6", roughness: 0.8, metalness: 0 });
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
  }

  /** Peça na célula (r, c), já posicionada na mesa. `owner` adiciona a marca com a cor de quem jogou. */
  build(r: number, c: number, vals: Values, mat: THREE.Material = this.tileMat, owner: string | null = null): THREE.Group {
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

  private gemMaterial(color: string): THREE.MeshStandardMaterial {
    let m = this.gemMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
      this.gemMats.set(color, m);
    }
    return m;
  }
}

/**
 * Iluminação uniforme e fosca, igual na mesa e nas fotos da mão: luz ambiente forte vinda de cima
 * e uma luz direcional suave só para dar volume e uma sombra leve. Sem abajur, névoa ou reflexos.
 */
export function addFlatLighting(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight("#ffffff", "#c9c3b3", 2.0));
  const key = new THREE.DirectionalLight("#ffffff", 1.1);
  key.position.set(-2, 10, 3);
  scene.add(key, key.target);
  return key;
}

export const TABLE_COLOR = "#1d5a42";
