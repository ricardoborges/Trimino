// Grade triangular.
//
// Uma célula (r, c) ocupa a faixa entre as linhas horizontais r e r+1.
// Quando (r + c) é par o triângulo aponta para CIMA, senão para BAIXO.
// Vértices vivem numa rede (x, y) em que x é medido em meias-arestas e
// y em alturas de triângulo. Coordenadas de tela:
//   px = x * aresta / 2,   py = y * aresta * √3 / 2
//
// Os vértices de cada célula são listados em sentido HORÁRIO na tela (y para baixo):
//   cima:  ápice (c+1, r) → base direita (c+2, r+1) → base esquerda (c, r+1)
//   baixo: topo esquerdo (c, r) → topo direito (c+2, r) → ápice (c+1, r+1)

export type Vertex = readonly [x: number, y: number];

export const isUp = (r: number, c: number): boolean => ((r + c) & 1) === 0;

export const cellKey = (r: number, c: number): string => `${r},${c}`;
export const vertexKey = (x: number, y: number): string => `${x},${y}`;

export function cellVertices(r: number, c: number): [Vertex, Vertex, Vertex] {
  return isUp(r, c)
    ? [[c + 1, r], [c + 2, r + 1], [c, r + 1]]
    : [[c, r], [c + 2, r], [c + 1, r + 1]];
}

/** As três células que compartilham uma aresta com (r, c). */
export function edgeNeighbors(r: number, c: number): [number, number][] {
  return isUp(r, c)
    ? [[r, c - 1], [r, c + 1], [r + 1, c]]
    : [[r, c - 1], [r, c + 1], [r - 1, c]];
}

/** As seis células que tocam o vértice (x, y) — juntas formam um hexágono. */
export function cellsAroundVertex(x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [y - 1, y]) for (const c of [x - 2, x - 1, x]) out.push([r, c]);
  return out;
}

export const SQRT3_2 = Math.sqrt(3) / 2;

/** Converte um vértice da rede em pixels para uma aresta de tamanho `size`. */
export function vertexToPixel([x, y]: Vertex, size: number): [number, number] {
  return [(x * size) / 2, y * size * SQRT3_2];
}

/** Célula que contém o ponto (px, py) em pixels, para uma aresta de tamanho `size`. */
export function cellAt(px: number, py: number, size: number): [number, number] {
  const r = Math.floor(py / (size * SQRT3_2));
  const approx = Math.floor(px / (size / 2));
  for (let c = approx - 2; c <= approx + 1; c++) {
    const [a, b, d] = cellVertices(r, c).map((v) => vertexToPixel(v, size));
    const s1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const s2 = (px - d[0]) * (b[1] - d[1]) - (b[0] - d[0]) * (py - d[1]);
    const s3 = (px - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (py - a[1]);
    if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) return [r, c];
  }
  return [r, approx];
}
