package com.example.trimino.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import com.example.trimino.game.Geometry
import com.example.trimino.net.BoardCell

const val EDGE = 64f

/**
 * Espaço do tabuleiro em destaque: livre (`vals` null), a sua prévia (`vals`) ou a pedra que outro
 * jogador está posicionando (`owner`, na cor dele).
 */
data class GhostCell(val r: Int, val c: Int, val vals: List<Int>?, val owner: Color? = null)

fun cellPoints(r: Int, c: Int): List<Offset> = Geometry.cellCorners(r, c, EDGE).map { (x, y) -> Offset(x, y) }

class BoardCamera {
  var offset by mutableStateOf(Offset.Zero)
  var scale by mutableStateOf(1f)
  var size by mutableStateOf(IntSize.Zero)

  /** Enquadra as peças (ou a origem, com o tabuleiro vazio), como o `fit` da Web. */
  fun fit(cells: List<Pair<Int, Int>>, density: Float) {
    if (size.width == 0) return
    val pts = cells.ifEmpty { listOf(0 to 0) }.flatMap { (r, c) -> Geometry.cellCorners(r, c, EDGE) }
    val pad = EDGE * 0.6f
    val minX = pts.minOf { it.first } - pad
    val maxX = pts.maxOf { it.first } + pad
    val minY = pts.minOf { it.second } - pad
    val maxY = pts.maxOf { it.second } + pad
    scale = minOf(1.8f * density, size.width / (maxX - minX), size.height / (maxY - minY))
    offset = Offset(size.width / 2f - (minX + maxX) / 2f * scale, size.height / 2f - (minY + maxY) / 2f * scale)
  }

  /** Centro da célula na tela (px, relativo ao tabuleiro). */
  fun cellToScreen(r: Int, c: Int): Offset {
    val p = cellPoints(r, c)
    return Offset((p[0].x + p[1].x + p[2].x) / 3f, (p[0].y + p[1].y + p[2].y) / 3f) * scale + offset
  }
}

@Composable
fun BoardCanvas(
  board: List<BoardCell>,
  ghosts: List<GhostCell>,
  camera: BoardCamera,
  fitKey: Any,
  onTap: (Int, Int) -> Unit,
  modifier: Modifier = Modifier,
  /** Pedras da ponte/mandala que acabou de sair (brilham por um tempo). */
  glowing: Set<Pair<Int, Int>> = emptySet(),
) {
  val density = LocalDensity.current.density
  LaunchedEffect(fitKey, camera.size) { camera.fit(board.map { it.r to it.c }, density) }
  val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
    0f,
    1f,
    infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Reverse),
    label = "pulse",
  )

  Canvas(
    modifier
      .onSizeChanged { camera.size = it }
      .pointerInput(Unit) {
        detectTransformGestures { centroid, pan, zoom, _ ->
          val newScale = (camera.scale * zoom).coerceIn(0.25f * density, 3f * density)
          val f = newScale / camera.scale
          camera.offset = centroid - (centroid - camera.offset) * f + pan
          camera.scale = newScale
        }
      }
      .pointerInput(Unit) {
        detectTapGestures { p ->
          val w = (p - camera.offset) / camera.scale
          val (r, c) = Geometry.cellAt(w.x, w.y, EDGE)
          onTap(r, c)
        }
      }
  ) {
    drawFelt()
    withTransform({
      translate(camera.offset.x, camera.offset.y)
      scale(camera.scale, camera.scale, Offset.Zero)
    }) {
      // espaços livres embaixo das pedras
      for (g in ghosts) {
        if (g.vals != null) continue
        drawSlot(cellPoints(g.r, g.c), Accent, ringAlpha = 0.35f + pulse * 0.25f, fillAlpha = 0.04f + pulse * 0.04f)
      }
      for (cell in board) {
        val glow = (cell.r to cell.c) in glowing
        drawPipTile(cellPoints(cell.r, cell.c), cell.vals, if (glow) TileLook(Accent, 0.18f + pulse * 0.12f, Color(0xFFFFC531), 0.6f + pulse * 0.4f) else TileLook.Plain)
      }
      for (g in ghosts) {
        val vals = g.vals ?: continue
        val pts = cellPoints(g.r, g.c)
        val color = g.owner ?: Accent
        drawSlot(pts, color, ringAlpha = 1f, fillAlpha = 0.1f)
        drawPipTile(
          pts,
          vals,
          if (g.owner != null) TileLook(g.owner, 0.16f, g.owner, 0.65f + pulse * 0.35f) else TileLook.Preview,
        )
      }
    }
  }
}

val Felt = Color(0xFF1D4D3A)
val FeltDeep = Color(0xFF123528)
val Panel = Color(0xFF0E2A20)
val Panel2 = Color(0xFF163A2D)
val FeltLine = Color(0xFF2A6650)
val Accent = Color(0xFFF2B33D)
val Muted = Color(0xFF9CB7AA)
val Danger = Color(0xFFE25B4C)
val PlayerColors = listOf(Color(0xFFD9534F), Color(0xFF3A7BD5), Color(0xFFE0A526), Color(0xFF8E5CC8))
