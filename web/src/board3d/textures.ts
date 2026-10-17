// Texturas procedurais desenhadas em canvas: nenhum arquivo de imagem é baixado.

import * as THREE from "three";

/** Cor dos pontinhos de cada valor (0 não tem pontos): 1 laranja, 2 verde, 3 azul, 4 amarelo, 5 vermelho. */
export const VALUE_COLORS = ["#3a3a3a", "#ec7a2c", "#1f9a4a", "#1f6fc0", "#e3bd17", "#d6322c"];

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

/** Gerador pseudoaleatório determinístico, para a textura sair igual em toda máquina. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Feltro: base verde com ruído fino e fibras curtas. Também serve de bump map. */
export function feltTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size);
  const rand = rng(7);
  g.fillStyle = "#1f5a43";
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 18;
    img.data[i] += n * 0.6;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  g.lineWidth = 1;
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const l = 2 + rand() * 5;
    g.strokeStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Tamanho (em unidades da mesa) do quadrado onde os pontinhos de um canto são desenhados. */
export const PIP_AREA = 0.4;
const PIP_SPACING = 0.084;
const PIP_RADIUS = 0.03;

/**
 * Posição dos pontinhos de cada valor, em múltiplos de PIP_SPACING (x atravessa, y vai do canto ao centro),
 * no padrão das peças clássicas: 2 e 3 em linha apontando para o canto, 4 em quadrado, 5 como no dado.
 */
const PIP_LAYOUT: [number, number][][] = [
  [],
  [[0, 0]],
  [[0, -0.55], [0, 0.55]],
  [[0, -1], [0, 0], [0, 1]],
  [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]],
  [[-0.65, -0.65], [0.65, -0.65], [0, 0], [-0.65, 0.65], [0.65, 0.65]],
];

/** Pontinhos de um valor, levemente rebaixados na peça. O topo da textura aponta para o canto. */
export function pipTexture(n: number): THREE.CanvasTexture {
  const size = 256;
  const [c, g] = canvas(size);
  const px = size / PIP_AREA;
  const r = PIP_RADIUS * px;
  for (const [dx, dy] of PIP_LAYOUT[n]) {
    const x = size / 2 + dx * PIP_SPACING * px;
    const y = size / 2 + dy * PIP_SPACING * px;
    g.fillStyle = VALUE_COLORS[n];
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    // borda interna mais escura no alto = cavidade iluminada de cima
    const shade = g.createRadialGradient(x, y + r * 0.3, r * 0.2, x, y, r);
    shade.addColorStop(0, "rgba(255,255,255,0.12)");
    shade.addColorStop(0.75, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Tamanho (em unidades da mesa) do quadrado onde as divisórias são desenhadas, centrado na peça. */
export const DIVIDER_AREA = 0.6;

/**
 * Divisórias em "Y": três linhas do centro em direção ao meio de cada lado, separando os cantos.
 * Desenhada para a peça com a ponta para cima (lados: base, esquerdo e direito).
 */
export function dividerTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size);
  const px = size / DIVIDER_AREA;
  const len = 0.205 * px;
  g.strokeStyle = "rgba(25,25,25,0.9)";
  g.lineWidth = 0.013 * px;
  g.lineCap = "round";
  const cx = size / 2;
  const cy = size / 2;
  // direções do centro ao meio de cada lado: base (para baixo), lado esquerdo e lado direito (para cima)
  for (const [dx, dy] of [[0, 1], [-Math.sqrt(3) / 2, -0.5], [Math.sqrt(3) / 2, -0.5]]) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + dx * len, cy + dy * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
