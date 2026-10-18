package com.example.trimino.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/**
 * Botão "Continuar com o Google": abre a escolha de conta do Android e devolve o ID token, emitido para o
 * client ID da Web do site (`serverClientId`). O servidor confere o token e abre a sessão.
 * Devolve null se a pessoa fechou a janela. `context` precisa ser a Activity.
 */
suspend fun googleIdToken(context: Context, serverClientId: String): String? {
  val option = GetSignInWithGoogleOption.Builder(serverClientId).build()
  val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
  val credential =
    try {
      CredentialManager.create(context).getCredential(context, request).credential
    } catch (e: GetCredentialCancellationException) {
      return null
    } catch (e: GetCredentialException) {
      throw IllegalStateException("Não foi possível entrar com o Google.", e)
    }
  if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
    throw IllegalStateException("Resposta inesperada do Google.")
  return try {
    GoogleIdTokenCredential.createFrom(credential.data).idToken
  } catch (e: GoogleIdTokenParsingException) {
    throw IllegalStateException("Resposta inesperada do Google.", e)
  }
}
