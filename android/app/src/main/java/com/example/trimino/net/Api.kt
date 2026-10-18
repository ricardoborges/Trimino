// API HTTP do site (contas, varanda e estatísticas): espelho da parte "API HTTP" de shared/src/protocol.ts.
package com.example.trimino.net

import android.content.SharedPreferences
import androidx.core.content.edit
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Usuário da sessão. Convidados não têm conta: só um nome guardado no aparelho. */
@Serializable
data class UserInfo(
  val id: String,
  val name: String,
  val email: String? = null,
  val avatarUrl: String? = null,
  /** Administrador do site (e-mail confirmado pelo Google): só ele mexe nos jogadores IA. */
  val admin: Boolean = false,
)

@Serializable
data class PlayerStats(
  val matches: Int = 0,
  val wins: Int = 0,
  val forfeits: Int = 0,
  val totalPoints: Int = 0,
  val bestScore: Int = 0,
  val rounds: Int = 0,
  val lastPlayedAt: Long? = null,
)

@Serializable data class Me(val user: UserInfo? = null, val stats: PlayerStats? = null)

/** `googleClientId`: client ID (Web) para o qual o Google emite o ID token do login no app. */
@Serializable data class SiteConfig(val google: Boolean = false, val googleClientId: String? = null, val ai: Boolean = false)

@Serializable data class MesaSeat(val name: String, val score: Int, val bot: Boolean, val host: Boolean, val connected: Boolean)

/** Mesa aberta, como aparece na varanda. */
@Serializable
data class MesaSummary(
  val code: String,
  val title: String,
  val phase: String,
  val round: Int,
  val players: List<MesaSeat>,
  val spectators: Int,
  /** Lugares livres para sentar agora (0 durante a partida). */
  val seatsFree: Int,
  val updatedAt: Long,
)

@Serializable data class RankingRow(val userId: String, val name: String, val avatarUrl: String? = null, val matches: Int, val wins: Int, val totalPoints: Int)

@Serializable private data class UserReply(val user: UserInfo)

@Serializable private data class MesasReply(val mesas: List<MesaSummary>)

@Serializable private data class RankingReply(val ranking: List<RankingRow>)

@Serializable private data class CodeReply(val code: String)

class ApiException(message: String) : IOException(message)

/**
 * Fala com o site em `baseUrl` (ex.: https://trimino.exemplo.com). A sessão é o mesmo cookie do navegador
 * (`trimino_sess`): guardado nas preferências e enviado em toda requisição, inclusive no WebSocket da mesa.
 */
class Api(val baseUrl: String, private val prefs: SharedPreferences) {
  /** Endereço do WebSocket das mesas. */
  val wsUrl: String = baseUrl.replaceFirst(Regex("^http"), "ws") + "/ws"

  private var session: String?
    get() = prefs.getString(SESSION_KEY, null)
    set(value) = prefs.edit { if (value == null) remove(SESSION_KEY) else putString(SESSION_KEY, value) }

  val client: OkHttpClient =
    OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .addInterceptor { chain ->
        val token = session
        val req = chain.request().let { r -> if (token == null) r else r.newBuilder().header("Cookie", "$COOKIE=$token").build() }
        val res = chain.proceed(req)
        // Login, cadastro e saída trocam a sessão pelo Set-Cookie, como no navegador.
        for (header in res.headers("Set-Cookie")) {
          val (pair, attrs) = header.split(";", limit = 2).let { it[0].trim() to it.getOrElse(1) { "" } }
          if (!pair.startsWith("$COOKIE=")) continue
          val value = pair.removePrefix("$COOKIE=")
          session = if (value.isEmpty() || Regex("max-age=0\\b", RegexOption.IGNORE_CASE).containsMatchIn(attrs)) null else value
        }
        res
      }
      .build()

  val hasSession: Boolean
    get() = session != null

  fun forgetSession() {
    session = null
  }

  suspend fun config(): SiteConfig = get("/api/config")

  suspend fun me(): Me = get("/api/me")

  suspend fun login(email: String, password: String): UserInfo =
    post<UserReply>("/api/login", obj("email" to email, "password" to password)).user

  suspend fun signup(name: String, email: String, password: String): UserInfo =
    post<UserReply>("/api/signup", obj("name" to name, "email" to email, "password" to password)).user

  /** Troca o ID token do Google (Credential Manager) por uma sessão do site. */
  suspend fun google(idToken: String): UserInfo = post<UserReply>("/api/google", obj("idToken" to idToken)).user

  suspend fun logout() {
    runCatching { post<JsonObject>("/api/logout", JsonObject(emptyMap())) }
    session = null
  }

  suspend fun mesas(): List<MesaSummary> = get<MesasReply>("/api/mesas").mesas

  /** Arma uma mesa e devolve o código dela. */
  suspend fun createMesa(private: Boolean): String = post<CodeReply>("/api/mesas", JsonObject(mapOf("private" to JsonPrimitive(private)))).code

  suspend fun ranking(): List<RankingRow> = get<RankingReply>("/api/ranking").ranking

  /** Link da mesa, o mesmo do site (abre no app ou no navegador). */
  fun mesaUrl(code: String) = "$baseUrl/mesa/$code"

  private fun obj(vararg pairs: Pair<String, String>) = JsonObject(pairs.associate { (k, v) -> k to JsonPrimitive(v) })

  private suspend inline fun <reified T> get(path: String): T = call(Request.Builder().url(baseUrl + path).build())

  private suspend inline fun <reified T> post(path: String, body: JsonObject): T =
    call(Request.Builder().url(baseUrl + path).post(body.toString().toRequestBody(JSON)).build())

  private suspend inline fun <reified T> call(req: Request): T =
    withContext(Dispatchers.IO) {
      val text =
        try {
          client.newCall(req).execute().use { res ->
            val text = res.body.string()
            if (!res.isSuccessful) {
              val error = runCatching { ProtocolJson.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
              throw ApiException(error ?: "Não foi possível falar com o servidor.")
            }
            text
          }
        } catch (e: ApiException) {
          throw e
        } catch (e: IOException) {
          throw ApiException("Sem conexão com o servidor.")
        }
      ProtocolJson.decodeFromString<T>(text)
    }

  companion object {
    private const val COOKIE = "trimino_sess"
    private const val SESSION_KEY = "session"
    private val JSON = "application/json".toMediaType()
  }
}
