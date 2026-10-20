package com.example.trimino.rtc

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.trimino.net.IceServer
import com.example.trimino.net.SignalData
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * Malha WebRTC: uma PeerConnection por participante, igual a web/src/rtc.ts.
 * Quem entra na sala oferta para quem já estava; o outro lado só responde.
 */
class Mesh(
  private val context: Context,
  private val scope: CoroutineScope,
  private val sendSignal: (to: String, data: SignalData) -> Unit,
  /** Chamado na main thread com a trilha de vídeo do participante (ou null quando ele sai). */
  private val onRemoteVideo: (peerId: String, track: VideoTrack?) -> Unit,
) {
  val egl: EglBase = EglBase.create()
  private val main = Handler(Looper.getMainLooper())
  private val factory: PeerConnectionFactory
  private val peers = ConcurrentHashMap<String, Peer>()
  private val locks = ConcurrentHashMap<String, Mutex>()
  private val reconnectJobs = ConcurrentHashMap<String, Job>()
  var myId: String = ""
  var iceServers: List<IceServer> = emptyList()

  var localAudio: AudioTrack? = null
    private set
  var localVideo: VideoTrack? = null
    private set
  private var audioSource: AudioSource? = null
  private var capturer: CameraVideoCapturer? = null
  private var videoSource: VideoSource? = null
  private var textureHelper: SurfaceTextureHelper? = null

  private class Peer(val pc: PeerConnection) {
    val pendingIce = mutableListOf<IceCandidate>()
    var remoteSet = false
    var makingOffer = false
  }

  private fun lockFor(peerId: String): Mutex = locks.getOrPut(peerId) { Mutex() }

  init {
    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext).createInitializationOptions())
    factory =
      PeerConnectionFactory.builder()
        .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
        .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
        .setAudioDeviceModule(
          JavaAudioDeviceModule.builder(context).setUseHardwareAcousticEchoCanceler(true).setUseHardwareNoiseSuppressor(true).createAudioDeviceModule()
        )
        .createPeerConnectionFactory()
  }

  /** Cria as trilhas locais conforme as permissões concedidas. */
  fun startLocal(audio: Boolean, video: Boolean) {
    if (audio && localAudio == null) {
      val source = factory.createAudioSource(MediaConstraints())
      audioSource = source
      localAudio = factory.createAudioTrack("audio0", source)
      (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).apply {
        mode = AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION")
        isSpeakerphoneOn = true
      }
    }
    if (video && localVideo == null) {
      val enumerator = Camera2Enumerator(context)
      val name = enumerator.deviceNames.firstOrNull(enumerator::isFrontFacing) ?: enumerator.deviceNames.firstOrNull() ?: return
      val cap = enumerator.createCapturer(name, null)
      val source = factory.createVideoSource(false)
      val helper = SurfaceTextureHelper.create("camera", egl.eglBaseContext)
      cap.initialize(helper, context, source.capturerObserver)
      cap.startCapture(640, 480, 24)
      capturer = cap
      videoSource = source
      textureHelper = helper
      localVideo = factory.createVideoTrack("video0", source)
    }
  }

  /** Desliga a câmera e o microfone locais (ex.: espectador fora da videoconferência). */
  fun stopLocal() {
    runCatching { capturer?.stopCapture() }
    capturer?.dispose()
    capturer = null
    localVideo?.dispose()
    localVideo = null
    videoSource?.dispose()
    videoSource = null
    textureHelper?.dispose()
    textureHelper = null
    localAudio?.dispose()
    localAudio = null
    audioSource?.dispose()
    audioSource = null
    (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_NORMAL
  }

  fun setEnabled(kind: String, enabled: Boolean) {
    if (kind == "audio") localAudio?.setEnabled(enabled) else localVideo?.setEnabled(enabled)
  }

  fun switchCamera() = capturer?.switchCamera(null)

  private fun localTrack(kind: MediaStreamTrack.MediaType): MediaStreamTrack? =
    if (kind == MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO) localAudio else localVideo

  private fun clearReconnect(peerId: String) {
    reconnectJobs.remove(peerId)?.cancel()
  }

  private fun scheduleReconnect(peerId: String, delayMs: Long = 1500L) {
    if (reconnectJobs[peerId]?.isActive == true) return
    reconnectJobs[peerId] =
      scope.launch {
        delay(delayMs)
        reconnectJobs.remove(peerId)
        val cur = peers[peerId]
        val st = runCatching { cur?.pc?.connectionState() }.getOrNull()
        if (st == PeerConnection.PeerConnectionState.CONNECTED || st == PeerConnection.PeerConnectionState.CONNECTING) return@launch
        if (myId.isEmpty() || myId < peerId) {
          call(peerId)
        } else {
          sendSignal(peerId, SignalData.Renegotiate)
          delay(2500L)
          val after = peers[peerId]
          val afterSt = runCatching { after?.pc?.connectionState() }.getOrNull()
          if (after == null || afterSt == PeerConnection.PeerConnectionState.FAILED || afterSt == PeerConnection.PeerConnectionState.DISCONNECTED || afterSt == PeerConnection.PeerConnectionState.CLOSED) {
            call(peerId)
          }
        }
      }
  }

  /** Garante que exista uma conexão ativa ou reconectando para um participante online na chamada. */
  fun ensurePeer(peerId: String) {
    if (peerId.isEmpty() || peerId == myId) return
    val cur = peers[peerId]
    val st = runCatching { cur?.pc?.connectionState() }.getOrNull()
    if (cur == null || st == PeerConnection.PeerConnectionState.FAILED || st == PeerConnection.PeerConnectionState.CLOSED) {
      scheduleReconnect(peerId, 800L)
    }
  }

  private fun create(peerId: String): Peer {
    clearReconnect(peerId)
    peers.remove(peerId)?.let { runCatching { it.pc.dispose() } }
    val config =
      PeerConnection.RTCConfiguration(
          iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls).apply {
              s.username?.let(::setUsername)
              s.credential?.let(::setPassword)
            }.createIceServer()
          }
        )
        .apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }

    var createdPeer: Peer? = null
    val observer =
      object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
          if (peers[peerId] !== createdPeer) return
          sendSignal(peerId, SignalData.Ice(c.sdp, c.sdpMid, c.sdpMLineIndex))
        }

        override fun onTrack(transceiver: RtpTransceiver) {
          if (peers[peerId] !== createdPeer) return
          val track = transceiver.receiver.track()
          if (track is VideoTrack) main.post {
            if (peers[peerId] === createdPeer) onRemoteVideo(peerId, track)
          }
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
          if (peers[peerId] !== createdPeer) return
          Log.d(TAG, "$peerId: $state")
          when (state) {
            PeerConnection.PeerConnectionState.CONNECTED -> clearReconnect(peerId)
            PeerConnection.PeerConnectionState.DISCONNECTED -> scheduleReconnect(peerId, 4000L)
            PeerConnection.PeerConnectionState.FAILED -> {
              main.post {
                if (peers[peerId] === createdPeer) onRemoteVideo(peerId, null)
              }
              scheduleReconnect(peerId, 1200L)
            }
            else -> Unit
          }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onDataChannel(channel: DataChannel) {}
        override fun onRenegotiationNeeded() {}
      }
    val peer = Peer(factory.createPeerConnection(config, observer) ?: error("Falha ao criar PeerConnection"))
    createdPeer = peer
    peers[peerId] = peer
    return peer
  }

  /** Chamado por quem acabou de entrar, uma vez para cada participante existente. */
  fun call(peerId: String) =
    scope.launch {
      lockFor(peerId).withLock {
        runCatching {
          val peer = create(peerId)
          peer.makingOffer = true
          try {
            val pc = peer.pc
            for (kind in listOf(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) {
              val track = localTrack(kind)
              if (track != null) pc.addTransceiver(track, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf(STREAM_ID)))
              else pc.addTransceiver(kind, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
            }
            val offer = pc.awaitCreate(offer = true)
            pc.awaitSetLocal(offer)
            sendSignal(peerId, SignalData.Offer(offer.description))
          } finally {
            peer.makingOffer = false
          }
        }.onFailure {
          Log.e(TAG, "call $peerId", it)
          scheduleReconnect(peerId, 2000L)
        }
      }
    }

  fun onSignal(from: String, data: SignalData) =
    scope.launch {
      lockFor(from).withLock {
        runCatching {
          when (data) {
            is SignalData.Offer -> {
              val existing = peers[from]
              val collision =
                existing != null &&
                  (existing.makingOffer || runCatching { existing.pc.signalingState() }.getOrNull() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER)
              if (collision && myId.isNotEmpty() && myId < from) {
                return@withLock
              }
              val peer = create(from)
              val pc = peer.pc
              pc.awaitSetRemote(SessionDescription(SessionDescription.Type.OFFER, data.sdp))
              peer.remoteSet = true
              // Reaproveita os transceptores criados pela oferta para enviar nossa mídia.
              for (tr in pc.transceivers) {
                val track = localTrack(tr.mediaType) ?: continue
                tr.sender.setTrack(track, false)
                tr.sender.setStreams(listOf(STREAM_ID))
                tr.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV
              }
              val answer = pc.awaitCreate(offer = false)
              pc.awaitSetLocal(answer)
              sendSignal(from, SignalData.Answer(answer.description))
              flushIce(peer)
            }
            is SignalData.Answer -> {
              val peer = peers[from] ?: return@withLock
              if (peer.pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) return@withLock
              peer.pc.awaitSetRemote(SessionDescription(SessionDescription.Type.ANSWER, data.sdp))
              peer.remoteSet = true
              flushIce(peer)
            }
            is SignalData.Ice -> {
              val peer = peers[from] ?: return@withLock
              val c = IceCandidate(data.sdpMid ?: "0", data.sdpMLineIndex ?: 0, data.candidate)
              if (peer.remoteSet) peer.pc.addIceCandidate(c) else peer.pendingIce += c
            }
            is SignalData.Renegotiate -> {
              // Lança call fora do lock atual (ou cria direto aqui)
              val peer = create(from)
              peer.makingOffer = true
              try {
                val pc = peer.pc
                for (kind in listOf(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) {
                  val track = localTrack(kind)
                  if (track != null) pc.addTransceiver(track, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf(STREAM_ID)))
                  else pc.addTransceiver(kind, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
                }
                val offer = pc.awaitCreate(offer = true)
                pc.awaitSetLocal(offer)
                sendSignal(from, SignalData.Offer(offer.description))
              } finally {
                peer.makingOffer = false
              }
            }
          }
        }.onFailure { Log.e(TAG, "signal de $from", it) }
      }
    }

  private fun flushIce(peer: Peer) {
    peer.pendingIce.forEach(peer.pc::addIceCandidate)
    peer.pendingIce.clear()
  }

  fun close(peerId: String) {
    clearReconnect(peerId)
    val peer = peers.remove(peerId) ?: return
    runCatching { peer.pc.dispose() }
    main.post { onRemoteVideo(peerId, null) }
  }

  fun closeAll() {
    reconnectJobs.keys.toList().forEach(::clearReconnect)
    peers.keys.toList().forEach(::close)
  }

  fun release() {
    closeAll()
    stopLocal()
    factory.dispose()
    egl.release()
  }

  private companion object {
    const val TAG = "Mesh"
    const val STREAM_ID = "local"
  }
}

private open class SimpleSdpObserver : SdpObserver {
  override fun onCreateSuccess(sdp: SessionDescription) {}
  override fun onSetSuccess() {}
  override fun onCreateFailure(error: String) {}
  override fun onSetFailure(error: String) {}
}

private suspend fun PeerConnection.awaitCreate(offer: Boolean): SessionDescription = suspendCancellableCoroutine { cont ->
  val obs =
    object : SimpleSdpObserver() {
      override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
      override fun onCreateFailure(error: String) = cont.resumeWithException(IllegalStateException(error))
    }
  if (offer) createOffer(obs, MediaConstraints()) else createAnswer(obs, MediaConstraints())
}

private suspend fun PeerConnection.awaitSetLocal(sdp: SessionDescription) = awaitSet { setLocalDescription(it, sdp) }

private suspend fun PeerConnection.awaitSetRemote(sdp: SessionDescription) = awaitSet { setRemoteDescription(it, sdp) }

private suspend fun awaitSet(block: (SdpObserver) -> Unit): Unit = suspendCancellableCoroutine { cont ->
  block(
    object : SimpleSdpObserver() {
      override fun onSetSuccess() = cont.resume(Unit)
      override fun onSetFailure(error: String) = cont.resumeWithException(IllegalStateException(error))
    }
  )
}
