// Peça 3D compartilhada pelo tabuleiro e pela mão do jogador: mesma geometria,
// mesmo material e mesmos números, para que o que está na mão seja idêntico ao que vai à mesa.

import * as THREE from "three";
import { cellVertices, isUp, vertexToPixel, type Values } from "@trimino/shared";
import { DIVIDER_AREA, PIP_AREA, dividerTexture, pipTexture } from "./textures.ts";

export const H = Math.sqrt(3) / 2;
export const THICK = 0.12; // espessura total da peça
export const BEVEL = 0.03;
export const GAP = 0.03; // sulco entre peças vizinhas
const CORNER = 0.07; // raio dos cantos arredondados
const PIP_DISTANCE = 0.235; // distância do centro da peça ao centro dos pontinhos de cada canto
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
  private pipGeo = new THREE.PlaneGeometry(PIP_AREA, PIP_AREA).rotateX(-Math.PI / 2);
  private dividerGeo = new THREE.PlaneGeometry(DIVIDER_AREA, DIVIDER_AREA).rotateX(-Math.PI / 2);
  private dividerMat: THREE.MeshStandardMaterial;
  private pipMats: THREE.MeshStandardMaterial[];

  constructor() {
    // Branco liso e fosco: sem verniz, reflexos ou manchas.
    this.tileMat = new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 0.8, metalness: 0 });
    this.previewMat = this.tileMat.clone();
    this.previewMat.emissive = ACCENT.clone();
    this.previewMat.emissiveIntensity = 0.07;

    const decal = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.pipMats = [0, 1, 2, 3, 4, 5].map((n) => decal(pipTexture(n)));
    this.dividerMat = decal(dividerTexture());
  }

  /** Peça na célula (r, c), já posicionada na mesa. */
  build(r: number, c: number, vals: Values, mat: THREE.Material = this.tileMat): THREE.Group {
    const up = isUp(r, c);
    const { pts, center } = cellGeometry(r, c);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.y);

    const body = new THREE.Mesh(up ? this.geo.up : this.geo.down, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Divisórias em "Y" separando os três cantos (a textura é da peça com a ponta para cima).
    const divider = new THREE.Mesh(this.dividerGeo, this.dividerMat);
    divider.position.y = THICK + 0.0012;
    divider.rotation.y = up ? 0 : Math.PI;
    divider.renderOrder = 1;
    group.add(divider);

    // Pontinhos de cada canto; o arranjo aponta para o próprio canto.
    pts.forEach((p, i) => {
      if (vals[i] === 0) return;
      const local = p.clone().sub(center);
      const pos = local.clone().setLength(PIP_DISTANCE);
      const pips = new THREE.Mesh(this.pipGeo, this.pipMats[vals[i]]);
      pips.position.set(pos.x, THICK + 0.0016, pos.y);
      pips.rotation.y = Math.atan2(-local.x, -local.y);
      pips.renderOrder = 2;
      group.add(pips);
    });

    return group;
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
