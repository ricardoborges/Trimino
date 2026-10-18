import java.net.URI
import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.example.trimino"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.example.trimino"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"

        // Endereço do site (o mesmo da Web). Troque com -Ptrimino.server=https://seu-dominio no build ou na tela de
        // entrada do app. O padrão é o wrangler dev visto de dentro do emulador (10.0.2.2 é o localhost da máquina).
        val server = (findProperty("trimino.server") as String?) ?: "http://10.0.2.2:8787"
        buildConfigField("String", "DEFAULT_SERVER", "\"$server\"")
        // Os links de convite (https://<host>/mesa/CODIGO) abrem direto no app.
        manifestPlaceholders["triminoHost"] = URI(server).host
    }

    // Chave de release fora do repositório: ~/.android/trimino-release.properties (storeFile, storePassword,
    // keyAlias, keyPassword), ou outro arquivo com -Ptrimino.signing=caminho. Sem ele, o release sai sem assinatura.
    val signingFile = file((findProperty("trimino.signing") as String?) ?: "${System.getProperty("user.home")}/.android/trimino-release.properties")
    signingConfigs {
        if (signingFile.exists()) {
            create("release") {
                val p = Properties().apply { signingFile.inputStream().use(::load) }
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
            // Só celulares ARM: o WebRTC nativo de x86 dobraria o APK (o site serve arquivos de até 25 MiB).
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = true
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons)
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Rede, protocolo e WebRTC
  implementation(libs.okhttp)
  implementation(libs.kotlinx.serialization.json)
  implementation(libs.stream.webrtc)

  // Login com Google (Credential Manager)
  implementation(libs.androidx.credentials)
  implementation(libs.androidx.credentials.play.services)
  implementation(libs.googleid)
}
