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
import com.example.trimino.net.ClientMessage
import com.example.trimino.net.GameSocket
import com.example.trimino.net.GameState
import com.example.trimino.net.ServerMessage
import com.example.trimino.rtc.Mesh
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack

data class Preview(val r: Int, val c: Int, val rot: Int)

/** Valores da peça nos vértices da célula para a rotação 0..2 (igual a shared/tiles.ts). */
fun rotated(v: List<Int>, rot: Int): List<Int> = List(3) { v[(it + rot) % 3] }

class GameViewModel(app: Application) : AndroidViewModel(app) {
  private val prefs = app.getSharedPreferences("trimino", Context.MODE_PRIVATE)

  var name by mutableStateOf(prefs.getString("name", "") ?: "")
  var room by mutableStateOf(prefs.getString("room", "") ?: "")
  var serverUrl by mutableStateOf(prefs.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER)

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
  var audioOn by mutableStateOf(false)
    private set
  var videoOn by mutableStateOf(false)
    private set

  val remoteVideos = mutableStateMapOf<String, VideoTrack>()
  val chat = mutableStateListOf<String>()

  private var socket: GameSocket? = null
  var mesh: Mesh? = null
    private set

  private val clientId: String =
    prefs.getString("clientId", null) ?: UUID.randomUUID().toString().also { prefs.edit { putString("clientId", it) } }

  fun join(withAudio: Boolean, withVideo: Boolean) {
    if (joined) return
    val code = room.uppercase().filter { it.isLetterOrDigit() }.take(12)
    if (name.isBlank() || code.isBlank()) return showToast("Informe nome e sala.")
    room = code
    prefs.edit {
      putString("name", name.trim())
      putString("room", code)
      putString("server", serverUrl.trim())
    }
    val m = Mesh(getApplication(), viewModelScope, { to, data -> socket?.send(ClientMessage.Signal(to, data)) }) { id, track ->
      if (track == null) remoteVideos.remove(id) else remoteVideos[id] = track
    }
    m.startLocal(withAudio, withVideo)
    audioOn = m.localAudio != null
    videoOn = m.localVideo != null
    mesh = m
    socket = GameSocket(serverUrl.trim(), ClientMessage.Join(code, name.trim(), clientId), ::onMessage) { online = it }
    joined = true
  }

  private fun onMessage(msg: ServerMessage) {
    when (msg) {
      is ServerMessage.Welcome -> {
        myId = msg.you
        mesh?.iceServers = msg.iceServers
        mesh?.closeAll()
        msg.peers.forEach { mesh?.call(it) }
      }
      is ServerMessage.Signal -> mesh?.onSignal(msg.from, msg.data)
      is ServerMessage.PeerLeft -> mesh?.close(msg.id)
      is ServerMessage.State -> onState(msg.state)
      is ServerMessage.Chat -> {
        chat += "${msg.name}: ${msg.text}"
        if (chat.size > 30) chat.removeAt(0)
        if (msg.from != myId) showToast("${msg.name}: ${msg.text}")
      }
      is ServerMessage.Error -> showToast(msg.message)
    }
  }

  private fun onState(s: GameState) {
    state = s
    val myTurn = isMyTurn
    if (selectedTile != null && s.you.hand.none { it.id == selectedTile }) selectedTile = null
    val p = preview
    if (!myTurn || selectedTile == null || (p != null && !isFrontier(p.r, p.c))) preview = null
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
  }

  fun tapCell(r: Int, c: Int) {
    if (selectedTile == null || !isMyTurn || !isFrontier(r, c)) return
    val p = preview
    preview = if (p != null && p.r == r && p.c == c) p.copy(rot = (p.rot + 1) % 3) else Preview(r, c, 0)
  }

  fun rotate() {
    preview = preview?.let { it.copy(rot = (it.rot + 1) % 3) }
  }

  /** Envia a jogada; se não encaixar, o servidor responde com erro e a prévia continua para girar. */
  fun play() {
    val p = preview ?: return
    val tile = selectedTile ?: return
    socket?.send(ClientMessage.Place(tile, p.r, p.c, p.rot))
  }

  fun pickLot(slot: Int) = socket?.send(ClientMessage.PickLot(slot))

  fun draw() = socket?.send(ClientMessage.Draw)

  fun pass() = socket?.send(ClientMessage.Pass)

  fun start() = socket?.send(ClientMessage.Start)

  fun addBot() = socket?.send(ClientMessage.AddBot)

  fun removeBot(id: String) = socket?.send(ClientMessage.RemoveBot(id))

  fun nextRound() = socket?.send(ClientMessage.NextRound)

  fun sendChat(text: String) {
    if (text.isNotBlank()) socket?.send(ClientMessage.Chat(text.take(300)))
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

  /** Botão "Sair": durante a partida, desiste (os outros continuam) e volta ao lobby. */
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
    joined = false
    online = false
  }

  private fun showToast(text: String) {
    toast = text
    viewModelScope.launch {
      delay(3000)
      if (toast == text) toast = null
    }
  }

  override fun onCleared() {
    leave()
  }

  companion object {
    /** 10.0.2.2 é o localhost da máquina host visto de dentro do emulador. */
    const val DEFAULT_SERVER = "ws://10.0.2.2:8080/ws"
  }
}
