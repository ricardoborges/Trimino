package com.example.trimino.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

@Composable
fun VideoView(track: VideoTrack, egl: EglBase, mirror: Boolean, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val renderer = remember {
    SurfaceViewRenderer(context).apply {
      init(egl.eglBaseContext, null)
      setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
      setEnableHardwareScaler(true)
    }
  }
  DisposableEffect(renderer) { onDispose { renderer.release() } }
  DisposableEffect(track) {
    track.addSink(renderer)
    onDispose { runCatching { track.removeSink(renderer) } }
  }
  AndroidView({ renderer }, modifier, update = { it.setMirror(mirror) })
}
