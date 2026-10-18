package com.example.trimino

import com.example.trimino.game.Geometry
import com.example.trimino.net.ClientMessage
import com.example.trimino.net.Intent
import com.example.trimino.net.ProtocolJson
import com.example.trimino.net.ServerMessage
import com.example.trimino.net.SignalData
import com.example.trimino.ui.rotated
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
  @Test
  fun encodesClientMessagesLikeTheServerExpects() {
    assertEquals("""{"t":"draw"}""", ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Draw()))
    assertEquals("""{"t":"draw","slot":3}""", ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Draw(3)))
    assertEquals(
      """{"t":"intent","intent":{"kind":"preview","index":1,"r":0,"c":1,"rot":2,"vals":[1,2,3]}}""",
      ProtocolJson.encodeToString<ClientMessage>(ClientMessage.SendIntent(Intent.Preview(1, 0, 1, 2, listOf(1, 2, 3)))),
    )
    val signal = ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Signal("ab", SignalData.Offer("v=0")))
    assertEquals("""{"t":"signal","to":"ab","data":{"type":"offer","sdp":"v=0"}}""", signal)
  }

  @Test
  fun decodesServerMessages() {
    val msg = ProtocolJson.decodeFromString<ServerMessage>(
      """{"t":"signal","from":"x","data":{"type":"ice","candidate":"c","sdpMid":"0","sdpMLineIndex":0}}"""
    )
    assertEquals(ServerMessage.Signal("x", SignalData.Ice("c", "0", 0)), msg)
    val welcome = ProtocolJson.decodeFromString<ServerMessage>(
      """{"t":"welcome","you":"a","room":"R","iceServers":[{"urls":["stun:x"]}],"peers":["b"]}"""
    )
    assertTrue(welcome is ServerMessage.Welcome)
  }

  /** Fixtures gerados pelo servidor real com `node scripts/capture-fixtures.mjs`. */
  private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

  @Test
  fun decodesRealServerStates() {
    val lottery = ProtocolJson.decodeFromString<ServerMessage>(fixture("state-lottery.json")) as ServerMessage.State
    assertEquals("lottery", lottery.state.phase)
    assertNotNull(lottery.state.lottery)
    assertEquals(1, lottery.state.lottery!!.picks.size)

    val playing = ProtocolJson.decodeFromString<ServerMessage>(fixture("state-playing.json")) as ServerMessage.State
    assertEquals("playing", playing.state.phase)
    assertEquals(1, playing.state.board.size)
    assertEquals(3, playing.state.you.frontier.size)
  }

  @Test
  fun rotationMatchesServer() {
    assertEquals(listOf(1, 2, 3), rotated(listOf(1, 2, 3), 0))
    assertEquals(listOf(2, 3, 1), rotated(listOf(1, 2, 3), 1))
    assertEquals(listOf(3, 1, 2), rotated(listOf(1, 2, 3), 2))
  }

  @Test
  fun tapHitsTheRightTriangle() {
    for ((r, c) in listOf(0 to 0, 0 to 1, 2 to -3, -1 to 4)) {
      val pts = Geometry.cellCorners(r, c, 64f)
      val cx = pts.sumOf { it.first.toDouble() }.toFloat() / 3
      val cy = pts.sumOf { it.second.toDouble() }.toFloat() / 3
      assertEquals(r to c, Geometry.cellAt(cx, cy, 64f))
    }
  }
}
