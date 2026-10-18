package com.example.trimino.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun TriminoApp(site: SiteViewModel, game: GameViewModel) {
  // Mesa escolhida na varanda: pede câmera e microfone (se a pessoa quiser) e senta.
  val pending = site.entering
  val permissions =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
      val entry = site.entering ?: return@rememberLauncherForActivityResult
      site.consumeEntering()
      enter(site, game, entry, granted[Manifest.permission.RECORD_AUDIO] == true, granted[Manifest.permission.CAMERA] == true)
    }
  LaunchedEffect(pending) {
    if (pending == null) return@LaunchedEffect
    if (site.withMedia) permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA))
    else {
      site.consumeEntering()
      enter(site, game, pending, audio = false, video = false)
    }
  }
  // A mesa recusou a entrada: volta para a varanda com o motivo.
  LaunchedEffect(game.refused) {
    game.refused?.let {
      site.notice = it
      game.refused = null
    }
  }

  Box(Modifier.fillMaxSize().background(FeltDeep)) {
    when {
      game.joined -> GameScreen(game)
      site.screen == Screen.Loading -> Splash()
      site.screen == Screen.Landing -> LandingScreen(site)
      else -> VarandaScreen(site)
    }
    game.toast?.let { msg ->
      Text(
        msg,
        color = Color.White,
        modifier =
          // no alto da mesa, para não cobrir as pedras da mão
          Modifier.align(Alignment.TopCenter).padding(top = 120.dp, start = 16.dp, end = 16.dp)
            .background(Color(0xCC000000), RoundedCornerShape(10.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
      )
    }
  }
}

private fun enter(site: SiteViewModel, game: GameViewModel, entry: Entry, audio: Boolean, video: Boolean) {
  val name = site.name ?: return
  site.notice = null
  game.join(site.api, entry.room, entry.watch, name, withAudio = audio, withVideo = video)
}

@Composable
private fun Splash() {
  Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
    LogoMark(72.dp)
    Spacer(Modifier.height(14.dp))
    Text("Triminó", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
  }
}
