package com.example.trimino

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import com.example.trimino.ui.Accent
import com.example.trimino.ui.FeltDeep
import com.example.trimino.ui.GameViewModel
import com.example.trimino.ui.Panel
import com.example.trimino.ui.SiteViewModel
import com.example.trimino.ui.TriminoApp

class MainActivity : ComponentActivity() {
  private val site: SiteViewModel by viewModels()
  private val game: GameViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (savedInstanceState == null) openInvite(intent)
    setContent {
      MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = FeltDeep, surface = Panel)) { TriminoApp(site, game) }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    openInvite(intent)
  }

  /** Link de convite: https://<site>/mesa/CODIGO (com ?assistir=1 para só assistir). */
  private fun openInvite(intent: Intent?) {
    val uri = intent?.data ?: return
    val code = Regex("^/mesa/([A-Za-z0-9]{1,12})/?$").find(uri.path ?: "")?.groupValues?.get(1) ?: return
    if (game.joined) return
    site.invite(code, watch = uri.getQueryParameter("assistir") != null)
  }
}
