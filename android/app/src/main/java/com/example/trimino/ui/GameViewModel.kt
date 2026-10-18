package com.example.trimino.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.trimino.net.Api
import com.example.trimino.net.ClientMessage
import com.example.trimino.net.GameSocket
import com.example.trimino.net.GameState
import com.example.trimino.net.Intent
import com.example.trimino.net.LogEntry
import com.example.trimino.net.ProtocolJson
import com.example.trimino.net.ServerMessage
import com.example.trimino.rtc.Mesh
import java.util.UUID
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack

data class Preview(val r: Int, val c: Int, val rot: Int)

/** Valores da peça nos vértices da célula para a rotação 0..2 (igual a shared/tiles.ts). */
fun rotated(v: List<Int>, rot: Int): List<Int> = List(3) { v[(it + rot) % 3] }

/** "+12" ou "−5" subindo da pedra jogada. */
data class FloatPoints(val id: Long, val r: Int, val c: Int, val points: Int)

/** Ponte, mandala ou batida: as pedras brilham e o letreiro mostra os pontos. */
data class CelebrationView(val seq: Int, val label: String, val cells: Set<Pair<Int, Int>>)

/**
 * O monte aberto: o seu (para comprar) ou o de outro jogador (só olhando). `picked`: a pedra escolhida
 * (posição no monte); `drawn`: a pedra que acabou de sair (a sua aparece de frente).
 */
data class PileView(val watching: String? = null, val owner: Int = 0, val picked: Int? = null, val drawn: List<Int>? = null, val drawnBy: String? = null)

const val CELEBRATION_MS = 3600L

class GameViewModel(app: Application) : AndroidViewModel(app) {
  private val prefs = app.getSharedPreferences("trimino", Context.MODE_PRIVATE)

  var room by mutableStateOf("")
    private set
  /** Link da mesa, para o convite. */
  var roomUrl by mutableStateOf("")
    private set
  /** A mesa recusou a entrada; quem mostra o motivo é a varanda. */
  var refused by mutableStateOf<String?>(null)

  var joined by mutableStateOf(false)
    private set
  var online by mutableStateOf(false)
    private set
  var state by mutableStateOf<GameState?>(null)
    private set
  var myId by mutableStateOf("")
    private set
  var selectedTile by mutableStateOf<Int?>(null)
    private set
  var preview by mutableStateOf<Preview?>(null)
    private set
  var toast by mutableStateOf<String?>(null)
    private set
  /** Aviso no alto da mesa (ex.: "Ana comprou 2 pedras"). */
  var notice by mutableStateOf<String?>(null)
    private set
  var audioOn by mutableStateOf(false)
    private set
  var videoOn by mutableStateOf(false)
    private set
  /** Na videoconferência: jogadores sempre; espectadores só com a permissão do anfitrião. */
  var inCall by mutableStateOf(false)
    private set

  /** O que o jogador da vez está fazendo (outro jogador). */
  var remote by mutableStateOf<Pair<String, Intent>?>(null)
    private set
  var pile by mutableStateOf<PileView?>(null)
    private set
  /** Posições (casas) das pedras que ainda estão no monte, na ordem do monte no servidor. */
  var pileAlive by mutableStateOf<List<Int>>(emptyList())
    private set
  /** Quantas pedras o monte tinha quando foi espalhado (define as casas). */
  var pileSpread by mutableStateOf("" to 0)
    private set
  var celebration by mutableStateOf<CelebrationView?>(null)
    private set
  val floats = mutableStateListOf<FloatPoints>()
  /** Histórico da partida (o servidor manda as últimas linhas; aqui ficam todas). */
  val log = mutableStateListOf<LogEntry>()
  var showSeats by mutableStateOf(true)

  val remoteVideos = mutableStateMapOf<String, VideoTrack>()

  private var socket: GameSocket? = null
  var mesh: Mesh? = null
    private set

  private val clientId: String =
    prefs.getString("clientId", null) ?: UUID.randomUUID().toString().also { prefs.edit { putString("clientId", it) } }

  /** Senta à mesa `code` (ou só assiste, com `watch`). Com conta, o servidor usa o nome da conta. */
  fun join(api: Api, code: String, watch: Boolean, name: String, withAudio: Boolean, withVideo: Boolean) {
    if (joined) return
    room = code
    roomUrl = api.mesaUrl(code)
    refused = null
    val m = Mesh(getApplication(), viewModelScope, { to, data -> socket?.send(ClientMessage.Signal(to, data)) }) { id, track ->
      if (track == null) remoteVideos.remove(id) else remoteVideos[id] = track
    }
    m.startLocal(withAudio, withVideo)
    audioOn = m.localAudio != null
    videoOn = m.localVideo != null
    mesh = m
    socket =
      GameSocket(api.client, api.wsUrl, ClientMessage.Join(code, name, clientId, watch), ::onMessage, onStatus = { online = it }) { reason ->
        leave()
        refused = reason.ifBlank { "Não foi possível entrar nessa mesa." }
      }
    joined = true
  }

  private fun onMessage(msg: ServerMessage) {
    when (msg) {
      is ServerMessage.Welcome -> {
        myId = msg.you
        mesh?.iceServers = msg.iceServers
        mesh?.closeAll()
        inCall = msg.inCall
        msg.peers.forEach { mesh?.call(it) }
      }
      is ServerMessage.Call -> {
        inCall = true
        msg.peers.forEach { mesh?.call(it) }
      }
      is ServerMessage.CallEnded -> {
        inCall = false
        mesh?.closeAll()
        remoteVideos.clear()
      }
      is ServerMessage.Notice -> showToast(msg.message)
      is ServerMessage.Signal -> mesh?.onSignal(msg.from, msg.data)
      is ServerMessage.PeerLeft -> mesh?.close(msg.id)
      is ServerMessage.PlayerIntent -> {
        remote = if (msg.intent is Intent.Idle) null else msg.from to msg.intent
        syncWatchedPile()
      }
      is ServerMessage.State -> onState(msg.state)
      is ServerMessage.Error -> showToast(msg.message)
    }
  }

  // ---------------- estado ----------------

  private var seenCells: Set<Pair<Int, Int>>? = null
  private var lastRound = -1
  private var seenLog: List<String> = emptyList()
  private var seenCelebration: Int? = null
  private var floatSeq = 0L

  private fun onState(s: GameState) {
    val prev = state
    state = s
    val myTurn = isMyTurn
    if (selectedTile != null && s.you.hand.none { it.id == selectedTile }) selectedTile = null
    val p = preview
    if (!myTurn || selectedTile == null || (p != null && !isFrontier(p.r, p.c))) preview = null
    // o que o outro jogador está fazendo vale só enquanto a vez for dele
    remote?.let { (from, _) -> if (from != s.turnPlayerId || myTurn) remote = null }

    // pedras novas nesta rodada (para os pontos que sobem delas)
    val cells = s.board.map { it.r to it.c }.toSet()
    val placed = seenCells?.takeIf { s.round == lastRound }?.let { seen -> s.board.filter { (it.r to it.c) !in seen } } ?: emptyList()
    seenCells = cells

    // comemoração de ponte/mandala/batida
    var celebrated: String? = null
    val cel = s.celebration
    if (cel != null && seenCelebration != null && cel.seq > seenCelebration!!) {
      val who = s.players.firstOrNull { it.id == cel.playerId }?.name ?: ""
      val kinds = cel.formations.map { it.kind }.distinct().joinToString(" + ") { if (it == "ponte") "PONTE" else "MANDALA" }
      val label = if (cel.batida) "$who bateu!${if (kinds.isNotEmpty()) " $kinds" else ""} +${cel.points}" else "${if (who.isNotEmpty()) "$who: " else ""}$kinds! +${cel.points}"
      if (cel.batida) showNotice("$who bateu!")
      celebrated = cel.playerId
      val view = CelebrationView(cel.seq, label, cel.formations.flatMap { f -> f.cells.map { it.r to it.c } }.toSet())
      celebration = view
      viewModelScope.launch {
        delay(CELEBRATION_MS)
        if (celebration == view) celebration = null
      }
    }
    seenCelebration = cel?.seq ?: 0

    // histórico: só acrescenta as linhas novas
    val keys = s.log.map { ProtocolJson.encodeToString(LogEntry.serializer(), it) }
    var overlap = minOf(seenLog.size, keys.size)
    while (overlap > 0 && seenLog.takeLast(overlap) != keys.take(overlap)) overlap--
    val fresh = s.log.drop(overlap)
    if (s.round != lastRound && lastRound != -1 && s.round == 1) log.clear()
    log.addAll(fresh)
    val me = s.players.firstOrNull { it.id == s.you.id }
    if (seenLog.isNotEmpty()) {
      for (e in fresh) if (e.action == "comprou uma peça" && e.actor != null && e.actor != me?.name) notifyDraw(e.actor)
      for (b in placed) {
        if (b.by == celebrated) continue
        val who = s.players.firstOrNull { it.id == b.by }?.name
        val entry = fresh.firstOrNull { it.action == "jogou" && it.actor == who && it.tile?.sorted() == b.vals.sorted() }
        entry?.points?.let { addFloat(b.r, b.c, it) }
      }
    }
    seenLog = keys
    lastRound = s.round

    syncPile(s, prev)
    syncIntent()
  }

  private fun addFloat(r: Int, c: Int, points: Int) {
    val f = FloatPoints(++floatSeq, r, c, points)
    viewModelScope.launch {
      delay(250)
      floats.add(f)
      delay(1600)
      floats.remove(f)
    }
  }

  private var drawNotice = "" to 0
  private var noticeJob: Job? = null

  private fun notifyDraw(actor: String) {
    drawNotice = if (drawNotice.first == actor && notice != null) actor to drawNotice.second + 1 else actor to 1
    val n = drawNotice.second
    showNotice(if (n == 1) "$actor comprou uma pedra" else "$actor comprou $n pedras")
  }

  private fun showNotice(text: String) {
    notice = text
    noticeJob?.cancel()
    noticeJob = viewModelScope.launch {
      delay(2600)
      notice = null
    }
  }

  val isMyTurn: Boolean
    get() = state?.let { it.phase == "playing" && it.turnPlayerId == it.you.id } ?: false

  // Sem dicas: qualquer espaço livre encostado no jogo pode ser tentado; o servidor decide se encaixa.
  fun isFrontier(r: Int, c: Int): Boolean = state?.you?.frontier?.any { it.r == r && it.c == c } == true

  /** Números da prévia nos vértices da célula, ou null sem prévia. */
  fun previewVals(): List<Int>? {
    val p = preview ?: return null
    val tile = state?.you?.hand?.firstOrNull { it.id == selectedTile } ?: return null
    return rotated(tile.v, p.rot)
  }

  fun selectTile(id: Int) {
    selectedTile = if (selectedTile == id) null else id
    preview = null
    syncIntent()
  }

  fun tapCell(r: Int, c: Int) {
    if (selectedTile == null || !isMyTurn || !isFrontier(r, c)) return
    val p = preview
    preview = if (p != null && p.r == r && p.c == c) p.copy(rot = (p.rot + 1) % 3) else Preview(r, c, 0)
    syncIntent()
  }

  fun rotate() {
    preview = preview?.let { it.copy(rot = (it.rot + 1) % 3) }
    syncIntent()
  }

  /** Envia a jogada; se não encaixar, o servidor responde com erro e a prévia continua para girar. */
  fun play() {
    val p = preview ?: return
    val tile = selectedTile ?: return
    socket?.send(ClientMessage.Place(tile, p.r, p.c, p.rot))
  }

  // ---------------- intenção: o que você está fazendo, para os outros acompanharem ----------------

  private var sentIntent: Intent? = null

  private fun syncIntent() {
    val s = state ?: return
    val myTurn = isMyTurn
    val hand = s.you.hand
    val index = hand.indexOfFirst { it.id == selectedTile }
    val tile = hand.getOrNull(index)
    val p = preview
    val intent =
      when {
        !myTurn -> Intent.Idle
        pile != null && pile?.watching == null -> Intent.Pile(pickedSlot)
        p != null && tile != null -> Intent.Preview(index, p.r, p.c, p.rot, rotated(tile.v, p.rot))
        index >= 0 -> Intent.Select(index)
        else -> Intent.Idle
      }
    if (intent == sentIntent) return
    sentIntent = intent
    if (myTurn) socket?.send(ClientMessage.SendIntent(intent))
  }

  // ---------------- monte ----------------

  /** A sua compra em andamento: a mão de antes e a posição escolhida. */
  private var pending: Pair<Set<Int>, Int>? = null
  private var pendingJob: Job? = null
  /** Última pedra que outro jogador escolheu, para tirar a certa quando a compra chegar. */
  private var remoteSlot: Int? = null
  /** Quem olhava fechou o monte: fica fechado até o jogador abrir de novo. */
  private var pileDismissed = false

  private val pickedSlot: Int?
    get() = pending?.second

  fun openPile() {
    val s = state ?: return
    if (!s.you.canDraw) return
    pile = PileView()
    syncIntent()
  }

  fun closePile() {
    if (pile?.watching != null) pileDismissed = true
    pending = null
    pendingJob?.cancel()
    pile = null
    syncIntent()
  }

  /** Escolheu a pedra da casa `spot`. */
  fun pickPile(spot: Int) {
    val s = state ?: return
    val slot = pileAlive.indexOf(spot)
    if (pending != null || pile?.watching != null || slot < 0) return
    pending = s.you.hand.map { it.id }.toSet() to slot
    pile = pile?.copy(picked = slot)
    pendingJob = viewModelScope.launch {
      // sem resposta: libera para tentar de novo
      delay(4000)
      pending = null
      pile = pile?.copy(picked = null)
      syncIntent()
    }
    syncIntent()
    socket?.send(ClientMessage.Draw(slot))
  }

  private fun syncPile(s: GameState, prev: GameState?) {
    // rodada nova ou monte que cresceu (alguém desistiu): espalha de novo
    val round = "${s.room}:${s.round}"
    if (pileSpread.first != round || s.poolCount > pileAlive.size) {
      pileSpread = round to s.poolCount
      pileAlive = List(s.poolCount) { it }
    }
    val mine = pending
    if (mine != null) {
      val drawn = s.you.hand.firstOrNull { it.id !in mine.first }
      if (drawn != null) {
        pileAlive = pileAlive.toMutableList().also { if (mine.second < it.size) it.removeAt(mine.second) }
        pending = null
        pendingJob?.cancel()
        pile = pile?.copy(picked = null, drawn = drawn.v, drawnBy = null)
        viewModelScope.launch {
          delay(1200)
          pile = null
          syncIntent()
        }
      }
    }
    if (pileAlive.size > s.poolCount) {
      val alive = pileAlive.toMutableList()
      var removed = false
      while (alive.size > s.poolCount) {
        val r = remoteSlot
        if (r != null && r < alive.size) alive.removeAt(r) else alive.removeAt(alive.size - 1)
        remoteSlot = null
        removed = true
      }
      pileAlive = alive
      // quem olhava vê a pedra saindo do monte
      val w = pile?.watching
      if (removed && w != null) {
        pile = pile?.copy(picked = null, drawn = emptyList(), drawnBy = w)
        viewModelScope.launch {
          delay(1200)
          if (pile?.drawnBy != null) pile = pile?.copy(drawn = null, drawnBy = null)
        }
      }
    }
    if (pile != null && pile?.watching == null && mine == null && pile?.drawn == null && !s.you.canDraw) pile = null
    if (prev?.turnPlayerId != s.turnPlayerId) pileDismissed = false
    syncWatchedPile()
  }

  /** Outro jogador abriu o monte: os demais veem o mesmo monte, só olhando. */
  private fun syncWatchedPile() {
    val s = state ?: return
    val r = remote
    val intent = r?.second
    if (intent is Intent.Pile && pile?.watching == null && pile != null) return // o seu está aberto
    if (intent is Intent.Pile) {
      intent.slot?.let { remoteSlot = it }
      if (pileDismissed) return
      val who = s.players.indexOfFirst { it.id == r.first }
      val name = s.players.getOrNull(who)?.name ?: "?"
      if (pile?.drawnBy == null) pile = (pile ?: PileView(watching = name, owner = who)).copy(watching = name, owner = who, picked = intent.slot)
    } else if (pile?.watching != null) {
      if (pile?.drawnBy != null) viewModelScope.launch {
        delay(1200)
        if (remote?.second !is Intent.Pile && pile?.watching != null) pile = null
      }
      else pile = null
      pileDismissed = false
    }
  }

  fun pickLot(slot: Int) = socket?.send(ClientMessage.PickLot(slot))

  fun pass() = socket?.send(ClientMessage.Pass)

  fun start() = socket?.send(ClientMessage.Start)

  fun addBot() = socket?.send(ClientMessage.AddBot)

  fun removeBot(id: String) = socket?.send(ClientMessage.RemoveBot(id))

  fun nextRound() = socket?.send(ClientMessage.NextRound)

  fun removePlayer(id: String) = socket?.send(ClientMessage.RemovePlayer(id))

  fun restartRound() = socket?.send(ClientMessage.RestartRound)

  fun restartGame() = socket?.send(ClientMessage.RestartGame)

  /** Espectador: ocupa um lugar livre (fora de partida). */
  fun sit() = socket?.send(ClientMessage.Sit)

  fun requestCall() = socket?.send(ClientMessage.RequestCall)

  fun leaveCall() = socket?.send(ClientMessage.LeaveCall)

  fun answerCall(id: String, allow: Boolean) = socket?.send(ClientMessage.AnswerCall(id, allow))

  fun endCall(id: String) = socket?.send(ClientMessage.EndCall(id))

  val me
    get() = state?.let { s -> s.players.firstOrNull { it.id == s.you.id } }

  val isSpectator: Boolean
    get() = me?.spectator ?: false

  val isHost: Boolean
    get() = me?.isHost ?: false

  /** Texto do convite, o mesmo que o site manda pelo WhatsApp. */
  fun inviteText(): String {
    val title = state?.title?.takeIf { it.isNotBlank() }
    return "Bora jogar Triminó? Entra ${title?.let { "na mesa \"$it\"" } ?: "na minha mesa"}: $roomUrl"
  }

  fun toggleAudio() {
    audioOn = !audioOn
    mesh?.setEnabled("audio", audioOn)
  }

  fun toggleVideo() {
    videoOn = !videoOn
    mesh?.setEnabled("video", videoOn)
  }

  fun switchCamera() {
    mesh?.switchCamera()
  }

  /** Está jogando uma partida em andamento (sair conta como desistência). */
  val inMatch: Boolean
    get() = state?.let { s ->
      val me = s.players.firstOrNull { it.id == s.you.id }
      s.phase != "lobby" && s.phase != "gameOver" && me != null && !me.spectator && !me.out
    } ?: false

  /** Botão "Sair": durante a partida, desiste (os outros continuam) e volta à varanda. */
  fun quit() {
    if (inMatch) socket?.send(ClientMessage.Forfeit)
    // dá tempo de a mensagem sair antes de fechar a conexão
    viewModelScope.launch {
      delay(200)
      leave()
    }
  }

  fun leave() {
    socket?.close()
    socket = null
    mesh?.release()
    mesh = null
    remoteVideos.clear()
    state = null
    selectedTile = null
    preview = null
    inCall = false
    joined = false
    online = false
    remote = null
    pile = null
    pending = null
    celebration = null
    floats.clear()
    log.clear()
    seenCells = null
    seenLog = emptyList()
    seenCelebration = null
    lastRound = -1
    sentIntent = null
    pileSpread = "" to 0
    pileAlive = emptyList()
  }

  fun showToast(text: String) {
    toast = text
    viewModelScope.launch {
      delay(3000)
      if (toast == text) toast = null
    }
  }

  override fun onCleared() {
    leave()
  }
}
