package com.example.trimino.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.trimino.net.GameState
import com.example.trimino.net.Tile

@Composable
fun TriminoApp(vm: GameViewModel) {
  Box(Modifier.fillMaxSize().background(FeltDeep)) {
    if (vm.joined) GameScreen(vm) else LobbyScreen(vm)
    vm.toast?.let { msg ->
      Text(
        msg,
        color = Color.White,
        modifier =
          Modifier.align(Alignment.BottomCenter).padding(bottom = 140.dp, start = 16.dp, end = 16.dp)
            .background(Color(0xCC000000), RoundedCornerShape(10.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
      )
    }
  }
}

// ---------------- lobby ----------------

@Composable
fun LobbyScreen(vm: GameViewModel) {
  var withMedia by rememberSaveable { mutableStateOf(true) }
  val permissions =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
      vm.join(withAudio = granted[Manifest.permission.RECORD_AUDIO] == true, withVideo = granted[Manifest.permission.CAMERA] == true)
    }
  Box(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), contentAlignment = Alignment.Center) {
    Column(
      Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(20.dp)).border(1.dp, FeltLine, RoundedCornerShape(20.dp)).padding(24.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      val measurer = rememberTextMeasurer()
      Canvas(Modifier.size(64.dp, 56.dp)) {
        val s = size.width
        drawTriangle(measurer, listOf(s / 2 to 0f, s to size.height, 0f to size.height), listOf(5, 3, 1), Accent)
      }
      Text("Triminó", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Color.White)
      Text("Dominó triangular com vídeo, para 2 a 4 jogadores.", color = Muted)
      OutlinedTextField(vm.name, { vm.name = it.take(24) }, label = { Text("Seu nome") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(
        vm.room,
        { vm.room = it.uppercase().take(12) },
        label = { Text("Sala") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(vm.serverUrl, { vm.serverUrl = it }, label = { Text("Servidor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Checkbox(withMedia, { withMedia = it })
        Text("Entrar com câmera e microfone", color = Color.White)
      }
      Button(
        onClick = {
          if (withMedia) permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA))
          else vm.join(withAudio = false, withVideo = false)
        },
        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF2B1D00)),
        modifier = Modifier.fillMaxWidth().height(48.dp),
      ) {
        Text("Entrar", fontWeight = FontWeight.SemiBold)
      }
    }
  }
}

// ---------------- partida ----------------

@Composable
fun GameScreen(vm: GameViewModel) {
  val s = vm.state
  BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
    val landscape = maxWidth > maxHeight
    Column(Modifier.fillMaxSize()) {
      TopBar(vm, s)
      if (landscape) {
        Row(Modifier.weight(1f)) {
          BoardArea(vm, s, Modifier.weight(1f).fillMaxHeight())
          VideoGrid(vm, s, columns = 2, modifier = Modifier.width(260.dp).fillMaxHeight().background(Panel).padding(6.dp))
        }
      } else {
        VideoGrid(vm, s, columns = 4, modifier = Modifier.fillMaxWidth().background(Panel).padding(6.dp))
        BoardArea(vm, s, Modifier.weight(1f).fillMaxWidth())
      }
      Dock(vm, s)
    }
  }
}

@Composable
private fun TopBar(vm: GameViewModel, s: GameState?) {
  Row(
    Modifier.fillMaxWidth().background(Panel).padding(horizontal = 10.dp, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text("Sala ${s?.room ?: vm.room}", color = Color.White, fontWeight = FontWeight.SemiBold)
    if (!vm.online) Text("reconectando…", color = Danger, fontSize = 12.sp)
    LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
      items(s?.players ?: emptyList(), key = { it.id }) { p ->
        val seat = s!!.players.indexOf(p)
        val turn = p.id == s.turnPlayerId
        Row(
          Modifier.clip(CircleShape).background(Panel2).border(1.dp, if (turn) Accent else Color.Transparent, CircleShape)
            .padding(horizontal = 10.dp, vertical = 4.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
          Box(Modifier.size(9.dp).background(if (p.spectator) Color.Gray else PlayerColors[seat % 4], CircleShape))
          Text(p.name + if (p.isHost) " ★" else "", color = if (p.connected) Color.White else Muted, fontSize = 13.sp, maxLines = 1)
          Text("${p.score}", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
          if (!p.spectator) Text("${p.handCount}▲", color = Muted, fontSize = 12.sp)
        }
      }
    }
    Text("⏏", color = Muted, fontSize = 18.sp, modifier = Modifier.clickable { vm.leave() }.padding(4.dp))
  }
}

@Composable
private fun BoardArea(vm: GameViewModel, s: GameState?, modifier: Modifier) {
  Box(modifier) {
    if (s == null) return@Box
    val myTurn = vm.isMyTurn
    val colorOf = { id: String -> PlayerColors[s.players.indexOfFirst { it.id == id }.coerceAtLeast(0) % 4] }
    val ghosts =
      if (!myTurn || vm.selectedTile == null) emptyList()
      else {
        val pm = vm.previewMove()
        vm.movesFor(vm.selectedTile).distinctBy { it.r to it.c }.map { m ->
          GhostCell(m.r, m.c, if (pm != null && pm.r == m.r && pm.c == m.c) pm.vals else null)
        }
      }
    BoardCanvas(s.board, ghosts, colorOf, fitKey = s.round to s.board.isEmpty(), onTap = vm::tapCell, modifier = Modifier.fillMaxSize())

    val turnName = s.players.firstOrNull { it.id == s.turnPlayerId }?.name
    val banner =
      when {
        s.phase != "playing" -> null
        myTurn && s.openingTileId != null -> "Sua vez! Coloque a peça de abertura."
        myTurn && vm.selectedTile == null -> "Sua vez! Escolha uma peça."
        myTurn && vm.preview != null -> "Toque de novo para girar, depois Jogar."
        myTurn -> "Toque num espaço destacado."
        else -> "Vez de $turnName"
      }
    banner?.let {
      Text(
        it,
        color = if (myTurn) Color(0xFF2B1D00) else Color.White,
        fontWeight = if (myTurn) FontWeight.SemiBold else FontWeight.Normal,
        fontSize = 14.sp,
        modifier =
          Modifier.align(Alignment.TopCenter).padding(top = 10.dp)
            .background(if (myTurn) Accent else Color(0x59000000), CircleShape).padding(horizontal = 14.dp, vertical = 6.dp),
      )
    }
    Text(
      if (s.phase == "lobby") "Aguardando" else "Monte: ${s.poolCount}",
      color = Color.White,
      fontSize = 12.sp,
      modifier = Modifier.align(Alignment.BottomEnd).padding(10.dp).background(Color(0x40000000), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
    )
    if (s.phase != "playing") PhaseCard(vm, s, Modifier.align(Alignment.Center))
  }
}

@Composable
private fun PhaseCard(vm: GameViewModel, s: GameState, modifier: Modifier) {
  val isHost = s.players.firstOrNull { it.id == s.you.id }?.isHost == true
  val connected = s.players.count { it.connected }
  val (title, body, action) =
    when (s.phase) {
      "lobby" -> Triple("Esperando jogadores", "$connected na sala ${s.room}. Peça aos amigos para entrar com esse código.", "Começar partida")
      "roundOver" -> {
        val w = s.players.firstOrNull { it.id == s.roundSummary?.winnerId }
        Triple("Fim da rodada ${s.round}", w?.let { "${it.name} levou +${s.roundSummary!!.points}. Meta: ${s.targetScore} pontos." } ?: "", "Próxima rodada")
      }
      else -> {
        val champ = s.players.maxBy { it.score }
        Triple("🏆 ${champ.name} venceu!", "${champ.score} pontos.", "Nova partida")
      }
    }
  Column(
    modifier.padding(16.dp).background(Panel, RoundedCornerShape(20.dp)).border(1.dp, FeltLine, RoundedCornerShape(20.dp)).padding(24.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    Text(body, color = Muted)
    Button(
      onClick = { if (s.phase == "roundOver") vm.nextRound() else vm.start() },
      enabled = isHost && (s.phase != "lobby" || connected >= 2),
      colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF2B1D00)),
    ) {
      Text(if (isHost) action else "Aguardando o anfitrião…")
    }
  }
}

@Composable
private fun Dock(vm: GameViewModel, s: GameState?) {
  if (s == null) return
  val myTurn = vm.isMyTurn
  val playable = remember(s) { s.you.validMoves.map { it.tileId }.toSet() }
  Column(Modifier.fillMaxWidth().background(Panel).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      items(s.you.hand, key = { it.id }) { t ->
        HandTile(t, selected = t.id == vm.selectedTile, dim = myTurn && t.id !in playable) { vm.selectTile(t.id) }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      val secondary = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
      val border = BorderStroke(1.dp, FeltLine)
      OutlinedButton(vm::rotate, enabled = vm.previewMoves().size > 1, colors = secondary, border = border, modifier = Modifier.weight(1f)) { Text("⟳ Girar") }
      Button(
        vm::play,
        enabled = vm.previewMove() != null,
        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF2B1D00)),
        modifier = Modifier.weight(1f),
      ) {
        Text("Jogar", fontWeight = FontWeight.SemiBold)
      }
      OutlinedButton({ vm.draw() }, enabled = s.you.canDraw, colors = secondary, border = border, modifier = Modifier.weight(1f)) { Text("Comprar") }
      OutlinedButton({ vm.pass() }, enabled = s.you.canPass, colors = secondary, border = border, modifier = Modifier.weight(1f)) { Text("Passar") }
    }
  }
}

@Composable
private fun HandTile(tile: Tile, selected: Boolean, dim: Boolean, onClick: () -> Unit) {
  val measurer = rememberTextMeasurer()
  Box(
    Modifier.width(60.dp).clip(RoundedCornerShape(10.dp))
      .background(if (selected) Accent.copy(alpha = 0.15f) else Color.Transparent)
      .border(2.dp, if (selected) Accent else Color.Transparent, RoundedCornerShape(10.dp))
      .clickable(onClick = onClick).padding(5.dp)
  ) {
    Canvas(Modifier.fillMaxWidth().aspectRatio(1f / 0.866f)) {
      val k = size.width / EDGE
      scale(k, k, androidx.compose.ui.geometry.Offset.Zero) {
        drawTriangle(measurer, listOf(EDGE / 2 to 0f, EDGE to EDGE * 0.866f, 0f to EDGE * 0.866f), tile.v, Color(0xFFD9CCAB))
      }
      if (dim) drawRect(Panel.copy(alpha = 0.6f))
    }
  }
}

@Composable
private fun VideoGrid(vm: GameViewModel, s: GameState?, columns: Int, modifier: Modifier) {
  val mesh = vm.mesh ?: return
  val entries = buildList {
    add(Triple(vm.myId, mesh.localVideo, true))
    vm.remoteVideos.forEach { (id, track) -> add(Triple(id, track, false)) }
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    entries.chunked(columns).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        row.forEach { (id, track, self) ->
          val p = s?.players?.firstOrNull { it.id == id }
          val seat = s?.players?.indexOf(p) ?: -1
          val ring = if (s?.turnPlayerId == id) Accent else if (seat >= 0) PlayerColors[seat % 4] else Color.Transparent
          Box(Modifier.weight(1f).aspectRatio(4f / 3f).clip(RoundedCornerShape(10.dp)).background(Color(0xFF071A13)).border(2.dp, ring, RoundedCornerShape(10.dp))) {
            if (track != null && (!self || vm.videoOn)) VideoView(track, mesh.egl, mirror = self, modifier = Modifier.fillMaxSize())
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
        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      MediaToggle("🎤", vm.audioOn, enabled = mesh.localAudio != null, onClick = vm::toggleAudio, modifier = Modifier.weight(1f))
      MediaToggle("📷", vm.videoOn, enabled = mesh.localVideo != null, onClick = vm::toggleVideo, modifier = Modifier.weight(1f))
      MediaToggle("🔄", true, enabled = mesh.localVideo != null, onClick = vm::switchCamera, modifier = Modifier.weight(1f))
    }
  }
}

@Composable
private fun MediaToggle(label: String, on: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier) {
  Box(
    modifier.height(34.dp).clip(RoundedCornerShape(10.dp)).background(if (on || !enabled) Panel2 else Danger)
      .border(1.dp, FeltLine, RoundedCornerShape(10.dp)).clickable(enabled = enabled, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Text(label, color = Color.White.copy(alpha = if (enabled) 1f else 0.4f))
  }
}
