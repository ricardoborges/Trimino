package com.example.trimino.net

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** WebSocket com reconexão automática; reenvia o `join` a cada conexão. Callbacks chegam na main thread. */
class GameSocket(
  private val url: String,
  private val join: ClientMessage.Join,
  private val onMessage: (ServerMessage) -> Unit,
  private val onStatus: (Boolean) -> Unit,
) {
  private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
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
        Request.Builder().url(url).build(),
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

          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket, code)

          override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "falha no websocket", t)
            lost(webSocket, -1)
          }
        },
      )
  }

  private fun lost(socket: WebSocket, code: Int) {
    if (socket !== ws) return
    main.post { onStatus(false) }
    if (closed || code == 4000) return
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
    client.dispatcher.executorService.shutdown()
  }

  private companion object {
    const val TAG = "GameSocket"
  }
}
