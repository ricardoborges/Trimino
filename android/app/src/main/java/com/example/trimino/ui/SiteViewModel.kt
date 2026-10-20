package com.example.trimino.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.trimino.BuildConfig
import com.example.trimino.net.Api
import com.example.trimino.net.MesaSummary
import com.example.trimino.net.PlayerStats
import com.example.trimino.net.RankingRow
import com.example.trimino.net.SiteConfig
import com.example.trimino.net.UserInfo
import kotlinx.coroutines.launch

enum class Screen { Loading, Landing, Varanda }

/** Mesa escolhida na varanda (ou no link do convite). */
data class Entry(val room: String, val watch: Boolean)

/**
 * O site no app, como em web/src/site.ts: a entrada (conta, Google ou convidado) e a varanda, com as
 * mesas abertas, o ranking e as estatísticas. A mesa em si fica no [GameViewModel].
 */
class SiteViewModel(app: Application) : AndroidViewModel(app) {
  private val prefs = app.getSharedPreferences("trimino", Context.MODE_PRIVATE)

  var server by mutableStateOf(prefs.getString("site", BuildConfig.DEFAULT_SERVER) ?: BuildConfig.DEFAULT_SERVER)
    private set
  var api = Api(server, prefs)
    private set

  var screen by mutableStateOf(Screen.Loading)
    private set
  var config by mutableStateOf(SiteConfig())
    private set
  var user by mutableStateOf<UserInfo?>(null)
    private set
  var stats by mutableStateOf<PlayerStats?>(null)
    private set
  /** Nome do convidado (sem conta), guardado no aparelho. */
  var guestName by mutableStateOf(if (prefs.getBoolean("guest", false)) prefs.getString("name", null) else null)
    private set
  /** Nome sugerido no formulário de convidado. */
  val lastName: String
    get() = prefs.getString("name", "") ?: ""

  var mesas by mutableStateOf<List<MesaSummary>?>(null)
    private set
  var mesasOffline by mutableStateOf(false)
    private set
  var ranking by mutableStateOf<List<RankingRow>>(emptyList())
    private set

  /** Erro do formulário de entrada. */
  var authError by mutableStateOf<String?>(null)
  var busy by mutableStateOf(false)
    private set
  /** Aviso no topo da varanda (ex.: uma mesa recusou a entrada). */
  var notice by mutableStateOf<String?>(null)

  /** Mesa do link do convite, à espera de a pessoa entrar. */
  var invitedTo by mutableStateOf<Entry?>(null)
    private set
  /** Mesa para abrir agora; a tela da mesa consome e limpa. */
  var entering by mutableStateOf<Entry?>(null)
    private set

  var withMedia by mutableStateOf(prefs.getBoolean("media", true))
    private set

  /** Nome com que a pessoa senta à mesa. */
  val name: String?
    get() = user?.name ?: guestName

  init {
    boot()
  }

  private fun boot() {
    screen = Screen.Loading
    viewModelScope.launch {
      runCatching { config = api.config() }
      val me = runCatching { api.me() }.getOrNull()
      user = me?.user
      stats = me?.stats
      if (user != null) guestName = null
      screen = if (name != null) Screen.Varanda else Screen.Landing
      if (me == null && name == null) authError = "Sem conexão com o servidor."
      invitedTo?.let { if (name != null) open(it) }
    }
  }

  /** Troca o endereço do site; a sessão do servidor anterior não vale no novo. */
  fun changeServer(url: String) {
    val clean = url.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
    if (clean == server) return
    api.forgetSession()
    server = clean
    prefs.edit { putString("site", clean) }
    api = Api(clean, prefs)
    user = null
    stats = null
    mesas = null
    authError = null
    boot()
  }

  // ---------------- entrada ----------------

  private fun auth(block: suspend () -> UserInfo) {
    if (busy) return
    busy = true
    authError = null
    viewModelScope.launch {
      try {
        user = block()
        guestName = null
        prefs.edit { putBoolean("guest", false) }
        stats = runCatching { api.me().stats }.getOrNull()
        enteredSite()
      } catch (e: Exception) {
        authError = e.message ?: "Não foi possível entrar."
      } finally {
        busy = false
      }
    }
  }

  fun login(email: String, password: String) = auth { api.login(email.trim(), password) }

  fun signup(name: String, email: String, password: String) = auth { api.signup(name.trim(), email.trim(), password) }

  fun google(idToken: String) = auth { api.google(idToken) }

  fun googleFailed(message: String) {
    authError = message
  }

  fun enterAsGuest(raw: String) {
    val n = raw.replace(Regex("\\(\\s*ia\\s*\\)", RegexOption.IGNORE_CASE), "").trim().take(24)
    if (n.isEmpty()) {
      authError = "Informe um nome."
      return
    }
    prefs.edit {
      putString("name", n)
      putBoolean("guest", true)
    }
    guestName = n
    authError = null
    enteredSite()
  }

  private fun enteredSite() {
    screen = Screen.Varanda
    invitedTo?.let(::open)
  }

  fun logout() {
    viewModelScope.launch { api.logout() }
    user = null
    stats = null
    guestName = null
    prefs.edit { putBoolean("guest", false) }
    screen = Screen.Landing
  }

  // ---------------- varanda ----------------

  fun refreshMesas() {
    viewModelScope.launch {
      runCatching { api.mesas() }
        .onSuccess {
          mesas = it
          mesasOffline = false
        }
        .onFailure { mesasOffline = true }
    }
  }

  /** Ranking e estatísticas: ao abrir a varanda e ao voltar de uma mesa. */
  fun refreshProfile() {
    viewModelScope.launch {
      runCatching { ranking = api.ranking() }
      if (user != null) runCatching { api.me() }.onSuccess { me ->
        // A sessão pode ter caído (ex.: entrou com o Google em outro lugar e a senha foi apagada).
        if (me.user == null) logout() else {
          user = me.user
          stats = me.stats
        }
      }
    }
  }

  fun setMedia(on: Boolean) {
    withMedia = on
    prefs.edit { putBoolean("media", on) }
  }

  fun createMesa(private: Boolean) {
    if (busy) return
    busy = true
    viewModelScope.launch {
      try {
        open(Entry(api.createMesa(private), watch = false))
      } catch (e: Exception) {
        notice = e.message
      } finally {
        busy = false
      }
    }
  }

  fun open(entry: Entry) {
    invitedTo = null
    entering = entry
  }

  fun openCode(raw: String, watch: Boolean) {
    val code = parseRoomCode(raw)
    if (code.isNotEmpty()) open(Entry(code, watch))
  }

  fun consumeEntering() {
    entering = null
  }

  /** Link de convite (https://<site>/mesa/CODIGO): entra direto, ou depois de a pessoa entrar no site. */
  fun invite(code: String, watch: Boolean) {
    val entry = Entry(parseRoomCode(code), watch)
    if (entry.room.isEmpty()) return
    if (screen == Screen.Varanda) open(entry) else invitedTo = entry
  }
}

/** Extrai o código da mesa mesmo se a pessoa colar o link inteiro ou o texto do WhatsApp. */
fun parseRoomCode(raw: String): String {
  Regex("/mesa/([A-Za-z0-9]{1,12})").find(raw)?.groupValues?.get(1)?.let { return it.uppercase() }
  Regex("[?&]sala=([A-Za-z0-9]{1,12})").find(raw)?.groupValues?.get(1)?.let { return it.uppercase() }
  return raw.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }.take(12)
}
