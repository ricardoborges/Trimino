package com.example.trimino.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.trimino.auth.googleIdToken
import kotlinx.coroutines.launch

/** Entrada, como a landing do site: o herói, o cartão de login (conta, Google ou convidado) e as regras. */
@Composable
fun LandingScreen(site: SiteViewModel) {
  val scroll = rememberScrollState()
  Box(
    Modifier.fillMaxSize()
      .background(Brush.verticalGradient(listOf(Color(0xFF0B2219), FeltDeep, Color(0xFF0B2219))))
  ) {
    Column(Modifier.fillMaxSize().verticalScroll(scroll).safeDrawingPadding()) {
      SiteNav(null)
      Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).widthIn(max = 560.dp).align(Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(20.dp),
      ) {
        Hero()
        AuthCard(site)
        Rules()
        Footer(site)
      }
    }
  }
}

@Composable
private fun Hero() {
  Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Row(
      Modifier.clip(CircleShape).background(Accent.copy(alpha = 0.1f)).border(1.dp, Accent.copy(alpha = 0.25f), CircleShape)
        .padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Box(Modifier.size(7.dp).background(Accent, CircleShape))
      Text("Dominó triangular · 2 a 4 jogadores", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
    Text(
      goldTitle("O jogo de dominó preferido da família, ", "agora também online"),
      color = TextColor,
      fontSize = 34.sp,
      lineHeight = 38.sp,
      fontWeight = FontWeight.ExtraBold,
    )
    MutedText("Monte pontes e mandalas, para jogar com a família e amigos de qualquer lugar.", size = 17)
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      for (fact in listOf("Grátis", "Vídeo na mesa", "Ranking")) Text("✓ $fact", color = Muted, fontSize = 14.sp)
    }
    // Pedras espalhadas, como no herói sem WebGL.
    Box(Modifier.fillMaxWidth().height(96.dp)) {
      val tiles = listOf(listOf(5, 5, 5), listOf(0, 2, 4), listOf(1, 3, 5), listOf(3, 3, 4), listOf(2, 5, 0))
      tiles.forEachIndexed { i, v ->
        PipTile(v, 62.dp, modifier = Modifier.offset(x = (i * 64).dp, y = if (i % 2 == 0) 4.dp else 30.dp).rotate((i - 2) * 9f))
      }
    }
  }
}

private enum class AuthTab(val label: String) { Login("Entrar"), Signup("Criar conta"), Guest("Convidado") }

@Composable
private fun AuthCard(site: SiteViewModel) {
  val invite = site.invitedTo
  var tab by rememberSaveable { mutableStateOf(if (invite != null) AuthTab.Guest else AuthTab.Login) }
  LaunchedEffect(invite) { if (invite != null) tab = AuthTab.Guest }
  val context = LocalContext.current
  val scope = rememberCoroutineScope()

  SiteCard {
    Text("Sente-se à mesa", color = TextColor, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
    MutedText("Entre para jogar ou para assistir uma partida.")
    if (invite != null) {
      Text(
        "Você foi chamado para a mesa ${invite.room}. Entre para sentar.",
        color = Accent,
        fontSize = 14.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Accent.copy(alpha = 0.1f)).padding(12.dp),
      )
    }
    // Abas
    Row(Modifier.fillMaxWidth().clip(CircleShape).background(FeltDeep).padding(4.dp)) {
      for (t in AuthTab.entries) {
        val on = t == tab
        Box(
          Modifier.weight(1f).clip(CircleShape).background(if (on) Panel2 else Color.Transparent)
            .clickable { tab = t; site.authError = null }.padding(vertical = 9.dp),
          contentAlignment = Alignment.Center,
        ) {
          Text(t.label, color = if (on) TextColor else Muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
      }
    }

    val clientId = site.config.googleClientId
    if (clientId != null && tab != AuthTab.Guest) {
      GoogleButton(enabled = !site.busy) {
        scope.launch {
          try {
            googleIdToken(context, clientId)?.let(site::google)
          } catch (e: Exception) {
            site.googleFailed(e.message ?: "Não foi possível entrar com o Google.")
          }
        }
      }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(Modifier.weight(1f), color = FeltLine)
        MutedText("ou", size = 13)
        HorizontalDivider(Modifier.weight(1f), color = FeltLine)
      }
    }

    when (tab) {
      AuthTab.Login -> LoginForm(site)
      AuthTab.Signup -> SignupForm(site)
      AuthTab.Guest -> GuestForm(site)
    }
    site.authError?.let { Text(it, color = Color(0xFFFFB3AA), fontSize = 14.sp) }
  }
}

@Composable
private fun GoogleButton(enabled: Boolean, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(CircleShape).background(Color.White).clickable(enabled = enabled, onClick = onClick)
      .padding(horizontal = 18.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.Center,
  ) {
    Text("G", color = Color(0xFF4285F4), fontSize = 20.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.size(10.dp))
    Text("Continuar com o Google", color = Color(0xFF1F1F1F), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
  }
}

@Composable
private fun LoginForm(site: SiteViewModel) {
  var email by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  SiteField(email, { email = it }, "E-mail", keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
  SiteField(password, { password = it }, "Senha", password = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Password))
  GoldButton("Entrar", { site.login(email, password) }, Modifier.fillMaxWidth(), enabled = !site.busy && email.isNotBlank() && password.isNotEmpty())
}

@Composable
private fun SignupForm(site: SiteViewModel) {
  var name by rememberSaveable { mutableStateOf("") }
  var email by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  SiteField(name, { name = it.take(24) }, "Seu nome", keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
  SiteField(email, { email = it }, "E-mail", keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
  SiteField(password, { password = it }, "Senha", password = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Password))
  MutedText("Pelo menos 8 caracteres. Com conta, suas partidas entram nas estatísticas e no ranking.", size = 13)
  GoldButton(
    "Criar conta",
    { site.signup(name, email, password) },
    Modifier.fillMaxWidth(),
    enabled = !site.busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
  )
}

@Composable
private fun GuestForm(site: SiteViewModel) {
  var name by rememberSaveable { mutableStateOf(site.lastName) }
  SiteField(name, { name = it.take(24) }, "Como quer ser chamado?", keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
  MutedText("Sem cadastro. Convidados entram nas mesas já abertas, mas não armam mesas, e as partidas não contam para o ranking.", size = 13)
  GoldButton("Entrar como convidado", { site.enterAsGuest(name) }, Modifier.fillMaxWidth(), enabled = name.isNotBlank())
}

@Composable
private fun Rules() {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 12.dp)) {
    Text("COMO SE JOGA", color = Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
    Text(goldTitle("Simples de aprender. ", "Difícil de largar."), color = TextColor, fontSize = 26.sp, lineHeight = 30.sp, fontWeight = FontWeight.ExtraBold)
    val steps =
      listOf(
        Triple("01", "Encaixe as pontas" to null, "Cada pedra tem três números. Os dois cantos que encostam na mesa precisam bater."),
        Triple("02", "Faça uma ponte" to "+40", "Encoste um canto numa pedra do outro lado e ganhe pontos extras pela travessia."),
        Triple("03", "Feche a mandala" to "+50", "Seis pedras em volta de um ponto. É a jogada mais bonita da mesa, e a mais comemorada."),
        Triple("04", "Bata primeiro" to "+25", "Quem se livra da última pedra leva o bônus e os pontos que sobraram na mão dos outros."),
      )
    for ((num, head, body) in steps) {
      Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel.copy(alpha = 0.7f)).border(1.dp, FeltLine.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
          .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        Text(num, color = Accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(head.first, color = TextColor, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            head.second?.let {
              Text(it, color = AccentInk, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(CircleShape).background(GoldGrad).padding(horizontal = 8.dp, vertical = 2.dp))
            }
          }
          MutedText(body)
        }
      }
    }
  }
}

@Composable
private fun Footer(site: SiteViewModel) {
  var editing by rememberSaveable { mutableStateOf(false) }
  Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    MutedText("Feito para jogar com quem a gente gosta.", size = 13)
    Text(
      "Servidor: ${site.server.removePrefix("https://").removePrefix("http://")}",
      color = Muted.copy(alpha = 0.7f),
      fontSize = 12.sp,
      modifier = Modifier.clickable { editing = true }.padding(6.dp),
    )
  }
  if (editing) {
    var url by rememberSaveable { mutableStateOf(site.server) }
    AlertDialog(
      onDismissRequest = { editing = false },
      title = { Text("Servidor") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          SiteField(url, { url = it }, "Endereço do site", keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri))
          MutedText("No emulador: http://10.0.2.2:8787. Num aparelho na mesma rede: http://<IP-da-máquina>:8787.", size = 12)
        }
      },
      confirmButton = { TextButton({ editing = false; site.changeServer(url) }) { Text("Salvar") } },
      dismissButton = { TextButton({ editing = false }) { Text("Cancelar") } },
    )
  }
}
