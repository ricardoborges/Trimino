package com.example.trimino.rtc

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.trimino.net.IceServer
import com.example.trimino.net.SignalData
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
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
  private val peers = mutableMapOf<String, Peer>()
  var iceServers: List<IceServer> = emptyList()

  var localAudio: AudioTrack? = null
    private set
  var localVideo: VideoTrack? = null
    private set
  private var capturer: CameraVideoCapturer? = null
  private var videoSource: VideoSource? = null
  private var textureHelper: SurfaceTextureHelper? = null

  private class Peer(val pc: PeerConnection) {
    val pendingIce = mutableListOf<IceCandidate>()
    var remoteSet = false
  }

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
      localAudio = factory.createAudioTrack("audio0", factory.createAudioSource(MediaConstraints()))
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

  fun setEnabled(kind: String, enabled: Boolean) {
    if (kind == "audio") localAudio?.setEnabled(enabled) else localVideo?.setEnabled(enabled)
  }

  fun switchCamera() = capturer?.switchCamera(null)

  private fun localTrack(kind: MediaStreamTrack.MediaType): MediaStreamTrack? =
    if (kind == MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO) localAudio else localVideo

  private fun create(peerId: String): Peer {
    close(peerId)
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

    val observer =
      object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) = sendSignal(peerId, SignalData.Ice(c.sdp, c.sdpMid, c.sdpMLineIndex))

        override fun onTrack(transceiver: RtpTransceiver) {
          val track = transceiver.receiver.track()
          if (track is VideoTrack) main.post { onRemoteVideo(peerId, track) }
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
          Log.d(TAG, "$peerId: $state")
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
    peers[peerId] = peer
    return peer
  }

  /** Chamado por quem acabou de entrar, uma vez para cada participante existente. */
  fun call(peerId: String) =
    scope.launch {
      runCatching {
        val pc = create(peerId).pc
        for (kind in listOf(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) {
          val track = localTrack(kind)
          if (track != null) pc.addTransceiver(track, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf(STREAM_ID)))
          else pc.addTransceiver(kind, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
        }
        val offer = pc.awaitCreate(offer = true)
        pc.awaitSetLocal(offer)
        sendSignal(peerId, SignalData.Offer(offer.description))
      }.onFailure { Log.e(TAG, "call $peerId", it) }
    }

  fun onSignal(from: String, data: SignalData) =
    scope.launch {
      runCatching {
        when (data) {
          is SignalData.Offer -> {
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
            val peer = peers[from] ?: return@runCatching
            if (peer.pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) return@runCatching
            peer.pc.awaitSetRemote(SessionDescription(SessionDescription.Type.ANSWER, data.sdp))
            peer.remoteSet = true
            flushIce(peer)
          }
          is SignalData.Ice -> {
            val peer = peers[from] ?: return@runCatching
            val c = IceCandidate(data.sdpMid ?: "0", data.sdpMLineIndex ?: 0, data.candidate)
            if (peer.remoteSet) peer.pc.addIceCandidate(c) else peer.pendingIce += c
          }
        }
      }.onFailure { Log.e(TAG, "signal de $from", it) }
    }

  private fun flushIce(peer: Peer) {
    peer.pendingIce.forEach(peer.pc::addIceCandidate)
    peer.pendingIce.clear()
  }

  fun close(peerId: String) {
    val peer = peers.remove(peerId) ?: return
    peer.pc.dispose()
    main.post { onRemoteVideo(peerId, null) }
  }

  fun closeAll() = peers.keys.toList().forEach(::close)

  fun release() {
    closeAll()
    runCatching { capturer?.stopCapture() }
    capturer?.dispose()
    videoSource?.dispose()
    textureHelper?.dispose()
    localVideo?.dispose()
    localAudio?.dispose()
    factory.dispose()
    egl.release()
    (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_NORMAL
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
