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
)

@Serializable data class RoundSummary(val winnerId: String? = null, val reason: String, val points: Int)

@Serializable
data class You(
  val id: String,
  val hand: List<Tile>,
  /** Células livres onde se pode TENTAR jogar (sem indicar se a peça encaixa). */
  val frontier: List<Cell>,
  val canDraw: Boolean,
  val canPass: Boolean,
)

@Serializable
data class GameState(
  val room: String,
  val phase: String, // lobby | lottery | playing | roundOver | gameOver
  val round: Int,
  val targetScore: Int,
  val players: List<PlayerInfo>,
  val turnPlayerId: String? = null,
  val poolCount: Int,
  val board: List<BoardCell>,
  val lottery: Lottery? = null,
  val log: List<String>,
  val roundSummary: RoundSummary? = null,
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

@Serializable
sealed interface ClientMessage {
  @Serializable @SerialName("join") data class Join(val room: String, val name: String, val clientId: String) : ClientMessage

  @Serializable @SerialName("start") data object Start : ClientMessage

  @Serializable @SerialName("pickLot") data class PickLot(val slot: Int) : ClientMessage

  @Serializable @SerialName("nextRound") data object NextRound : ClientMessage

  @Serializable @SerialName("place") data class Place(val tileId: Int, val r: Int, val c: Int, val rot: Int) : ClientMessage

  @Serializable @SerialName("draw") data object Draw : ClientMessage

  @Serializable @SerialName("pass") data object Pass : ClientMessage

  @Serializable @SerialName("chat") data class Chat(val text: String) : ClientMessage

  @Serializable @SerialName("signal") data class Signal(val to: String, val data: SignalData) : ClientMessage
}

@Serializable
sealed interface ServerMessage {
  @Serializable
  @SerialName("welcome")
  data class Welcome(val you: String, val room: String, val iceServers: List<IceServer>, val peers: List<String>) : ServerMessage

  @Serializable @SerialName("state") data class State(val state: GameState) : ServerMessage

  @Serializable @SerialName("peerLeft") data class PeerLeft(val id: String) : ServerMessage

  @Serializable @SerialName("signal") data class Signal(val from: String, val data: SignalData) : ServerMessage

  @Serializable @SerialName("chat") data class Chat(val from: String, val name: String, val text: String) : ServerMessage

  @Serializable @SerialName("error") data class Error(val message: String) : ServerMessage
}
