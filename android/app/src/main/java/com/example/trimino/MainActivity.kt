package com.example.trimino

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
import com.example.trimino.ui.Panel
import com.example.trimino.ui.TriminoApp
import com.example.trimino.ui.GameViewModel

class MainActivity : ComponentActivity() {
  private val vm: GameViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContent {
      MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = FeltDeep, surface = Panel)) { TriminoApp(vm) }
    }
  }
}
