// Texturas procedurais desenhadas em canvas: nenhum arquivo de imagem é baixado.

import * as THREE from "three";

/** Cor de cada número, como nas peças clássicas. */
export const DIGIT_COLORS = ["#2b2b2b", "#c0392b", "#1f5fae", "#1e8449", "#d35400", "#7d3c98"];

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

/**
 * Número "gravado": sombra no canto superior esquerdo e brilho no inferior direito
 * dão a impressão de baixo-relevo quando a luz vem de cima.
 */
export function digitTexture(n: number): THREE.CanvasTexture {
  const size = 128;
  const [c, g] = canvas(size);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 104px "Arial Black", "Segoe UI Black", "Inter", system-ui, sans-serif`;
  const x = size / 2;
  const y = size / 2 + 5;
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.fillText(String(n), x + 3, y + 3);
  g.fillStyle = "rgba(70,45,10,0.75)";
  g.fillText(String(n), x - 3, y - 3);
  g.fillStyle = DIGIT_COLORS[n];
  g.fillText(String(n), x, y);
  // leve escurecimento na borda interna reforça a gravação
  g.globalCompositeOperation = "source-atop";
  const shade = g.createLinearGradient(0, 20, 0, 110);
  shade.addColorStop(0, "rgba(0,0,0,0.28)");
  shade.addColorStop(0.45, "rgba(0,0,0,0)");
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
