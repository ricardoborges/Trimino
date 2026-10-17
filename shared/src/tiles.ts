export type Values = [number, number, number];

export interface Tile {
  id: number;
  /** Números nos cantos, em sentido horário. */
  v: Values;
}

/**
 * As 56 peças clássicas: toda combinação a ≤ b ≤ c com valores de 0 a 5,
 * escrita em sentido horário crescente (como no Tri-Ominos original).
 */
export function fullSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let a = 0; a <= 5; a++)
    for (let b = a; b <= 5; b++)
      for (let c = b; c <= 5; c++) tiles.push({ id: tiles.length, v: [a, b, c] });
  return tiles;
}

export const tileSum = (t: Tile): number => t.v[0] + t.v[1] + t.v[2];
export const isTriple = (t: Tile): boolean => t.v[0] === t.v[1] && t.v[1] === t.v[2];

/** Valores por vértice da célula para uma rotação 0..2. */
export const rotated = (v: Values, rot: number): Values => [v[rot % 3], v[(rot + 1) % 3], v[(rot + 2) % 3]];
