package com.example.trimino.net

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * WebSocket com reconexão automática; reenvia o `join` a cada conexão. Callbacks chegam na main thread.
 * `http` é o cliente da [Api]: leva o cookie da sessão, e o servidor reconhece a conta na mesa.
 */
class GameSocket(
  http: OkHttpClient,
  private val url: String,
  private val join: ClientMessage.Join,
  private val onMessage: (ServerMessage) -> Unit,
  private val onStatus: (Boolean) -> Unit,
  /** A mesa recusou a entrada (ex.: convidado numa mesa vazia); não adianta tentar de novo. */
  private val onRefused: (String) -> Unit,
) {
  private val client = http.newBuilder().pingInterval(20, TimeUnit.SECONDS).build()
  private val main = Handler(Looper.getMainLooper())
  private var ws: WebSocket? = null
  private var retry = 0
  @Volatile private var closed = false

  init {
    open()
  }

  private fun open() {
    if (closed) return
    ws =
      client.newWebSocket(
        // Cada mesa é um objeto no servidor: a sala vai na URL, além do `join`.
        Request.Builder().url("$url${if ('?' in url) '&' else '?'}sala=${URLEncoder.encode(join.room, "UTF-8")}").build(),
        object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) {
            retry = 0
            main.post { onStatus(true) }
            webSocket.send(ProtocolJson.encodeToString<ClientMessage>(join))
          }

          override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = runCatching { ProtocolJson.decodeFromString<ServerMessage>(text) }.getOrElse {
              Log.w(TAG, "mensagem ignorada: $text", it)
              return
            }
            main.post { onMessage(msg) }
          }

          override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
          }

          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket, code, reason)

          override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "falha no websocket", t)
            lost(webSocket, -1)
          }
        },
      )
  }

  private fun lost(socket: WebSocket, code: Int, reason: String = "") {
    if (socket !== ws) return
    main.post { onStatus(false) }
    // 4000: mesma identidade conectou em outro lugar; 4003: convidado tentando abrir uma mesa vazia.
    if (code == 4000) main.post { onRefused("Você entrou nesta sala em outro aparelho ou janela.") }
    if (code == 4003) main.post { onRefused(reason) }
    if (closed || code == 4000 || code == 4003) return
    val delay = minOf(10_000L, 500L shl minOf(retry++, 5))
    main.postDelayed(::open, delay)
  }

  fun send(msg: ClientMessage) {
    ws?.send(ProtocolJson.encodeToString<ClientMessage>(msg))
  }

  fun close() {
    closed = true
    main.removeCallbacksAndMessages(null)
    ws?.close(1000, null)
  }

  private companion object {
    const val TAG = "GameSocket"
  }
}
