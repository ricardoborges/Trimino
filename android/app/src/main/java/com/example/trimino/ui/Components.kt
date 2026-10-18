package com.example.trimino.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Dourado dos botões e destaques da landing (`--gold-grad`). */
val GoldGrad = Brush.verticalGradient(listOf(Color(0xFFF7C863), Color(0xFFE59F24)))
val AccentInk = Color(0xFF2B1D00)
val TextColor = Color(0xFFE9F1EC)

/** Cartão como o `.card` do site. */
@Composable
fun SiteCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Panel).border(1.dp, FeltLine, RoundedCornerShape(20.dp)).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
    content = content,
  )
}

@Composable
fun CardTitle(text: String) = Text(text, color = TextColor, fontSize = 20.sp, fontWeight = FontWeight.Bold)

@Composable
fun MutedText(text: String, modifier: Modifier = Modifier, size: Int = 14) = Text(text, color = Muted, fontSize = size.sp, modifier = modifier)

/** Botão principal: pílula dourada. */
@Composable
fun GoldButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  Button(
    onClick,
    enabled = enabled,
    shape = CircleShape,
    colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = AccentInk, disabledContainerColor = Color.Transparent),
    contentPadding = ButtonDefaults.ContentPadding,
    modifier = modifier.heightIn(min = 46.dp).clip(CircleShape).background(if (enabled) GoldGrad else SolidColor(Accent.copy(alpha = 0.4f))),
  ) {
    Text(text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = AccentInk)
  }
}

/** Botão secundário: pílula escura com contorno (`.secondary`). */
@Composable
fun DarkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  OutlinedButton(
    onClick,
    enabled = enabled,
    shape = CircleShape,
    colors = ButtonDefaults.outlinedButtonColors(containerColor = Panel2, contentColor = TextColor),
    border = BorderStroke(1.dp, FeltLine),
    modifier = modifier.heightIn(min = 46.dp),
  ) {
    Text(text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
  }
}

@Composable
fun SiteField(
  value: String,
  onChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier,
  password: Boolean = false,
  keyboard: KeyboardOptions = KeyboardOptions.Default,
) {
  OutlinedTextField(
    value,
    onChange,
    label = { Text(label) },
    singleLine = true,
    visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
    keyboardOptions = keyboard,
    shape = RoundedCornerShape(10.dp),
    colors =
      OutlinedTextFieldDefaults.colors(
        focusedContainerColor = FeltDeep,
        unfocusedContainerColor = FeltDeep,
        focusedBorderColor = Accent,
        unfocusedBorderColor = FeltLine,
        focusedLabelColor = Accent,
        unfocusedLabelColor = Muted,
        cursorColor = Accent,
      ),
    modifier = modifier.fillMaxWidth(),
  )
}

/** Logo: a pedra 1-3-5 do jogo, como no site. */
@Composable
fun LogoMark(size: Dp = 28.dp) = PipTile(listOf(1, 3, 5), size)

/** Barra do topo do site: logo, título e o que vier à direita. */
@Composable
fun SiteNav(title: String?, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
  Row(
    modifier.fillMaxWidth().background(Color(0xC7091E16)).padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    LogoMark(26.dp)
    Text("Triminó", color = TextColor, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
    if (title != null) Text(title, color = Muted, fontSize = 15.sp)
    Box(Modifier.weight(1f))
    trailing()
  }
}

/** Título com a parte em destaque dourada, como o `<em>` da landing. */
fun goldTitle(plain: String, gold: String) = buildAnnotatedString {
  append(plain)
  withStyle(SpanStyle(color = Accent)) { append(gold) }
}

/** Avatar redondo com a inicial (ou 🤖 para robôs). */
@Composable
fun Initial(name: String, color: Color = Panel2, size: Dp = 28.dp, bot: Boolean = false) {
  Box(Modifier.size(size).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
    Text(if (bot) "🤖" else name.take(1).uppercase(), color = TextColor, fontSize = (size.value * 0.45f).sp, fontWeight = FontWeight.Bold)
  }
}

/** Pílula pequena (`.chip`). */
@Composable
fun Chip(text: String, onClick: (() -> Unit)? = null, color: Color = TextColor, borderColor: Color = FeltLine) {
  val base = Modifier.clip(CircleShape).background(Color(0x40000000)).border(1.dp, borderColor, CircleShape)
  Text(
    text,
    color = color,
    fontSize = 13.sp,
    maxLines = 1,
    modifier = (if (onClick != null) base.clickable(onClick = onClick) else base).padding(horizontal = 12.dp, vertical = 5.dp),
  )
}
