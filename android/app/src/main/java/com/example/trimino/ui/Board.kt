package com.example.trimino.ui

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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import com.example.trimino.game.Geometry
import com.example.trimino.net.BoardCell

const val EDGE = 64f

data class GhostCell(val r: Int, val c: Int, val vals: List<Int>?)

class Camera {
  var offset by mutableStateOf(Offset.Zero)
  var scale by mutableStateOf(1f)

  fun fit(cells: List<Pair<Int, Int>>, size: IntSize, density: Float) {
    if (size.width == 0) return
    val pts = (cells.ifEmpty { listOf(0 to 0) }).flatMap { (r, c) -> Geometry.cellCorners(r, c, EDGE) }
    val minX = pts.minOf { it.first } - EDGE * 2
    val maxX = pts.maxOf { it.first } + EDGE * 2
    val minY = pts.minOf { it.second } - EDGE * 2
    val maxY = pts.maxOf { it.second } + EDGE * 2
    scale = minOf(1.6f * density, size.width / (maxX - minX), size.height / (maxY - minY))
    offset = Offset(size.width / 2f - (minX + maxX) / 2f * scale, size.height / 2f - (minY + maxY) / 2f * scale)
  }
}

@Composable
fun BoardCanvas(
  board: List<BoardCell>,
  ghosts: List<GhostCell>,
  colorOf: (String) -> Color,
  fitKey: Any,
  onTap: (Int, Int) -> Unit,
  modifier: Modifier = Modifier,
) {
  val cam = remember { Camera() }
  var size by remember { mutableStateOf(IntSize.Zero) }
  val measurer = rememberTextMeasurer()
  val density = androidx.compose.ui.platform.LocalDensity.current.density

  LaunchedEffect(fitKey, size) { cam.fit(board.map { it.r to it.c }, size, density) }

  Canvas(
    modifier
      .onSizeChanged { size = it }
      .pointerInput(Unit) {
        detectTransformGestures { centroid, pan, zoom, _ ->
          val newScale = (cam.scale * zoom).coerceIn(0.3f * density, 3f * density)
          val f = newScale / cam.scale
          cam.offset = centroid - (centroid - cam.offset) * f + pan
          cam.scale = newScale
        }
      }
      .pointerInput(Unit) {
        detectTapGestures { p ->
          val w = (p - cam.offset) / cam.scale
          val (r, c) = Geometry.cellAt(w.x, w.y, EDGE)
          onTap(r, c)
        }
      }
  ) {
    drawRect(Felt)
    withTransform({
      translate(cam.offset.x, cam.offset.y)
      scale(cam.scale, cam.scale, Offset.Zero)
    }) {
      val last = board.lastOrNull()
      for (cell in board) drawTile(measurer, cell.r, cell.c, cell.vals, colorOf(cell.by), highlight = cell === last)
      for (g in ghosts) {
        if (g.vals != null) drawTile(measurer, g.r, g.c, g.vals, Accent, highlight = true, ghost = true)
        else {
          val path = trianglePath(g.r, g.c)
          drawPath(path, Accent.copy(alpha = 0.16f), style = Fill)
          drawPath(path, Accent, style = Stroke(width = 2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f))))
        }
      }
    }
  }
}

private fun trianglePath(r: Int, c: Int): Path {
  val pts = Geometry.cellCorners(r, c, EDGE)
  return Path().apply {
    moveTo(pts[0].first, pts[0].second)
    lineTo(pts[1].first, pts[1].second)
    lineTo(pts[2].first, pts[2].second)
    close()
  }
}

/** Desenha uma peça na célula (r, c) com os números perto de cada canto. */
fun DrawScope.drawTile(
  measurer: TextMeasurer,
  r: Int,
  c: Int,
  vals: List<Int>,
  border: Color,
  highlight: Boolean = false,
  ghost: Boolean = false,
) {
  drawTriangle(measurer, Geometry.cellCorners(r, c, EDGE), vals, border, highlight, ghost)
}

fun DrawScope.drawTriangle(
  measurer: TextMeasurer,
  pts: List<Pair<Float, Float>>,
  vals: List<Int>,
  border: Color,
  highlight: Boolean = false,
  ghost: Boolean = false,
) {
  val path = Path().apply {
    moveTo(pts[0].first, pts[0].second)
    lineTo(pts[1].first, pts[1].second)
    lineTo(pts[2].first, pts[2].second)
    close()
  }
  if (!ghost) {
    withTransform({ translate(0f, 1.5f) }) { drawPath(path, Color.Black.copy(alpha = 0.3f)) }
  }
  drawPath(path, if (ghost) GhostFill else if (highlight) IvoryLight else Ivory)
  drawPath(path, border, style = Stroke(width = if (highlight) 3.5f else 2.5f))
  val cx = (pts[0].first + pts[1].first + pts[2].first) / 3f
  val cy = (pts[0].second + pts[1].second + pts[2].second) / 3f
  pts.forEachIndexed { i, (x, y) ->
    val layout = measurer.measure(vals[i].toString(), TextStyle(color = Ink, fontSize = 15.sp / density, fontWeight = FontWeight.Bold))
    val tx = x + (cx - x) * 0.42f - layout.size.width / 2f
    val ty = y + (cy - y) * 0.42f - layout.size.height / 2f
    drawText(layout, topLeft = Offset(tx, ty))
  }
}

val Felt = Color(0xFF1D4D3A)
val FeltDeep = Color(0xFF123528)
val Panel = Color(0xFF0E2A20)
val Panel2 = Color(0xFF163A2D)
val FeltLine = Color(0xFF2A6650)
val Ivory = Color(0xFFF6EFDC)
val IvoryLight = Color(0xFFFFF8E3)
val GhostFill = Color(0xFFFFF4D0)
val Ink = Color(0xFF1B2A24)
val Accent = Color(0xFFF2B33D)
val Muted = Color(0xFF9CB7AA)
val Danger = Color(0xFFE25B4C)
val PlayerColors = listOf(Color(0xFFD9534F), Color(0xFF3A7BD5), Color(0xFFE0A526), Color(0xFF8E5CC8))
