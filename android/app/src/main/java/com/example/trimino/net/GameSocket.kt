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
  private var connected = false
  private var lastRx = 0L
  @Volatile private var closed = false

  private val connectTimeout = Runnable {
    val cur = ws ?: return@Runnable
    if (!connected && !closed) {
      cur.cancel()
    }
  }

  private val pingTask = object : Runnable {
    override fun run() {
      val cur = ws ?: return
      if (!connected || closed) return
      if (System.currentTimeMillis() - lastRx > PONG_TIMEOUT_MS) {
        cur.cancel()
        return
      }
      cur.send(ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Ping))
      main.postDelayed(this, PING_INTERVAL_MS)
    }
  }

  init {
    open()
  }

  private fun open() {
    if (closed) return
    main.removeCallbacks(connectTimeout)
    main.removeCallbacks(pingTask)
    connected = false
    val socket =
      client.newWebSocket(
        // Cada mesa é um objeto no servidor: a sala vai na URL, além do `join`.
        Request.Builder().url("$url${if ('?' in url) '&' else '?'}sala=${URLEncoder.encode(join.room, "UTF-8")}").build(),
        object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) {
            main.post {
              if (webSocket !== ws || closed) return@post
              main.removeCallbacks(connectTimeout)
              retry = 0
              connected = true
              lastRx = System.currentTimeMillis()
              onStatus(true)
              webSocket.send(ProtocolJson.encodeToString<ClientMessage>(join))
              main.postDelayed(pingTask, PING_INTERVAL_MS)
            }
          }

          override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = runCatching { ProtocolJson.decodeFromString<ServerMessage>(text) }.getOrElse {
              Log.w(TAG, "mensagem ignorada: $text", it)
              return
            }
            main.post {
              if (webSocket !== ws || closed) return@post
              lastRx = System.currentTimeMillis()
              onMessage(msg)
            }
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
    ws = socket
    main.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
  }

  private fun lost(socket: WebSocket, code: Int, reason: String = "") {
    main.post {
      if (socket !== ws) return@post
      main.removeCallbacks(connectTimeout)
      main.removeCallbacks(pingTask)
      connected = false
      ws = null
      onStatus(false)
      // 4000: mesma identidade conectou em outro lugar; 4003: convidado tentando abrir uma mesa vazia.
      if (code == 4000) onRefused("Você entrou nesta sala em outro aparelho ou janela.")
      if (code == 4003) onRefused(reason)
      if (closed || code == 4000 || code == 4003) return@post
      val delay = minOf(10_000L, 500L shl minOf(retry++, 5))
      main.postDelayed(::open, delay)
    }
  }

  /** Reconecta imediatamente quando o app volta ao primeiro plano ou a rede retorna. */
  fun reconnectNow() {
    main.post {
      if (closed) return@post
      if (!connected) {
        main.removeCallbacksAndMessages(null)
        ws?.cancel()
        ws = null
        retry = 0
        open()
      } else {
        // Verifica se a conexão continua viva ao voltar do segundo plano.
        ws?.send(ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Ping))
      }
    }
  }

  fun send(msg: ClientMessage) {
    ws?.send(ProtocolJson.encodeToString<ClientMessage>(msg))
  }

  fun close() {
    closed = true
    main.removeCallbacksAndMessages(null)
    ws?.close(1000, null)
    ws = null
  }

  private companion object {
    const val TAG = "GameSocket"
    const val PING_INTERVAL_MS = 15_000L
    const val PONG_TIMEOUT_MS = 28_000L
    const val CONNECT_TIMEOUT_MS = 10_000L
  }
}
