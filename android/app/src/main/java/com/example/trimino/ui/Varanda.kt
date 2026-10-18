package com.example.trimino.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.example.trimino.net.MesaSummary
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.delay

private val PHASE_LABEL =
  mapOf(
    "lobby" to "Esperando jogadores",
    "lottery" to "Sorteio",
    "playing" to "Em jogo",
    "roundOver" to "Fim de rodada",
    "gameOver" to "Partida encerrada",
  )

/** A varanda: mesas abertas (atualiza a cada 4 s), armar mesa, entrar por código, estatísticas e ranking. */
@Composable
fun VarandaScreen(site: SiteViewModel) {
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  LaunchedEffect(Unit) { site.refreshProfile() }
  LaunchedEffect(lifecycle) {
    // Só atualiza com o app na frente, como o site só atualiza com a aba visível.
    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
      while (true) {
        site.refreshMesas()
        delay(4000)
      }
    }
  }
  val guest = site.user == null

  Column(Modifier.fillMaxSize().safeDrawingPadding()) {
    SiteNav("Varanda") {
      Row(
        Modifier.clip(CircleShape).background(Panel2).padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        Initial(site.name ?: "?", color = Felt, size = 24.dp)
        Text(site.name ?: "", color = TextColor, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 110.dp))
        if (guest) MutedText("convidado", size = 11)
      }
      Chip("Sair", onClick = site::logout)
    }

    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      site.notice?.let { msg ->
        item("notice") {
          Text(
            msg,
            color = TextColor,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Danger.copy(alpha = 0.18f))
              .border(1.dp, Danger.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).padding(12.dp),
          )
        }
      }
      item("create") { if (guest) GuestCreateCard(site) else CreateCard(site) }
      item("code") { CodeCard(site) }
      item("media") {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
          Text("Entrar nas mesas com câmera e microfone", color = TextColor, fontSize = 14.sp, modifier = Modifier.weight(1f))
          Switch(
            site.withMedia,
            site::setMedia,
            colors = SwitchDefaults.colors(checkedThumbColor = AccentInk, checkedTrackColor = Accent, uncheckedTrackColor = Panel2),
          )
        }
      }
      item("mesas-head") {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
          Text("Mesas abertas", color = TextColor, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
          val mesas = site.mesas
          MutedText(
            when {
              site.mesasOffline -> "sem conexão com o servidor"
              mesas == null -> "carregando…"
              mesas.size == 1 -> "1 mesa"
              else -> "${mesas.size} mesas"
            },
            Modifier.padding(bottom = 4.dp),
          )
        }
      }
      val mesas = site.mesas.orEmpty()
      if (site.mesas != null && mesas.isEmpty()) {
        item("empty") {
          Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).border(1.dp, FeltLine, RoundedCornerShape(16.dp)).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            Text("A varanda está vazia.", color = TextColor, fontWeight = FontWeight.Bold)
            MutedText(
              if (guest) "Quando alguém armar uma mesa, ela aparece aqui para você entrar."
              else "Arme a primeira mesa e chame a turma pelo WhatsApp."
            )
          }
        }
      }
      items(mesas, key = { it.code }) { m -> MesaCard(m, onEnter = { site.open(Entry(m.code, watch = false)) }, onWatch = { site.open(Entry(m.code, watch = true)) }) }
      item("stats") { StatsCard(site) }
      if (site.ranking.isNotEmpty()) item("ranking") { RankingCard(site) }
    }
  }
}

@Composable
private fun CreateCard(site: SiteViewModel) {
  var private by rememberSaveable { mutableStateOf(false) }
  SiteCard {
    CardTitle("Armar uma mesa")
    MutedText("A mesa ganha um código para você compartilhar com quem vai jogar.")
    Row(verticalAlignment = Alignment.CenterVertically) {
      Checkbox(private, { private = it }, colors = CheckboxDefaults.colors(checkedColor = Accent, checkmarkColor = AccentInk, uncheckedColor = Muted))
      Text("Mesa privada (só entra quem tiver o link)", color = TextColor, fontSize = 14.sp)
    }
    GoldButton("Criar mesa", { site.createMesa(private) }, Modifier.fillMaxWidth(), enabled = !site.busy)
  }
}

@Composable
private fun GuestCreateCard(site: SiteViewModel) {
  SiteCard {
    CardTitle("Armar uma mesa")
    MutedText("Convidados entram em qualquer mesa aberta. Para armar a sua, crie uma conta: é rapidinho.")
    GoldButton("Criar conta", site::logout, Modifier.fillMaxWidth())
  }
}

@Composable
private fun CodeCard(site: SiteViewModel) {
  var code by rememberSaveable { mutableStateOf("") }
  SiteCard {
    CardTitle("Tenho um código")
    SiteField(
      code,
      { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(12) },
      "Código da mesa",
      keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      GoldButton("Entrar", { site.openCode(code, watch = false) }, Modifier.weight(1f), enabled = code.isNotEmpty())
      DarkButton("Assistir", { site.openCode(code, watch = true) }, Modifier.weight(1f), enabled = code.isNotEmpty())
    }
  }
}

@Composable
private fun MesaCard(m: MesaSummary, onEnter: () -> Unit, onWatch: () -> Unit) {
  val open = m.phase == "lobby"
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel)
      .border(1.dp, if (open) Accent.copy(alpha = 0.55f) else FeltLine, RoundedCornerShape(18.dp)).padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(m.title, color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
      val label = PHASE_LABEL[m.phase] ?: m.phase
      Text(
        if (m.phase == "playing" || m.phase == "roundOver") "$label · rodada ${m.round}" else label,
        color = if (open) AccentInk else TextColor,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(CircleShape).background(if (open) Accent else Panel2).padding(horizontal = 10.dp, vertical = 4.dp),
      )
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      m.players.forEachIndexed { i, p ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Initial(p.name, color = PlayerColors[i % 4].copy(alpha = if (p.connected) 1f else 0.4f), size = 26.dp, bot = p.bot)
          Text(p.name, color = if (p.connected) TextColor else Muted, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (m.phase != "lobby") Text("${p.score}", color = TextColor, fontWeight = FontWeight.Bold)
        }
      }
      repeat(m.seatsFree) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Box(Modifier.padding(1.dp).clip(CircleShape).border(1.dp, FeltLine, CircleShape)) { Initial("+", color = Color.Transparent, size = 24.dp) }
          MutedText("Lugar livre", size = 15)
        }
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      MutedText("👁 ${m.spectators} assistindo", Modifier.weight(1f), size = 13)
      if (m.seatsFree > 0) GoldButton("Entrar", onEnter)
      DarkButton("Assistir", onWatch)
    }
  }
}

@Composable
private fun StatsCard(site: SiteViewModel) {
  SiteCard {
    CardTitle("Suas estatísticas")
    if (site.user == null) {
      MutedText("Você está como convidado. Crie uma conta para guardar partidas, vitórias e pontuações e aparecer no ranking.")
      DarkButton("Criar conta", site::logout)
      return@SiteCard
    }
    val s = site.stats ?: com.example.trimino.net.PlayerStats()
    val fmt = NumberFormat.getIntegerInstance(Locale.forLanguageTag("pt-BR"))
    val items =
      listOf(
        "Partidas" to fmt.format(s.matches),
        "Vitórias" to fmt.format(s.wins),
        "Aproveitamento" to if (s.matches > 0) "${Math.round(s.wins * 100.0 / s.matches)}%" else "–",
        "Melhor placar" to fmt.format(s.bestScore),
        "Pontos somados" to fmt.format(s.totalPoints),
        "Média por partida" to if (s.matches > 0) fmt.format(Math.round(s.totalPoints.toDouble() / s.matches)) else "–",
      )
    items.chunked(2).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        row.forEach { (k, v) ->
          Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(FeltDeep).padding(12.dp)) {
            MutedText(k, size = 12)
            Text(v, color = TextColor, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
          }
        }
      }
    }
  }
}

@Composable
private fun RankingCard(site: SiteViewModel) {
  SiteCard {
    CardTitle("Ranking")
    site.ranking.take(10).forEachIndexed { i, r ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${i + 1}", color = if (i < 3) Accent else Muted, fontWeight = FontWeight.Bold, modifier = Modifier.widthIn(min = 20.dp))
        Text(r.name, color = TextColor, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        MutedText(
          "${r.wins} ${if (r.wins == 1) "vitória" else "vitórias"} · ${r.matches} ${if (r.matches == 1) "partida" else "partidas"}",
          size = 12,
        )
      }
    }
  }
}
