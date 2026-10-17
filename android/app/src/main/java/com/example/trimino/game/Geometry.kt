package com.example.trimino.game

import kotlin.math.sqrt

// Mesma grade de shared/src/geometry.ts: a célula (r, c) aponta para cima quando r + c é par,
// e os vértices são listados em sentido horário na tela.
object Geometry {
  val SQRT3_2 = sqrt(3.0).toFloat() / 2f

  fun isUp(r: Int, c: Int): Boolean = ((r + c) and 1) == 0

  /** Vértices (x, y) da rede: x em meias-arestas, y em alturas de triângulo. */
  fun cellVertices(r: Int, c: Int): List<Pair<Int, Int>> =
    if (isUp(r, c)) listOf(c + 1 to r, c + 2 to r + 1, c to r + 1) else listOf(c to r, c + 2 to r, c + 1 to r + 1)

  /** Cantos da célula em pixels, para uma aresta de tamanho [edge]. */
  fun cellCorners(r: Int, c: Int, edge: Float): List<Pair<Float, Float>> =
    cellVertices(r, c).map { (x, y) -> x * edge / 2f to y * edge * SQRT3_2 }

  /** Teste ponto-no-triângulo usado para detectar toques no tabuleiro. */
  fun cellAt(px: Float, py: Float, edge: Float): Pair<Int, Int> {
    val r = kotlin.math.floor(py / (edge * SQRT3_2)).toInt()
    val approx = kotlin.math.floor(px / (edge / 2f)).toInt()
    for (c in (approx - 2)..(approx + 1)) {
      val pts = cellCorners(r, c, edge)
      if (contains(pts, px, py)) return r to c
    }
    return r to approx
  }

  private fun contains(p: List<Pair<Float, Float>>, x: Float, y: Float): Boolean {
    fun sign(a: Pair<Float, Float>, b: Pair<Float, Float>) = (x - b.first) * (a.second - b.second) - (a.first - b.first) * (y - b.second)
    val d1 = sign(p[0], p[1])
    val d2 = sign(p[1], p[2])
    val d3 = sign(p[2], p[0])
    val neg = d1 < 0 || d2 < 0 || d3 < 0
    val pos = d1 > 0 || d2 > 0 || d3 > 0
    return !(neg && pos)
  }
}
