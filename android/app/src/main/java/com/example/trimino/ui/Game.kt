// A mesa, como a da Web no celular (web/index.html #app e web/src/main.ts): topo com o placar, o tabuleiro
// com a faixa da vez e os adversários, as câmeras com as ferramentas de mídia, e a mão com as ações.
package com.example.trimino.ui

import android.content.ClipData
import android.content.Intent as AndroidIntent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ListAlt
import androidx.compose.material.icons.automirrored.rounded.RotateRight
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.FilterCenterFocus
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material.icons.rounded.Token
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.VideocamOff
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.trimino.net.GameState
import com.example.trimino.net.Intent
import com.example.trimino.net.LogEntry
import com.example.trimino.net.PlayerInfo
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Largura das pedras da mão: grandes o bastante para ler os pontinhos sem forçar a vista. */
private val HAND_TILE = 84.dp
private val DockMine = Color(0xFF2D6A4F)
private val DockMineLine = Color(0xFF74C69D)
private val ToolIcon = Color(0xFF7FE0B0)
private val PointsPos = Color(0xFF5AA9FF)
private val PointsNeg = Color(0xFFFF6B5E)
private val Whatsapp = Color(0xFF25D366)
private val Scrim = Color(0x8C081812)

/** Ícone do WhatsApp (o mesmo SVG do botão Convidar da Web). */
private val WhatsappIcon: ImageVector by lazy {
  val d =
    "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"
  ImageVector.Builder("whatsapp", 24.dp, 24.dp, 24f, 24f).addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.White)).build()
}

private fun colorOf(s: GameState, id: String?): Color = PlayerColors[s.players.indexOfFirst { it.id == id }.coerceAtLeast(0) % 4]

private fun signed(n: Int) = if (n < 0) "−${-n}" else "+$n"

@Composable
fun GameScreen(vm: GameViewModel) {
  val s = vm.state
  val haptic = LocalHapticFeedback.current
  var confirmQuit by remember { mutableStateOf(false) }
  var confirmRestart by remember { mutableStateOf<String?>(null) }
  var panel by remember { mutableStateOf<String?>(null) }
  BackHandler { confirmQuit = true }

  LaunchedEffect(vm.myTurnSeq) {
    if (vm.myTurnSeq > 0) haptic.performHapticFeedback(HapticFeedbackType.LongPress)
  }

  BoxWithConstraints(Modifier.fillMaxSize().background(FeltDeep).safeDrawingPadding()) {
    val landscape = maxWidth > maxHeight
    Column(Modifier.fillMaxSize()) {
      TopBar(vm, s, onQuit = { confirmQuit = true }, onPanel = { panel = it }, onRestart = { confirmRestart = it })
      if (landscape) {
        Row(Modifier.weight(1f)) {
          Column(Modifier.weight(1f).fillMaxHeight()) {
            Table(vm, s, Modifier.weight(1f).fillMaxWidth())
            Dock(vm, s)
          }
          Side(vm, s, columns = 2, landscape = true, modifier = Modifier.width(280.dp).fillMaxHeight())
        }
      } else {
        Table(vm, s, Modifier.weight(1f).fillMaxWidth())
        Side(vm, s, columns = 4, landscape = false, modifier = Modifier.fillMaxWidth())
        Dock(vm, s)
      }
    }
  }

  if (s != null && vm.pile != null) PileDialog(vm, s)
  if (s != null && panel == "log") LogSheet(vm, s) { panel = null }
  if (s != null && panel == "sheet") ScoreSheet(s) { panel = null }
  if (s != null && panel == "tokens" && s.tokens != null) TokensSheet(s) { panel = null }
  if (s != null && panel == "watchers") SpectatorsSheet(vm, s) { panel = null }
  confirmRestart?.let { kind ->
    val round = kind == "round"
    AlertDialog(
      onDismissRequest = { confirmRestart = null },
      containerColor = Panel,
      title = { Text(if (round) "Reiniciar a rodada?" else "Reiniciar a partida?", color = TextColor) },
      text = {
        Text(
          if (round) "As peças são distribuídas de novo e os pontos desta rodada são desfeitos."
          else "O placar volta a zero e começa um novo sorteio.",
          color = Muted,
        )
      },
      confirmButton = {
        TextButton({
          confirmRestart = null
          if (round) vm.restartRound() else vm.restartGame()
        }) { Text("Reiniciar", color = Color(0xFFFFB3AA)) }
      },
      dismissButton = { TextButton({ confirmRestart = null }) { Text("Cancelar", color = TextColor) } },
    )
  }
  if (confirmQuit) {
    AlertDialog(
      onDismissRequest = { confirmQuit = false },
      containerColor = Panel,
      title = { Text(if (vm.inMatch) "Desistir da partida?" else "Sair da sala?", color = TextColor) },
      text = { if (vm.inMatch) Text("Os outros jogadores continuam o jogo sem você.", color = Muted) },
      confirmButton = { TextButton({ confirmQuit = false; vm.quit() }) { Text(if (vm.inMatch) "Desistir" else "Sair", color = Color(0xFFFFB3AA)) } },
      dismissButton = { TextButton({ confirmQuit = false }) { Text("Cancelar", color = TextColor) } },
    )
  }
}

// ---------------- topo ----------------

@Composable
private fun IconChip(icon: ImageVector, description: String, active: Boolean = false, badge: String? = null, onClick: () -> Unit) {
  Row(
    Modifier.height(34.dp).widthIn(min = 34.dp).clip(CircleShape).background(Color(0x40000000))
      .border(1.dp, if (active) Accent else FeltLine, CircleShape).clickable(onClick = onClick)
      .padding(horizontal = if (badge != null) 9.dp else 0.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
  ) {
    Icon(icon, description, tint = if (active) Accent else TextColor, modifier = Modifier.size(18.dp))
    if (badge != null) Text(badge, color = if (active) Accent else TextColor, fontSize = 12.sp, fontWeight = FontWeight.Bold)
  }
}

@Composable
private fun TopBar(vm: GameViewModel, s: GameState?, onQuit: () -> Unit, onPanel: (String) -> Unit, onRestart: (String) -> Unit) {
  Row(
    Modifier.fillMaxWidth().background(Panel).padding(horizontal = 10.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    IconChip(Icons.Rounded.History, "Histórico da partida") { onPanel("log") }
    IconChip(Icons.AutoMirrored.Rounded.ListAlt, "Folha de pontos") { onPanel("sheet") }
    if (s?.tokens != null) {
      IconChip(Icons.Rounded.Token, "Tokens da IA") { onPanel("tokens") }
    }
    val watchers = s?.players?.filter { it.spectator && it.connected }.orEmpty()
    if (watchers.isNotEmpty()) {
      val hasRequest = vm.isHost && watchers.any { it.callRequested }
      IconChip(Icons.Rounded.Visibility, "Espectadores", active = hasRequest, badge = "${watchers.size}") { onPanel("watchers") }
    }
    if (!vm.online) Text("reconectando…", color = Danger, fontSize = 13.sp)
    Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
      if (s != null) Scores(vm, s)
    }
    if (s != null && vm.isHost && s.phase in listOf("lottery", "playing", "roundOver")) {
      var open by remember { mutableStateOf(false) }
      Box {
        IconChip(Icons.Rounded.RestartAlt, "Reiniciar", active = open) { open = true }
        DropdownMenu(open, { open = false }, containerColor = Panel, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, FeltLine)) {
          Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DarkButton("Reiniciar rodada", { open = false; onRestart("round") }, enabled = s.phase == "playing")
            DarkButton("Reiniciar partida", { open = false; onRestart("game") })
          }
        }
      }
    }
    Text(
      "Sair",
      color = Color(0xFFFFB3AA),
      fontSize = 13.sp,
      modifier = Modifier.clip(CircleShape).background(Color(0x40000000)).border(1.dp, Danger.copy(alpha = 0.6f), CircleShape).clickable(onClick = onQuit)
        .padding(horizontal = 12.dp, vertical = 6.dp),
    )
  }
}

@Composable
private fun Scores(vm: GameViewModel, s: GameState) {
  val inMatch = s.phase == "lottery" || s.phase == "playing" || s.phase == "roundOver"
  var removing by remember { mutableStateOf<PlayerInfo?>(null) }
  s.players.filter { !it.spectator }.forEachIndexed { i, p ->
    val turn = p.id == s.turnPlayerId
    Row(
      Modifier.alpha(if (p.out) 0.45f else if (!p.connected) 0.5f else 1f).clip(CircleShape).background(Panel2)
        .border(if (turn) 2.dp else 1.dp, if (turn) Accent else Color.Transparent, CircleShape).padding(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Box(Modifier.size(10.dp).background(PlayerColors[i % 4], CircleShape))
      Text(p.name, color = TextColor, fontSize = 13.sp, maxLines = 1)
      Text("${p.score}", color = TextColor, fontSize = 13.sp, fontWeight = FontWeight.Bold, textDecoration = if (p.out) TextDecoration.LineThrough else null)
      if (p.out) Text("desistiu", color = Muted, fontSize = 11.sp) else if (!p.connected) Text("offline", color = Danger, fontSize = 11.sp)
      // anfitrião, durante a partida: tirar um jogador (ex.: sumiu sem avisar)
      if (vm.isHost && inMatch && !p.out && p.id != s.you.id) {
        Box(
          Modifier.size(18.dp).clip(CircleShape).background(if (p.connected) Color(0x40000000) else Danger).clickable { removing = p },
          contentAlignment = Alignment.Center,
        ) { Icon(Icons.Rounded.Close, "Tirar ${p.name} da partida", tint = if (p.connected) Muted else Color.White, modifier = Modifier.size(11.dp)) }
      }
    }
  }
  removing?.let { p ->
    AlertDialog(
      onDismissRequest = { removing = null },
      containerColor = Panel,
      title = { Text("Tirar ${p.name} da partida?", color = TextColor) },
      text = { Text("Conta como desistência${if (p.id == s.turnPlayerId) " e a vez passa para o próximo" else ""}.", color = Muted) },
      confirmButton = { TextButton({ removing = null; vm.removePlayer(p.id) }) { Text("Tirar", color = Color(0xFFFFB3AA)) } },
      dismissButton = { TextButton({ removing = null }) { Text("Cancelar", color = TextColor) } },
    )
  }
}

// ---------------- mesa ----------------

@Composable
private fun Table(vm: GameViewModel, s: GameState?, modifier: Modifier) {
  val camera = remember { BoardCamera() }
  val density = LocalDensity.current.density
  BoxWithConstraints(modifier) {
    if (s == null) {
      Canvas(Modifier.fillMaxSize()) { drawFelt() }
      return@BoxWithConstraints
    }
    val myTurn = vm.isMyTurn
    val watched = vm.remote?.second
    val turnColor = colorOf(s, s.turnPlayerId)
    val ghosts = buildList {
      if (myTurn && vm.selectedTile != null) {
        val p = vm.preview
        val vals = vm.previewVals()
        s.you.frontier.forEach { f -> add(GhostCell(f.r, f.c, if (p != null && p.r == f.r && p.c == f.c) vals else null)) }
      }
      // a pedra que o outro jogador está segurando sobre o tabuleiro, na cor dele
      if (watched is Intent.Preview) add(GhostCell(watched.r, watched.c, watched.vals, owner = turnColor))
    }
    BoardCanvas(
      s.board,
      ghosts,
      camera,
      fitKey = s.round to s.board.isNotEmpty(),
      onTap = vm::tapCell,
      glowing = vm.celebration?.cells ?: emptySet(),
      modifier = Modifier.fillMaxSize(),
    )

    // faixa da vez
    val me = vm.me
    val turnName = s.players.firstOrNull { it.id == s.turnPlayerId }?.name
    val batedor = s.finalLap?.let { f -> s.players.firstOrNull { it.id == f.batedorId }?.name }
    val doing =
      when (watched) {
        is Intent.Pile -> " · comprando do monte"
        is Intent.Preview -> " · posicionando uma peça"
        is Intent.Select -> " · escolheu uma peça"
        else -> ""
      }
    val banner =
      when {
        s.phase != "playing" -> null
        me?.spectator == true -> "Você está assistindo · vez de $turnName$doing"
        batedor != null -> if (myTurn) "$batedor bateu! Sua última vez." else "$batedor bateu! Última vez de $turnName$doing."
        myTurn && vm.selectedTile == null -> if (s.board.isEmpty()) "Sua vez! Abra com a peça que quiser." else "Sua vez! Escolha uma peça."
        myTurn && vm.preview != null -> "Toque de novo para girar, depois Jogar."
        myTurn -> "Toque num espaço livre."
        else -> "Vez de $turnName$doing"
      }
    // adversários: a mão virada para baixo, na ordem da vez
    val inRound = s.phase == "playing" || s.phase == "roundOver"
    val seatsShown = inRound && vm.showSeats && s.players.count { !it.spectator } > 1
    // a faixa fica à direita do painel dos adversários, sem passar por cima dele
    val bannerMax = if (seatsShown) (this@BoxWithConstraints.maxWidth - 200.dp).coerceAtLeast(140.dp) else this@BoxWithConstraints.maxWidth - 24.dp
    Column(Modifier.align(Alignment.TopEnd).padding(12.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
      banner?.let {
        Text(
          it,
          color = if (myTurn) AccentInk else TextColor,
          fontWeight = if (myTurn) FontWeight.SemiBold else FontWeight.Normal,
          fontSize = 14.sp,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.widthIn(max = bannerMax).background(if (myTurn) Accent else Color(0x59000000), RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 6.dp),
        )
      }
      vm.notice?.let {
        Text(
          it,
          color = TextColor,
          fontSize = 14.sp,
          maxLines = 1,
          modifier = Modifier.background(Color(0x8C000000), CircleShape).border(1.dp, FeltLine, CircleShape).padding(horizontal = 14.dp, vertical = 6.dp),
        )
      }
    }

    if (seatsShown) Seats(s, watched, Modifier.align(Alignment.TopStart).padding(12.dp))

    Row(Modifier.align(Alignment.BottomEnd).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      if (inRound) IconChip(Icons.Rounded.Groups, "Adversários", active = vm.showSeats) { vm.showSeats = !vm.showSeats }
      IconChip(Icons.Rounded.FilterCenterFocus, "Centralizar tabuleiro") { camera.fit(s.board.map { it.r to it.c }, density) }
    }

    // pontos da jogada subindo da pedra
    for (f in vm.floats) androidx.compose.runtime.key(f.id) { FloatingPoints(f, camera) }
    vm.celebration?.let { Confetti(it) }

    if (s.phase != "playing") PhaseOverlay(vm, s)
  }
}

@Composable
private fun FloatingPoints(f: FloatPoints, camera: BoardCamera) {
  val rise = remember { Animatable(0f) }
  LaunchedEffect(f.id) { rise.animateTo(1f, tween(1600, easing = FastOutSlowInEasing)) }
  val at = camera.cellToScreen(f.r, f.c)
  val density = LocalDensity.current
  val t = rise.value
  Text(
    if (f.points < 0) "−${-f.points}" else "+${f.points}",
    color = if (f.points > 0) PointsPos else if (f.points < 0) PointsNeg else Muted,
    fontSize = 15.sp,
    fontWeight = FontWeight.ExtraBold,
    modifier =
      Modifier.offset { IntOffset((at.x - with(density) { 22.dp.toPx() }).roundToInt(), (at.y - with(density) { (14 + 46 * t).dp.toPx() }).roundToInt()) }
        .alpha(if (t < 0.12f) t / 0.12f else if (t > 0.7f) (1 - t) / 0.3f else 1f)
        .background(Color(0xC706140F), CircleShape)
        .padding(horizontal = 8.dp, vertical = 4.dp),
  )
}

/** Adversários empilhados à esquerda; quem joga ganha a borda dourada e a pedra que pegou fica levantada. */
@Composable
private fun Seats(s: GameState, watched: Intent?, modifier: Modifier) {
  val seated = s.players.filter { !it.spectator }
  val mine = seated.indexOfFirst { it.id == s.you.id }
  val others = if (mine < 0) seated else (seated.drop(mine + 1) + seated.take(mine))
  val lifted = when (watched) {
    is Intent.Select -> watched.index
    is Intent.Preview -> watched.index
    else -> null
  }
  var revealed by remember { mutableStateOf(setOf<String>()) }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (p in others) {
      val turn = p.id == s.turnPlayerId
      val owner = colorOf(s, p.id)
      Column(
        Modifier.alpha(if (p.out) 0.45f else 1f).widthIn(min = 120.dp, max = 170.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x59000000))
          .border(2.dp, if (turn) Accent else FeltLine, RoundedCornerShape(12.dp))
          .clickable { revealed = if (p.id in revealed) revealed - p.id else revealed + p.id }.padding(horizontal = 10.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
      ) {
        Text(p.name, color = TextColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Box(Modifier.width(30.dp).height(2.dp).background(owner))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          repeat(p.handCount) { k ->
            val up = turn && k == lifted
            TileBack(if (up) 21.dp else 18.dp, Modifier.offset(y = if (up) (-4).dp else 0.dp), glow = if (up) owner else null)
          }
        }
        if (p.id in revealed) {
          Text(
            if (p.out) "desistiu" else if (p.handCount == 1) "1 pedra" else "${p.handCount} pedras",
            color = AccentInk,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.background(Accent, CircleShape).padding(horizontal = 10.dp, vertical = 1.dp),
          )
        }
      }
    }
  }
}

// ---------------- comemoração ----------------

private data class Piece(var x: Float, var y: Float, var vx: Float, var vy: Float, var rot: Float, val vr: Float, val w: Float, val h: Float, val color: Color, val round: Boolean)

private val ConfettiColors = ValueColors.drop(1) + listOf(Accent, Color.White, Color(0xFFFF6FAE))

/** Dois lançadores de confete nos cantos de baixo da mesa disparam para o centro; o letreiro mostra os pontos. */
@Composable
private fun Confetti(cel: CelebrationView) {
  val density = LocalDensity.current.density
  val pieces = remember(cel.seq) { mutableListOf<Piece>() }
  var frame by remember(cel.seq) { mutableLongStateOf(0L) }
  var size by remember { mutableStateOf(Size.Zero) }
  LaunchedEffect(cel.seq) {
    val rnd = java.util.Random(cel.seq.toLong())
    var start = 0L
    var last = 0L
    while (true) {
      val now = withFrameNanos { it }
      if (start == 0L) start = now
      val ms = (now - start) / 1_000_000
      val dt = if (last == 0L) 0.016f else ((now - last) / 1e9f).coerceAtMost(0.05f)
      last = now
      if (ms > CELEBRATION_MS) break
      val w = size.width
      val h = size.height
      if (ms in 450..870 && w > 0) {
        for (side in 0..1) repeat(7) {
          val ang = Math.toRadians((if (side == 0) -60.0 else -120.0) + rnd.nextGaussian() * 14).toFloat()
          val speed = h * (1.1f + rnd.nextFloat() * 0.9f)
          pieces.add(
            Piece(
              if (side == 0) w * 0.06f else w * 0.94f, h * 0.96f, cos(ang) * speed, sin(ang) * speed, rnd.nextFloat() * 360f,
              (rnd.nextFloat() - 0.5f) * 720f, (6f + rnd.nextFloat() * 6f) * density, (4f + rnd.nextFloat() * 5f) * density,
              ConfettiColors[rnd.nextInt(ConfettiColors.size)], rnd.nextFloat() < 0.25f,
            )
          )
        }
      }
      for (p in pieces) {
        p.vy += h * 1.6f * dt
        p.vx *= 0.985f
        p.vy *= 0.985f
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
      }
      frame = now
    }
    pieces.clear()
    frame = -1
  }
  val pop = remember(cel.seq) { Animatable(0.6f) }
  LaunchedEffect(cel.seq) {
    delay(450)
    pop.animateTo(1f, tween(300))
  }
  Box(Modifier.fillMaxSize()) {
    Canvas(Modifier.fillMaxSize()) {
      size = this.size
      frame // redesenha a cada quadro
      for (p in pieces) {
        if (p.round) drawCircle(p.color, p.w / 2, Offset(p.x, p.y))
        else rotate(p.rot, Offset(p.x, p.y)) { drawRect(p.color, Offset(p.x - p.w / 2, p.y - p.h / 2), Size(p.w, p.h)) }
      }
    }
    if (pop.value > 0.61f)
      Text(
        cel.label,
        color = AccentInk,
        fontSize = 22.sp,
        fontWeight = FontWeight.ExtraBold,
        textAlign = TextAlign.Center,
        modifier = Modifier.align(Alignment.Center).padding(24.dp).scale(pop.value).clip(CircleShape).background(GoldGrad).padding(horizontal = 22.dp, vertical = 10.dp),
      )
  }
}

// ---------------- fora da partida: espera, sorteio, fim de rodada ----------------

@Composable
private fun OverlayCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier.widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Panel).border(1.dp, FeltLine, RoundedCornerShape(20.dp)).padding(22.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
    content = content,
  )
}

@Composable
private fun PhaseOverlay(vm: GameViewModel, s: GameState) {
  val summary = s.roundSummary
  val settle = (s.phase == "roundOver" || s.phase == "gameOver") && summary?.hands != null
  Box(
    Modifier.fillMaxSize().background(if (settle) Color(0xF0081812) else Scrim).clickable(enabled = false) {}.verticalScroll(rememberScrollState()).padding(16.dp),
    contentAlignment = Alignment.Center,
  ) {
    when {
      s.phase == "lottery" && s.lottery != null -> LotteryCard(vm, s)
      s.phase == "lobby" -> LobbyCard(vm, s)
      settle -> SettlementCard(vm, s)
      else -> EndCard(vm, s)
    }
  }
}

@Composable
private fun LobbyCard(vm: GameViewModel, s: GameState) {
  val seated = s.players.count { it.connected && !it.spectator }
  val context = LocalContext.current
  val clipboard = LocalClipboard.current
  val scope = rememberCoroutineScope()
  OverlayCard {
    Text(if (vm.isSpectator) "Você está assistindo" else "Esperando jogadores", color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    MutedText(if (seated < 2) "Só você está nesta sala. Os outros jogadores precisam entrar com o mesmo código:" else "$seated jogadores na sala.")
    // código em destaque + copiar link / WhatsApp
    Column(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(FeltDeep).border(1.dp, FeltLine, RoundedCornerShape(12.dp)).padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(s.room, color = Accent, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PillButton("Copiar link", Icons.Rounded.Link, Modifier.weight(1f)) {
          scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Mesa", vm.roomUrl))) }
          vm.showToast("Link da mesa copiado!")
        }
        PillButton("WhatsApp", WhatsappIcon, Modifier.weight(1f), iconTint = Whatsapp, borderColor = Whatsapp.copy(alpha = 0.5f)) { openWhatsapp(context, vm) }
      }
    }
    if (vm.isSpectator) {
      GoldButton(if (seated >= 4) "Mesa cheia" else "Sentar à mesa", vm::sit, Modifier.fillMaxWidth(), enabled = seated < 4)
      return@OverlayCard
    }
    val bots = s.players.filter { it.bot }
    if (bots.isNotEmpty() || s.you.canManageBots) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (bot in bots) {
          Row(
            Modifier.clip(CircleShape).background(Panel2).border(1.dp, FeltLine, CircleShape).padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            Text(bot.name, color = TextColor, fontSize = 14.sp)
            if (s.you.canManageBots)
              Icon(Icons.Rounded.Close, "Remover ${bot.name}", tint = Muted, modifier = Modifier.size(22.dp).clip(CircleShape).clickable { vm.removeBot(bot.id) }.padding(4.dp))
          }
        }
        if (s.you.canManageBots) DarkButton("+ Adicionar IA", vm::addBot, enabled = seated < 4)
      }
    }
    GoldButton(
      if (!vm.isHost) "Aguardando o anfitrião…" else if (seated < 2) "Precisa de 2 jogadores" else "Começar partida",
      vm::start,
      Modifier.fillMaxWidth(),
      enabled = vm.isHost && seated >= 2,
    )
  }
}

private fun openWhatsapp(context: android.content.Context, vm: GameViewModel) {
  val url = "https://wa.me/?text=" + Uri.encode(vm.inviteText())
  context.startActivity(AndroidIntent(AndroidIntent.ACTION_VIEW, Uri.parse(url)))
}

@Composable
private fun PillButton(
  text: String,
  icon: ImageVector,
  modifier: Modifier = Modifier,
  iconTint: Color = TextColor,
  borderColor: Color = FeltLine,
  onClick: () -> Unit,
) {
  Row(
    modifier.heightIn(min = 40.dp).clip(CircleShape).background(Panel2).border(1.dp, borderColor, CircleShape).clickable(onClick = onClick).padding(horizontal = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
  ) {
    Icon(icon, null, tint = iconTint, modifier = Modifier.size(18.dp))
    Text(text, color = TextColor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
  }
}

/** Sorteio: cada jogador escolhe uma pedra virada para baixo; a maior começa. */
@Composable
private fun LotteryCard(vm: GameViewModel, s: GameState) {
  val lot = s.lottery ?: return
  val mine = lot.picks.any { it.playerId == s.you.id }
  val seated = s.players.any { it.id == s.you.id && !it.spectator }
  val nameOf = { id: String -> s.players.firstOrNull { it.id == id }?.name ?: "?" }
  OverlayCard {
    Text("Sorteio", color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    MutedText(
      when {
        lot.winnerId != null -> "${nameOf(lot.winnerId)} tirou a maior pedra e começa!"
        mine || !seated -> "Aguardando os outros jogadores…"
        else -> "Escolha uma pedra. Quem tirar a maior começa."
      }
    )
    (0 until lot.slots).chunked(4).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        row.forEach { slot ->
          val pick = lot.picks.firstOrNull { it.slot == slot }
          val owner = pick?.let { colorOf(s, it.playerId) }
          val winner = pick != null && pick.playerId == lot.winnerId
          val canPick = pick == null && !mine && seated && lot.winnerId == null
          Box(
            Modifier.weight(1f).aspectRatio(1f / 1.05f).clip(RoundedCornerShape(12.dp))
              .background(if (pick != null) SolidColor(Panel2) else Brush.linearGradient(listOf(Color(0xFF2B6B52), Color(0xFF174634))))
              .border(if (winner) 3.dp else if (pick != null) 2.dp else 1.dp, if (winner) Accent else owner ?: FeltLine, RoundedCornerShape(12.dp))
              .alpha(if (pick == null && !canPick) 0.6f else 1f)
              .clickable(enabled = canPick) { vm.pickLot(slot) }.padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 18.dp),
            contentAlignment = Alignment.Center,
          ) {
            BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
              if (pick != null) PipTile(pick.tile.v, maxWidth * 0.86f) else TileBack(maxWidth * 0.8f)
            }
          }
        }
        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
      }
      // nomes de quem tirou cada pedra
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.offset(y = (-10).dp)) {
        row.forEach { slot ->
          val pick = lot.picks.firstOrNull { it.slot == slot }
          Text(pick?.let { nameOf(it.playerId) } ?: "", color = TextColor, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        }
        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
  }
}

@Composable
private fun EndCard(vm: GameViewModel, s: GameState) {
  OverlayCard {
    if (s.phase == "roundOver") {
      val w = s.players.firstOrNull { it.id == s.roundSummary?.winnerId }
      Text("Fim da rodada ${s.round}", color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.Bold)
      MutedText(w?.let { "${it.name} levou +${s.roundSummary!!.points}. Meta: ${s.targetScore} pontos." } ?: "")
      GoldButton(if (vm.isHost) "Próxima rodada" else "Aguardando o anfitrião…", vm::nextRound, Modifier.fillMaxWidth(), enabled = vm.isHost)
    } else {
      val champ = s.players.firstOrNull { it.id == s.winnerId } ?: s.players.maxBy { it.score }
      Text("🏆 ${champ.name} venceu!", color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.Bold)
      MutedText("${champ.score} pontos.")
      GoldButton(if (vm.isHost) "Nova partida" else "Aguardando o anfitrião…", vm::start, Modifier.fillMaxWidth(), enabled = vm.isHost)
    }
  }
}

/** Conferência da batida: as mãos de cada adversário viram, a soma vai para quem bateu, passo a passo. */
@Composable
private fun SettlementCard(vm: GameViewModel, s: GameState) {
  val sum = s.roundSummary ?: return
  val hands = sum.hands.orEmpty()
  val key = "${s.round}:${sum.winnerId}"
  // passos: 0 título, depois por jogador (linha, pedras, soma, transferência), total e placar
  var step by remember(key) { mutableIntStateOf(-1) }
  var tilesShown by remember(key) { mutableIntStateOf(0) }
  LaunchedEffect(key) {
    delay(if (vm.celebration != null) CELEBRATION_MS else 400)
    step = 0
    delay(1200)
    for (i in hands.indices) {
      step = 1 + i * 3
      tilesShown = 0
      delay(600)
      for (t in hands[i].tiles.indices) {
        tilesShown = t + 1
        delay(550)
      }
      step = 2 + i * 3
      delay(900)
      step = 3 + i * 3
      delay(1300)
    }
    step = 1 + hands.size * 3
    delay(1100)
    step = 2 + hands.size * 3
  }
  if (step < 0) return
  val name = { id: String? -> s.players.firstOrNull { it.id == id }?.name ?: "?" }
  val bonus = sum.bonus ?: 25
  val transferred = hands.filterIndexed { i, _ -> step >= 3 + i * 3 }.sumOf { it.sum }
  OverlayCard {
    Text("🎉 ${name(sum.winnerId)} bateu!", color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    SettleRow(colorOf(s, sum.winnerId), highlight = true) {
      Text(name(sum.winnerId), color = TextColor, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        "${signed(bonus)} por bater" + hands.filterIndexed { i, _ -> step >= 3 + i * 3 }.joinToString("") { " ${signed(it.sum)}" },
        color = Accent,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
      )
      if (step >= 1 + hands.size * 3) Text(" = ${signed(bonus + transferred)}", color = Accent, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
    hands.forEachIndexed { i, h ->
      if (step < 1 + i * 3) return@forEachIndexed
      SettleRow(colorOf(s, h.playerId)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(name(h.playerId), color = TextColor, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (h.tiles.isEmpty()) MutedText("sem pedras na mão", size = 13)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            h.tiles.take(if (step > 1 + i * 3) h.tiles.size else tilesShown).forEach { PipTile(it, 52.dp) }
          }
        }
        if (step >= 2 + i * 3 && h.tiles.isNotEmpty()) Text("= ${h.sum}", color = TextColor, fontSize = 16.sp)
        if (step >= 3 + i * 3 && h.tiles.isNotEmpty()) Text(" ${signed(-h.sum)}", color = PointsNeg, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
      }
    }
    if (step >= 2 + hands.size * 3) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        s.players.filter { !it.spectator }.sortedByDescending { it.score }.forEach { p ->
          Column(Modifier.clip(CircleShape).background(Panel2).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              Text(p.name, color = TextColor, fontSize = 14.sp)
              Text("${p.score}", color = TextColor, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
            Box(Modifier.fillMaxWidth().height(2.dp).background(colorOf(s, p.id)))
          }
        }
      }
      if (s.phase == "roundOver") {
        MutedText("Meta: ${s.targetScore} pontos.", Modifier.align(Alignment.CenterHorizontally))
        GoldButton(if (vm.isHost) "Próxima rodada" else "Aguardando o anfitrião…", vm::nextRound, Modifier.fillMaxWidth(), enabled = vm.isHost)
      } else {
        val champ = s.players.firstOrNull { it.id == s.winnerId } ?: s.players.maxBy { it.score }
        MutedText("🏆 ${champ.name} venceu a partida com ${champ.score} pontos!", Modifier.align(Alignment.CenterHorizontally))
        GoldButton(if (vm.isHost) "Nova partida" else "Aguardando o anfitrião…", vm::start, Modifier.fillMaxWidth(), enabled = vm.isHost)
      }
    }
  }
}

@Composable
private fun SettleRow(owner: Color, highlight: Boolean = false, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel2)
      .then(if (highlight) Modifier.border(1.dp, Accent, RoundedCornerShape(14.dp)) else Modifier),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.width(4.dp).heightIn(min = 52.dp).background(owner))
    Row(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), content = content)
  }
}

// ---------------- monte ----------------

/** Aleatório com semente (o mesmo da Web): a mesma rodada sempre espalha as pedras do mesmo jeito. */
private fun seeded(text: String): () -> Float {
  var h = 2166136261L.toInt()
  for (ch in text) h = (h xor ch.code) * 16777619
  return {
    h += 0x6d2b79f5
    var t = (h xor (h ushr 15)) * (1 or h)
    t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
    ((t xor (t ushr 14)).toUInt().toDouble() / 4294967296.0).toFloat()
  }
}

private data class Spot(val x: Float, val y: Float, val rot: Float)

/** Uma casa para cada pedra numa grade frouxa, com folga para girar sem encostar (web/src/drawPile.ts). */
private fun scatter(key: String, n: Int, w: Float, h: Float): Pair<List<Spot>, Float> {
  if (n == 0) return emptyList<Spot>() to 0f
  val rand = seeded(key)
  val slack = 1.35f
  val cols = max(1, sqrt(n * slack * w / h).roundToInt())
  val rows = max(1, ceil(n * slack / cols).toInt())
  val cellW = w / cols
  val cellH = h / rows
  val tile = max(28f, min(70f * (w / 360f).coerceAtLeast(1f), min(cellW, cellH) / 1.22f))
  val room = tile * (1.22f / 2f)
  val jx = max(0f, cellW / 2f - room)
  val jy = max(0f, cellH / 2f - room)
  val cells = (0 until cols * rows).toMutableList()
  for (i in cells.size - 1 downTo 1) {
    val j = (rand() * (i + 1)).toInt()
    cells[i] = cells[j].also { cells[j] = cells[i] }
  }
  return cells.take(n).map { cell ->
    val cx = ((cell % cols) + 0.5f) * cellW + (rand() * 2 - 1) * jx
    val cy = ((cell / cols) + 0.5f) * cellH + (rand() * 2 - 1) * jy
    Spot(cx, cy, (rand() * 360).roundToInt().toFloat())
  } to tile
}

@Composable
private fun PileDialog(vm: GameViewModel, s: GameState) {
  val pile = vm.pile ?: return
  val owner = PlayerColors[pile.owner.coerceAtLeast(0) % 4]
  Dialog(onDismissRequest = vm::closePile, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Column(
      Modifier.padding(16.dp).widthIn(max = 720.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Panel).border(1.dp, FeltLine, RoundedCornerShape(20.dp)).padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
          Text(pile.watching?.let { "$it está comprando" } ?: "Escolha uma pedra do monte", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
          val left = s.you.drawsLeft ?: 1
          MutedText(
            when {
              pile.watching != null && pile.picked != null -> "${pile.watching} escolheu esta pedra…"
              pile.watching != null -> "${pile.watching} está escolhendo uma pedra do monte"
              else -> "${if (left == 1) "Última compra" else "Até $left compras"} nesta vez · cada uma custa 5 pontos"
            },
            size = 13,
          )
        }
        IconChip(Icons.Rounded.Close, "Fechar", onClick = vm::closePile)
      }
      BoxWithConstraints(
        Modifier.fillMaxWidth().aspectRatio(4f / 5f).clip(RoundedCornerShape(14.dp))
          .background(Brush.radialGradient(listOf(Color(0xFF24654B), Color(0xFF123D2E), Color(0xFF0D3022))))
      ) {
        val density = LocalDensity.current
        val wPx = with(density) { maxWidth.toPx() } * 0.92f
        val hPx = with(density) { maxHeight.toPx() } * 0.92f
        val (spots, tilePx) = remember(vm.pileSpread, wPx, hPx) { scatter("${vm.pileSpread.first}:${vm.pileSpread.second}", vm.pileSpread.second, wPx, hPx) }
        val tileDp = with(density) { tilePx.toDp() }
        val pickedSpot = pile.picked?.let { vm.pileAlive.getOrNull(it) }
        val revealing = pile.drawn != null
        Box(Modifier.fillMaxSize().padding(maxWidth * 0.04f)) {
          for (spot in vm.pileAlive) {
            val sp = spots.getOrNull(spot) ?: continue
            val picked = spot == pickedSpot
            val lift by animateDpAsState(if (picked) (-12).dp else 0.dp, label = "lift")
            Box(
              Modifier.offset { IntOffset((sp.x - tilePx / 2).roundToInt(), (sp.y - tilePx / 2).roundToInt()) }
                .offset(y = lift).scale(if (picked) 1.22f else 1f).rotate(sp.rot).alpha(if (revealing) 0.35f else 1f)
                .clickable(enabled = pile.watching == null && pile.picked == null && !revealing) { vm.pickPile(spot) }
            ) {
              TileBack(tileDp, glow = if (picked) (if (pile.watching != null) owner else Accent) else null)
            }
          }
        }
        if (revealing) {
          Column(
            Modifier.fillMaxSize().background(Color(0x8C06140F)),
            verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
          ) {
            val drawn = pile.drawn
            Text(if (pile.drawnBy != null) "${pile.drawnBy} comprou esta pedra" else "Você comprou", color = if (pile.drawnBy != null) owner else Accent, fontWeight = FontWeight.Bold)
            if (drawn.isEmpty()) TileBack(90.dp, glow = owner) else PipTile(drawn, 120.dp)
          }
        }
      }
    }
  }
}

// ---------------- câmeras e ferramentas ----------------

@Composable
private fun Side(vm: GameViewModel, s: GameState?, columns: Int, landscape: Boolean, modifier: Modifier) {
  val mesh = vm.mesh ?: return
  val context = LocalContext.current
  var showCameras by remember { mutableStateOf(true) }
  val scrollMod = if (landscape) Modifier.verticalScroll(rememberScrollState()) else Modifier
  Column(
    modifier.background(Panel).border(BorderStroke(1.dp, FeltLine.copy(alpha = 0.6f))).then(scrollMod).padding(10.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    if (vm.inCall && showCameras) {
      val entries = buildList {
        add(Triple(vm.myId, mesh.localVideo, true))
        vm.remoteVideos.forEach { (id, track) -> add(Triple(id, track, false)) }
      }
      val rowCols = if (landscape) columns else entries.size.coerceIn(1, columns)
      entries.chunked(rowCols).forEach { row ->
        Row(
          horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
          modifier = Modifier.fillMaxWidth().then(if (!landscape) Modifier.heightIn(max = 112.dp) else Modifier),
        ) {
          row.forEach { (id, track, self) ->
            val p = s?.players?.firstOrNull { it.id == id }
            val seat = s?.players?.filter { !it.spectator }?.indexOfFirst { it.id == id } ?: -1
            val turn = s?.turnPlayerId == id
            val ring = if (turn) Accent else if (seat >= 0) PlayerColors[seat % 4] else Color.White.copy(alpha = 0.18f)
            Box(Modifier.weight(1f).aspectRatio(4f / 3f).clip(RoundedCornerShape(10.dp)).background(Color(0xFF071A13)).border(if (turn) 3.dp else 2.dp, ring, RoundedCornerShape(10.dp))) {
              if (track != null && (!self || vm.videoOn)) VideoView(track, mesh.egl, mirror = self, modifier = Modifier.fillMaxSize())
              else Box(Modifier.align(Alignment.Center)) { Initial(p?.name ?: "?", color = if (seat >= 0) PlayerColors[seat % 4] else Panel2, size = 28.dp) }
              val role = when {
                p == null -> null
                p.spectator -> "Espectador"
                p.isHost -> "Anfitrião"
                else -> null
              }
              role?.let {
                Text(
                  it,
                  color = Color.White,
                  fontSize = 9.sp,
                  fontWeight = FontWeight.SemiBold,
                  modifier = Modifier.align(Alignment.TopStart).padding(4.dp).background(if (p?.spectator == true) Color(0x8C000000) else lerpDark(ring), RoundedCornerShape(6.dp)).padding(horizontal = 5.dp),
                )
              }
              if (vm.isHost && p?.spectator == true && p.inCall)
                Icon(Icons.Rounded.Close, "Tirar da conversa", tint = Color.White, modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).size(20.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x8C000000)).clickable { vm.endCall(id) }.padding(3.dp))
              Text(
                (p?.name ?: "…") + if (self) " (você)" else "",
                color = Color.White,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.BottomStart).padding(4.dp).background(Color(0x8C000000), RoundedCornerShape(6.dp)).padding(horizontal = 5.dp),
              )
            }
          }
          if (landscape) repeat(rowCols - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      if (vm.inCall) {
        ToolButton(if (vm.audioOn) Icons.Rounded.Mic else Icons.Rounded.MicOff, "Microfone", off = !vm.audioOn, enabled = mesh.localAudio != null, onClick = vm::toggleAudio, modifier = Modifier.weight(1f))
        ToolButton(if (vm.videoOn) Icons.Rounded.Videocam else Icons.Rounded.VideocamOff, "Câmera", off = !vm.videoOn, enabled = mesh.localVideo != null, onClick = vm::toggleVideo, modifier = Modifier.weight(1f))
        ToolButton(Icons.Rounded.Cameraswitch, "Virar", enabled = mesh.localVideo != null && vm.videoOn, onClick = vm::switchCamera, modifier = Modifier.weight(1f))
        if (!landscape) {
          ToolButton(if (showCameras) Icons.Rounded.ExpandMore else Icons.Rounded.ExpandLess, if (showCameras) "Ocultar vídeos" else "Mostrar vídeos", onClick = { showCameras = !showCameras })
        }
      }
      if (!vm.isSpectator) ToolButton(WhatsappIcon, "Convidar", iconTint = Whatsapp, onClick = { openWhatsapp(context, vm) }, modifier = Modifier.weight(1f))
      if (vm.isSpectator) {
        val me = vm.me
        DarkButton(
          when {
            vm.inCall -> "Sair da conversa"
            me?.callRequested == true -> "Cancelar pedido"
            else -> "✋ Pedir para entrar na conversa"
          },
          { if (vm.inCall || me?.callRequested == true) vm.leaveCall() else vm.requestCall() },
          Modifier.weight(1f),
        )
      }
    }
    if (vm.isSpectator) ToolButton(WhatsappIcon, "Convidar", iconTint = Whatsapp, onClick = { openWhatsapp(context, vm) }, modifier = Modifier.fillMaxWidth(), showLabel = true)
    // anfitrião: espectadores pedindo para entrar na conversa
    if (s != null && vm.isHost) s.players.filter { it.spectator && it.connected && it.callRequested }.forEach { p ->
      Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Panel2).border(1.dp, Accent, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("✋ ${p.name}${if (p.guest) " (convidado)" else ""} quer entrar na conversa", color = TextColor, fontSize = 13.sp, modifier = Modifier.weight(1f))
        TextButton({ vm.answerCall(p.id, allow = true) }) { Text("Permitir", color = Accent) }
        TextButton({ vm.answerCall(p.id, allow = false) }) { Text("Recusar", color = Muted) }
      }
    }
  }
}

private fun lerpDark(c: Color) = androidx.compose.ui.graphics.lerp(c, Color.Black, 0.25f)

/** Botão de mídia (`.tool` da Web): ícone verde, vermelho quando desligado. */
@Composable
private fun ToolButton(
  icon: ImageVector,
  label: String,
  modifier: Modifier = Modifier,
  off: Boolean = false,
  enabled: Boolean = true,
  iconTint: Color = ToolIcon,
  showLabel: Boolean = false,
  onClick: () -> Unit,
) {
  Row(
    modifier.height(44.dp).alpha(if (enabled) 1f else 0.45f).clip(RoundedCornerShape(12.dp))
      .background(if (off) SolidColor(Danger) else Brush.verticalGradient(listOf(Color(0xFF1F4637), Panel2)))
      .border(1.dp, Color.White.copy(alpha = if (off) 0.18f else 0.08f), RoundedCornerShape(12.dp))
      .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
  ) {
    Icon(icon, label, tint = if (off) Color.White else iconTint, modifier = Modifier.size(22.dp))
    if (showLabel) Text(label, color = TextColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
  }
}

// ---------------- mão ----------------

@Composable
private fun Dock(vm: GameViewModel, s: GameState?) {
  // sem pedras na mão (espera, sorteio): a barra não aparece
  val hand = vm.orderedHand
  if (s == null || vm.isSpectator || hand.isEmpty()) return
  val myTurn = vm.isMyTurn
  val haptic = LocalHapticFeedback.current
  val shake = remember { Animatable(0f) }
  LaunchedEffect(vm.errorSeq) {
    if (vm.errorSeq > 0) {
      haptic.performHapticFeedback(HapticFeedbackType.LongPress)
      for (dx in listOf(-10f, 10f, -8f, 8f, -4f, 0f)) {
        shake.animateTo(dx, tween(45))
      }
    }
  }
  Column(
    Modifier.fillMaxWidth().offset(x = shake.value.dp).background(if (myTurn) DockMine else Panel)
      .border(BorderStroke(1.dp, if (myTurn) DockMineLine else FeltLine)).padding(horizontal = 12.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    val listState = rememberLazyListState()
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      LazyRow(
        state = listState,
        modifier = Modifier.weight(1f),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 4.dp),
      ) {
        items(hand, key = { it.id }) { t ->
          val selected = t.id == vm.selectedTile
          val lift by animateDpAsState(if (selected) (-4).dp else 0.dp, label = "lift")
          Box(
            Modifier.offset(y = lift).width(HAND_TILE + 8.dp).clip(RoundedCornerShape(12.dp)).background(if (selected) Accent.copy(alpha = 0.12f) else Color.Transparent)
              .border(2.dp, if (selected) Accent else Color.Transparent, RoundedCornerShape(12.dp))
              .clickable {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                vm.selectTile(t.id)
              }
              .padding(4.dp),
            contentAlignment = Alignment.Center,
          ) {
            PipTile(t.v, HAND_TILE)
          }
        }
      }
      if (hand.size >= 2) {
        IconChip(Icons.Rounded.SwapVert, "Ordenar pedras da mão") {
          haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
          vm.sortHand()
        }
      }
    }
    // ações: só as possíveis agora; se sobrar uma só, ela fica maior
    val actions = buildList {
      if (vm.preview != null) add("rotate")
      if (vm.preview != null) add("play")
      if (s.you.canDraw) add("draw")
      if (s.you.canPass) add("pass")
    }
    if (actions.isNotEmpty()) {
      val solo = actions.size == 1
      val drawsLeft = s.you.drawsLeft ?: 1
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (a in actions) {
          val m = Modifier.weight(1f)
          when (a) {
            "rotate" ->
              ActionButton("Girar", m, icon = Icons.AutoMirrored.Rounded.RotateRight, solo = solo) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                vm.rotate()
              }
            "play" ->
              ActionButton("Jogar", m, primary = true, solo = solo) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                vm.play()
              }
            "draw" -> ActionButton(if (drawsLeft > 1) "Comprar ($drawsLeft)" else "Comprar", m, solo = solo, onClick = vm::openPile)
            "pass" -> ActionButton("Passar", m, solo = solo) { vm.pass() }
          }
        }
      }
    }
  }
}

@Composable
private fun ActionButton(text: String, modifier: Modifier, icon: ImageVector? = null, primary: Boolean = false, solo: Boolean = false, onClick: () -> Unit) {
  val gold = primary || solo
  Row(
    modifier.heightIn(min = if (solo) 52.dp else 44.dp).clip(CircleShape)
      .background(if (gold) SolidColor(Accent) else SolidColor(Panel2))
      .then(if (gold) Modifier else Modifier.border(1.dp, FeltLine, CircleShape))
      .clickable(onClick = onClick).padding(horizontal = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
  ) {
    icon?.let { Icon(it, null, tint = if (gold) AccentInk else TextColor, modifier = Modifier.size(18.dp)) }
    Text(
      text,
      color = if (gold) AccentInk else TextColor,
      fontWeight = FontWeight.SemiBold,
      fontSize = if (solo) 17.sp else 14.sp,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

// ---------------- histórico, folha de pontos, tokens e espectadores ----------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LogSheet(vm: GameViewModel, s: GameState, onClose: () -> Unit) {
  ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Panel) {
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("Histórico da partida", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
      val list = rememberLazyListState()
      LaunchedEffect(vm.log.size) { if (vm.log.isNotEmpty()) list.scrollToItem(vm.log.size - 1) }
      LazyColumn(state = list, modifier = Modifier.heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        itemsIndexed(vm.log) { _, e -> LogLine(e) }
        if (vm.log.isEmpty()) item { MutedText("Nada ainda.") }
      }
    }
  }
}

private val LogPipColors = listOf(Color(0xFF3A3A3A), Color(0xFFD96518), Color(0xFF1A843E), Color(0xFF1A5EA8), Color(0xFFB58900), Color(0xFFC82822))

@Composable
private fun LogLine(e: LogEntry) {
  FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
    if (e.actor != null) {
      Text("${e.actor} ${e.action}${if (e.tile != null) ":" else ""}", color = TextColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    } else {
      Text(e.action, color = Muted, fontSize = 13.sp)
    }
    e.tile?.let { vals ->
      Text(
        buildAnnotatedString {
          vals.forEachIndexed { i, n ->
            if (i > 0) withStyle(SpanStyle(color = Color(0xFF6B5D43))) { append("-") }
            withStyle(SpanStyle(color = LogPipColors.getOrElse(n) { Color(0xFF3A3A3A) })) { append("$n") }
          }
        },
        fontSize = 13.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = Modifier.background(Color(0xFFF3EAD6), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
      )
    }
    e.points?.let { Text(if (it < 0) "−${-it}" else "+$it", color = if (it > 0) PointsPos else if (it < 0) PointsNeg else Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
    e.note?.let { Text("($it)", color = Muted, fontSize = 13.sp) }
  }
}

/** Folha de pontos, como a anotada no papel: rodadas alinhadas entre as colunas e bônus de vitória em destaque. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScoreSheet(s: GameState, onClose: () -> Unit) {
  ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Panel) {
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("Folha de pontos", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
      val cols = s.scoreSheet.filter { c -> s.players.any { it.id == c.playerId && !it.spectator } }
      val maxRound = cols.flatMap { it.marks }.maxOfOrNull { it.round } ?: 0
      if (maxRound == 0) {
        MutedText("Os totais de cada jogador vão sendo anotados aqui a cada jogada.")
      } else {
        Column(
          Modifier.fillMaxWidth().heightIn(max = 460.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFF6EFDC))
            .verticalScroll(rememberScrollState()).padding(10.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (col in cols) {
              val p = s.players.firstOrNull { it.id == col.playerId }
              Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                  p?.name ?: "?",
                  color = Color(0xFF1B2A24),
                  fontWeight = FontWeight.Bold,
                  fontSize = 14.sp,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                  textDecoration = if (p?.out == true) TextDecoration.LineThrough else null,
                )
                Box(Modifier.fillMaxWidth().height(2.dp).background(colorOf(s, col.playerId)))
              }
            }
          }
          for (r in 1..maxRound) {
            Text("Rodada $r", color = Color(0xFF8A7B5C), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              for (col in cols) {
                val roundMarks = col.marks.withIndex().filter { it.value.round == r }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                  for ((idx, m) in roundMarks) {
                    val last = idx == col.marks.lastIndex
                    Text(
                      "${m.total}",
                      color = if (m.roundWin) Color(0xFF8C5800) else Color(0xFF1B2A24),
                      fontSize = 15.sp,
                      fontWeight = if (last || m.roundWin) FontWeight.ExtraBold else FontWeight.Normal,
                      textDecoration = if (last) null else TextDecoration.LineThrough,
                      modifier =
                        if (m.roundWin) Modifier.border(1.5.dp, Color(0xFFD4941C), CircleShape).padding(horizontal = 7.dp, vertical = 1.dp)
                        else Modifier,
                    )
                  }
                }
              }
            }
          }
        }
      }
      MutedText("Meta: ${s.targetScore} pontos.", size = 13)
    }
  }
}

/** Registro de tokens gastos pelos jogadores IA na partida, igual ao painel Tokens da Web. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TokensSheet(s: GameState, onClose: () -> Unit) {
  val log = s.tokens ?: return
  val fmt = NumberFormat.getIntegerInstance(Locale.forLanguageTag("pt-BR"))
  ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Panel) {
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("Tokens dos jogadores IA", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
      val t = log.totals
      Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(FeltDeep).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
          "${fmt.format(t.total)} tokens em ${t.calls} ${if (t.calls == 1) "chamada" else "chamadas"}",
          color = Accent,
          fontSize = 15.sp,
          fontWeight = FontWeight.Bold,
        )
        MutedText(
          "Entrada ${fmt.format(t.prompt)} · saída ${fmt.format(t.completion)}${if (t.reasoning > 0) " (raciocínio ${fmt.format(t.reasoning)})" else ""} · Modelo: ${log.model}",
          size = 12,
        )
      }
      val list = rememberLazyListState()
      LaunchedEffect(log.entries.size) { if (log.entries.isNotEmpty()) list.scrollToItem(log.entries.size - 1) }
      LazyColumn(state = list, modifier = Modifier.heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(log.entries) { _, e ->
          Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Panel2).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              MutedText("R${e.round}", size = 12)
              Text(e.bot, color = TextColor, fontWeight = FontWeight.Bold, fontSize = 13.sp)
              Text(
                e.tile.joinToString("-"),
                color = Color(0xFF6B5D43),
                fontSize = 12.sp,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.background(Color(0xFFF3EAD6), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp),
              )
              Text(signed(e.points), color = if (e.points < 0) PointsNeg else PointsPos, fontSize = 13.sp, fontWeight = FontWeight.Bold)
              Spacer(Modifier.weight(1f))
              Text(if (e.total > 0) "${fmt.format(e.total)} tokens" else "0 tokens", color = Muted, fontSize = 12.sp)
            }
            val details = buildList {
              add(if (e.source == "ia") "IA escolheu" else "melhor pontuação")
              e.note?.takeIf { it.isNotBlank() }?.let(::add)
              if (e.total > 0) add("entrada ${fmt.format(e.prompt)} · saída ${fmt.format(e.completion)}${if (e.reasoning > 0) " (rac. ${fmt.format(e.reasoning)})" else ""}")
              if (e.ms > 0) add(String.format(Locale.forLanguageTag("pt-BR"), "%.1f s", e.ms / 1000.0))
            }
            MutedText(details.joinToString(" · "), size = 12)
          }
        }
        if (log.entries.isEmpty()) item { MutedText("Nenhuma jogada de IA ainda.") }
      }
    }
  }
}

/** Lista de espectadores assistindo à mesa e controle de participação na conversa pelo anfitrião. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpectatorsSheet(vm: GameViewModel, s: GameState, onClose: () -> Unit) {
  val watchers = s.players.filter { it.spectator && it.connected }
  ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Panel) {
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("Assistindo à mesa (${watchers.size})", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold)
      if (watchers.isEmpty()) {
        MutedText("Ninguém assistindo no momento.")
      } else {
        for (p in watchers) {
          Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Panel2).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Initial(p.name, color = Felt, size = 28.dp)
            Column(Modifier.weight(1f)) {
              Text(p.name + if (p.id == s.you.id) " (você)" else "", color = TextColor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
              MutedText(
                when {
                  p.inCall -> "Na conversa de vídeo"
                  p.callRequested -> "Pediu para entrar na conversa"
                  else -> "Só assistindo"
                },
                size = 12,
              )
            }
            if (vm.isHost && p.callRequested) {
              TextButton({ vm.answerCall(p.id, allow = true) }) { Text("Permitir", color = Accent) }
              TextButton({ vm.answerCall(p.id, allow = false) }) { Text("Recusar", color = Muted) }
            } else if (vm.isHost && p.inCall) {
              TextButton({ vm.endCall(p.id) }) { Text("Tirar da conversa", color = Color(0xFFFFB3AA)) }
            }
          }
        }
      }
    }
  }
}
