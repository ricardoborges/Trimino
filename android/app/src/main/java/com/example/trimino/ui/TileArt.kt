// A pedra desenhada como a peça 3D da Web (web/src/board3d/tileKit.ts e textures.ts) vista de cima:
// corpo branco fosco de cantos arredondados, um pouco de espessura e sombra, divisórias em "Y" e os
// pontinhos de cada canto, na cor do valor e no arranjo das peças clássicas.
package com.example.trimino.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.Dp
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** Cor dos pontinhos de cada valor (0 não tem pontos): 1 laranja, 2 verde, 3 azul, 4 amarelo, 5 vermelho. */
val ValueColors = listOf(Color(0xFF3A3A3A), Color(0xFFEC7A2C), Color(0xFF1F9A4A), Color(0xFF1F6FC0), Color(0xFFE3BD17), Color(0xFFD6322C))

/** Feltro da mesa (TABLE_COLOR da Web). */
val TableFelt = Color(0xFF1D5A42)

private val FaceTop = Color(0xFFFFFDF7)
private val FaceBottom = Color(0xFFECE7DA)
private val SideColor = Color(0xFFB9B2A0)
private val DividerColor = Color(0xE6191919)

private const val PIP_DISTANCE = 0.235f
private const val PIP_SPACING = 0.084f
private const val PIP_RADIUS = 0.03f
private const val DIVIDER_LEN = 0.205f
private const val CORNER = 0.07f

/** Posição dos pontinhos (x atravessa, y vai do canto ao centro), em múltiplos de PIP_SPACING. */
private val PipLayout =
  listOf(
    emptyList(),
    listOf(0f to 0f),
    listOf(0f to -0.55f, 0f to 0.55f),
    listOf(0f to -1f, 0f to 0f, 0f to 1f),
    listOf(-0.55f to -0.55f, 0.55f to -0.55f, -0.55f to 0.55f, 0.55f to 0.55f),
    listOf(-0.65f to -0.65f, 0.65f to -0.65f, 0f to 0f, -0.65f to 0.65f, 0.65f to 0.65f),
  )

/** Como a pedra aparece: normal, prévia (sua, dourada), de outro jogador (na cor dele) ou comemorando. */
data class TileLook(
  val tint: Color? = null,
  val tintAmount: Float = 0f,
  val glow: Color? = null,
  val glowAlpha: Float = 0f,
  /** Pontinhos maiores (pedras pequenas na tela, como as da mão), para ler sem esforço. */
  val pipScale: Float = 1f,
) {
  companion object {
    val Plain = TileLook()
    val Preview = TileLook(tint = Accent, tintAmount = 0.12f, glow = Accent, glowAlpha = 0.9f)
  }
}

private fun centroid(p: List<Offset>) = Offset((p[0].x + p[1].x + p[2].x) / 3f, (p[0].y + p[1].y + p[2].y) / 3f)

/** Triângulo de cantos arredondados com os cantos `pts` encolhidos para o centro pelo fator `s`. */
fun roundedTriangle(pts: List<Offset>, s: Float, corner: Float): Path {
  val c = centroid(pts)
  val p = pts.map { c + (it - c) * s }
  return Path().apply {
    for (i in 0 until 3) {
      val prev = p[(i + 2) % 3]
      val cur = p[i]
      val next = p[(i + 1) % 3]
      val a = cur + (prev - cur).let { it / it.getDistance() * corner }
      val b = cur + (next - cur).let { it / it.getDistance() * corner }
      if (i == 0) moveTo(a.x, a.y) else lineTo(a.x, a.y)
      quadraticTo(cur.x, cur.y, b.x, b.y)
    }
    close()
  }
}

private fun edgeOf(pts: List<Offset>) = (pts[1] - pts[0]).getDistance()

/** A pedra com a face para cima nos cantos `pts` (qualquer orientação), valores em sentido horário. */
fun DrawScope.drawPipTile(pts: List<Offset>, vals: List<Int>, look: TileLook = TileLook.Plain) {
  val e = edgeOf(pts)
  val c = centroid(pts)
  val body = roundedTriangle(pts, 0.93f, CORNER * e)
  // sombra na mesa e a lateral da peça (espessura)
  translate(e * 0.03f, e * 0.075f) { drawPath(body, Color.Black.copy(alpha = 0.28f)) }
  translate(0f, e * 0.045f) { drawPath(body, SideColor) }
  // brilho em volta (prévia, jogada do outro, comemoração)
  look.glow?.let { drawPath(body, it.copy(alpha = look.glowAlpha), style = Stroke(width = e * 0.07f)) }
  val top = look.tint?.let { lerp(FaceTop, it, look.tintAmount) } ?: FaceTop
  val bottom = look.tint?.let { lerp(FaceBottom, it, look.tintAmount) } ?: FaceBottom
  val minY = pts.minOf { it.y }
  val maxY = pts.maxOf { it.y }
  drawPath(body, Brush.verticalGradient(listOf(top, bottom), startY = minY, endY = maxY))
  drawPath(body, Color.White.copy(alpha = 0.7f), style = Stroke(width = e * 0.012f))

  // divisórias em "Y": do centro em direção ao meio de cada lado
  for (i in 0 until 3) {
    val mid = (pts[i] + pts[(i + 1) % 3]) / 2f
    val d = mid - c
    drawLine(DividerColor, c, c + d / d.getDistance() * (DIVIDER_LEN * e), strokeWidth = e * 0.016f, cap = StrokeCap.Round)
  }

  // pontinhos de cada canto, com o arranjo apontando para o próprio canto
  pts.forEachIndexed { i, corner ->
    val n = vals[i]
    if (n <= 0 || n > 5) return@forEachIndexed
    val u = (corner - c).let { it / it.getDistance() }
    val across = Offset(-u.y, u.x)
    // pontinhos maiores ficam um pouco mais perto do canto, para caberem entre as divisórias
    val pos = c + u * (PIP_DISTANCE * e * (1f + (look.pipScale - 1f) * 0.3f))
    val r = PIP_RADIUS * e * look.pipScale
    val spacing = PIP_SPACING * e * (1f + (look.pipScale - 1f) * 0.75f)
    for ((dx, dy) in PipLayout[n]) {
      val at = pos + across * (dx * spacing) - u * (dy * spacing)
      drawCircle(ValueColors[n], r, at)
      // cavidade: borda escura e um reflexo leve
      drawCircle(
        Brush.radialGradient(
          0f to Color.White.copy(alpha = 0.12f),
          0.75f to Color.Transparent,
          1f to Color.Black.copy(alpha = 0.35f),
          center = at + Offset(0f, r * 0.3f),
          radius = r,
        ),
        r,
        at,
      )
    }
  }
}

private val BackGrad = listOf(Color(0xFFF7F0DE), Color(0xFFE6DBC0), Color(0xFFC9B98F))

/** Verso da pedra: marfim, um triângulo gravado e um ponto no meio (como no monte da Web). */
fun DrawScope.drawTileBack(pts: List<Offset>, glow: Color? = null) {
  val e = edgeOf(pts)
  val c = centroid(pts)
  val body = roundedTriangle(pts, 0.93f, CORNER * e)
  translate(e * 0.03f, e * 0.07f) { drawPath(body, Color.Black.copy(alpha = 0.3f)) }
  translate(0f, e * 0.04f) { drawPath(body, Color(0xFFA8987A)) }
  glow?.let { drawPath(body, it, style = Stroke(width = e * 0.09f)) }
  val minX = pts.minOf { it.x }
  val minY = pts.minOf { it.y }
  drawPath(body, Brush.linearGradient(BackGrad, start = Offset(minX, minY), end = Offset(minX + e, minY + e)))
  drawPath(roundedTriangle(pts, 0.55f, CORNER * e * 0.6f), Color(0xCCB9A983), style = Stroke(width = e * 0.02f))
  drawCircle(Color(0xFFC8B68D), e * 0.045f, c)
}

/** Espaço livre do tabuleiro: contorno dourado e um preenchimento leve (pulsando). */
fun DrawScope.drawSlot(pts: List<Offset>, color: Color, ringAlpha: Float, fillAlpha: Float) {
  val e = edgeOf(pts)
  val path = roundedTriangle(pts, 0.9f, CORNER * e)
  drawPath(path, color.copy(alpha = fillAlpha))
  drawPath(path, color.copy(alpha = ringAlpha), style = Stroke(width = e * 0.035f))
}

/** Cantos de uma pedra com a ponta para cima dentro de um retângulo w × h (h = w × 0,866). */
fun uprightCorners(w: Float, h: Float, pad: Float = 0f): List<Offset> =
  listOf(Offset(w / 2f, pad), Offset(w - pad, h - pad), Offset(pad, h - pad))

/** Pontinhos das pedras soltas (mão, sorteio, conferência): maiores que os do tabuleiro, que dá para ampliar. */
const val LOOSE_PIPS = 1.4f

/** Pedra solta (mão, sorteio, conferência), sempre com a ponta para cima. */
@Composable
fun PipTile(vals: List<Int>, width: Dp, modifier: Modifier = Modifier, look: TileLook = TileLook(pipScale = LOOSE_PIPS)) {
  Canvas(modifier.size(width, width * 0.95f)) {
    val w = size.width
    // sobra embaixo para a espessura e a sombra
    drawPipTile(uprightCorners(w, w * 0.866f, w * 0.04f), vals, look)
  }
}

@Composable
fun TileBack(width: Dp, modifier: Modifier = Modifier, glow: Color? = null) {
  Canvas(modifier.size(width, width * 0.95f)) {
    val w = size.width
    drawTileBack(uprightCorners(w, w * 0.866f, w * 0.04f), glow)
  }
}

/** Gira os cantos em volta do centro (o monte espalhado). */
fun rotateAround(pts: List<Offset>, deg: Float): List<Offset> {
  val c = centroid(pts)
  val a = Math.toRadians(deg.toDouble())
  val (co, si) = cos(a).toFloat() to sin(a).toFloat()
  return pts.map { p -> (p - c).let { Offset(it.x * co - it.y * si, it.x * si + it.y * co) } + c }
}

// ---------------- feltro ----------------

private var feltCache: ImageBitmap? = null

/** Textura do feltro: ruído fino e fibras curtas, gerada uma vez (mesma receita da Web). */
private fun feltTexture(): ImageBitmap {
  feltCache?.let { return it }
  val size = 256
  val bmp = ImageBitmap(size, size)
  val canvas = androidx.compose.ui.graphics.Canvas(bmp)
  var seed = 7L
  fun rand(): Float {
    seed = (seed * 1664525 + 1013904223) and 0xFFFFFFFFL
    return seed / 4294967296f
  }
  val paint = Paint()
  canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), paint.apply { color = Color.Transparent })
  paint.strokeWidth = 1f
  repeat(900) {
    val x = rand() * size
    val y = rand() * size
    val a = rand() * Math.PI.toFloat() * 2
    val l = 2 + rand() * 5
    paint.color = if (rand() < 0.5f) Color.White.copy(alpha = 0.05f) else Color.Black.copy(alpha = 0.08f)
    canvas.drawLine(Offset(x, y), Offset(x + cos(a) * l, y + sin(a) * l), paint)
  }
  return bmp.also { feltCache = it }
}

/** Mesa de feltro com a luz mais forte no meio. */
fun DrawScope.drawFelt() {
  drawRect(TableFelt)
  drawRect(ShaderBrush(ImageShader(feltTexture(), TileMode.Repeated, TileMode.Repeated)))
  drawRect(
    Brush.radialGradient(
      0f to Color.White.copy(alpha = 0.09f),
      0.6f to Color.Transparent,
      1f to Color.Black.copy(alpha = 0.22f),
      center = Offset(size.width / 2f, size.height * 0.4f),
      radius = hypot(size.width, size.height) * 0.65f,
    )
  )
}
