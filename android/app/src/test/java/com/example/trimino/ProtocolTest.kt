package com.example.trimino

import com.example.trimino.game.Geometry
import com.example.trimino.net.ClientMessage
import com.example.trimino.net.ProtocolJson
import com.example.trimino.net.ServerMessage
import com.example.trimino.net.SignalData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
  @Test
  fun encodesClientMessagesLikeTheServerExpects() {
    assertEquals("""{"t":"draw"}""", ProtocolJson.encodeToString<ClientMessage>(ClientMessage.Draw))
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
