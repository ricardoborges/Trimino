// Espelho de shared/src/protocol.ts — mantenha os dois em sincronia.
@file:OptIn(ExperimentalSerializationApi::class)

package com.example.trimino.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator

val ProtocolJson = Json {
  classDiscriminator = "t"
  ignoreUnknownKeys = true
  explicitNulls = false
  encodeDefaults = true
}

@Serializable data class Tile(val id: Int, val v: List<Int>)

@Serializable data class Cell(val r: Int, val c: Int)

@Serializable data class LotPick(val playerId: String, val slot: Int, val tile: Tile)

@Serializable data class Lottery(val slots: Int, val picks: List<LotPick>, val winnerId: String? = null)

/** Linha do histórico (o app ainda não exibe; mantido para o protocolo decodificar). */
@Serializable
data class LogEntry(val actor: String? = null, val action: String, val tile: List<Int>? = null, val points: Int? = null, val note: String? = null)

@Serializable data class BoardCell(val r: Int, val c: Int, val vals: List<Int>, val tileId: Int, val by: String)

@Serializable
data class PlayerInfo(
  val id: String,
  val name: String,
  val score: Int,
  val handCount: Int,
  val connected: Boolean,
  val isHost: Boolean,
  val spectator: Boolean,
  /** Desistiu da partida. */
  val out: Boolean = false,
  /** Jogador IA controlado pelo servidor. */
  val bot: Boolean = false,
  /** Está na videoconferência (jogadores sempre; espectadores só com a permissão do anfitrião). */
  val inCall: Boolean = false,
  /** Espectador pediu para entrar na videoconferência e aguarda o anfitrião. */
  val callRequested: Boolean = false,
  /** Entrou sem conta (convidado). */
  val guest: Boolean = false,
)

/** Batida: as pedras que sobraram na mão de cada adversário e a soma delas (para a conferência). */
@Serializable data class HandLeft(val playerId: String, val tiles: List<List<Int>>, val sum: Int)

@Serializable
data class RoundSummary(
  val winnerId: String? = null,
  val reason: String,
  val points: Int,
  /** Batida: o bônus por bater (+25). */
  val bonus: Int? = null,
  val hands: List<HandLeft>? = null,
)

/** Anotação na folha de pontos: o total do jogador logo depois de pontuar. */
@Serializable data class ScoreMark(val round: Int, val total: Int, val roundWin: Boolean = false)

@Serializable data class SheetColumn(val playerId: String, val marks: List<ScoreMark>)

@Serializable data class Formation(val kind: String, val cells: List<Cell>)

/** Última ponte/mandala da rodada; `seq` cresce a cada nova. */
@Serializable
data class Celebration(val seq: Int, val playerId: String, val points: Int, val formations: List<Formation>, val batida: Boolean = false)

/** Depois de alguém bater: quem bateu e quem ainda vai jogar a última vez. */
@Serializable data class FinalLap(val batedorId: String, val pending: List<String>)

@Serializable
data class You(
  val id: String,
  val hand: List<Tile>,
  /** Células livres onde se pode TENTAR jogar (sem indicar se a peça encaixa). */
  val frontier: List<Cell>,
  val canDraw: Boolean,
  val canPass: Boolean,
  /** Quantas compras ainda cabem nesta vez. */
  val drawsLeft: Int? = null,
  /** Pode adicionar e remover jogadores IA (só o administrador do site). */
  val canManageBots: Boolean = false,
)

@Serializable
data class GameState(
  val room: String,
  /** Nome da mesa, escolhido por quem a criou na varanda. */
  val title: String? = null,
  val phase: String, // lobby | lottery | playing | roundOver | gameOver
  val round: Int,
  val targetScore: Int,
  val players: List<PlayerInfo>,
  val turnPlayerId: String? = null,
  val poolCount: Int,
  val board: List<BoardCell>,
  val lottery: Lottery? = null,
  val log: List<LogEntry>,
  val roundSummary: RoundSummary? = null,
  val winnerId: String? = null,
  val scoreSheet: List<SheetColumn> = emptyList(),
  val celebration: Celebration? = null,
  val finalLap: FinalLap? = null,
  val you: You,
)

@Serializable data class IceServer(val urls: List<String>, val username: String? = null, val credential: String? = null)

@Serializable
@JsonClassDiscriminator("type")
sealed interface SignalData {
  @Serializable @SerialName("offer") data class Offer(val sdp: String) : SignalData

  @Serializable @SerialName("answer") data class Answer(val sdp: String) : SignalData

  @Serializable
  @SerialName("ice")
  data class Ice(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int?) : SignalData
}

/**
 * O que o jogador da vez está fazendo antes de confirmar, para os outros acompanharem.
 * `index` é a posição da pedra na mão dele, contando da esquerda.
 */
@Serializable
@JsonClassDiscriminator("kind")
sealed interface Intent {
  @Serializable @SerialName("idle") data object Idle : Intent

  /** Pegou uma pedra da mão. */
  @Serializable @SerialName("select") data class Select(val index: Int) : Intent

  /** Segura a pedra sobre o tabuleiro, na célula (r, c), com o giro `rot` e os números `vals`. */
  @Serializable
  @SerialName("preview")
  data class Preview(val index: Int, val r: Int, val c: Int, val rot: Int, val vals: List<Int>) : Intent

  /** Abriu o monte para comprar; `slot`: a pedra que escolheu. */
  @Serializable @SerialName("pile") data class Pile(val slot: Int? = null) : Intent
}

@Serializable
sealed interface ClientMessage {
  /** `watch`: entra como espectador (só assiste; não ocupa lugar na mesa). */
  @Serializable
  @SerialName("join")
  data class Join(val room: String, val name: String, val clientId: String, val watch: Boolean = false) : ClientMessage

  /** Espectador: ocupa um lugar livre (fora de partida). */
  @Serializable @SerialName("sit") data object Sit : ClientMessage

  /** Espectador: pede para entrar na videoconferência. */
  @Serializable @SerialName("requestCall") data object RequestCall : ClientMessage

  /** Espectador: cancela o pedido ou sai da videoconferência. */
  @Serializable @SerialName("leaveCall") data object LeaveCall : ClientMessage

  /** Anfitrião: aceita ou recusa o pedido de um espectador. */
  @Serializable @SerialName("answerCall") data class AnswerCall(val id: String, val allow: Boolean) : ClientMessage

  /** Anfitrião: tira um espectador da videoconferência. */
  @Serializable @SerialName("endCall") data class EndCall(val id: String) : ClientMessage

  @Serializable @SerialName("start") data object Start : ClientMessage

  @Serializable @SerialName("pickLot") data class PickLot(val slot: Int) : ClientMessage

  @Serializable @SerialName("forfeit") data object Forfeit : ClientMessage

  @Serializable @SerialName("addBot") data object AddBot : ClientMessage

  @Serializable @SerialName("removeBot") data class RemoveBot(val id: String) : ClientMessage

  @Serializable @SerialName("nextRound") data object NextRound : ClientMessage

  @Serializable @SerialName("place") data class Place(val tileId: Int, val r: Int, val c: Int, val rot: Int) : ClientMessage

  /** `slot`: qual pedra do monte (virada para baixo) o jogador escolheu; sem ele, a de cima. */
  @Serializable @SerialName("draw") data class Draw(val slot: Int? = null) : ClientMessage

  @Serializable @SerialName("intent") data class SendIntent(val intent: Intent) : ClientMessage

  /** Anfitrião tira um jogador da partida (conta como desistência). */
  @Serializable @SerialName("removePlayer") data class RemovePlayer(val id: String) : ClientMessage

  /** Anfitrião: dá as cartas de novo na rodada atual. */
  @Serializable @SerialName("restartRound") data object RestartRound : ClientMessage

  /** Anfitrião: começa uma partida nova com quem está na mesa. */
  @Serializable @SerialName("restartGame") data object RestartGame : ClientMessage

  @Serializable @SerialName("pass") data object Pass : ClientMessage


  @Serializable @SerialName("signal") data class Signal(val to: String, val data: SignalData) : ClientMessage
}

@Serializable
sealed interface ServerMessage {
  @Serializable
  @SerialName("welcome")
  data class Welcome(
    val you: String,
    val room: String,
    val iceServers: List<IceServer>,
    val peers: List<String>,
    /** false para espectadores, que só entram na conversa com a permissão do anfitrião. */
    val inCall: Boolean = true,
  ) : ServerMessage

  /** Você entrou na videoconferência: envie a oferta para cada um de `peers`. */
  @Serializable @SerialName("call") data class Call(val peers: List<String>) : ServerMessage

  /** Você saiu da videoconferência (por vontade própria ou pelo anfitrião). */
  @Serializable @SerialName("callEnded") data object CallEnded : ServerMessage

  /** Aviso para mostrar ao usuário (não é erro). */
  @Serializable @SerialName("notice") data class Notice(val message: String) : ServerMessage

  @Serializable @SerialName("state") data class State(val state: GameState) : ServerMessage

  @Serializable @SerialName("peerLeft") data class PeerLeft(val id: String) : ServerMessage

  @Serializable @SerialName("signal") data class Signal(val from: String, val data: SignalData) : ServerMessage

  /** O que o jogador da vez (`from`) está fazendo. */
  @Serializable @SerialName("intent") data class PlayerIntent(val from: String, val intent: Intent) : ServerMessage


  @Serializable @SerialName("error") data class Error(val message: String) : ServerMessage
}
