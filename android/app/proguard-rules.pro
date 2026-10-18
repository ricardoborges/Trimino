# WebRTC: a biblioteca nativa chama as classes Java por JNI, pelo nome.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Login com Google (Credential Manager): o provedor do Play Services é carregado por reflexão.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }

# Protocolo (kotlinx.serialization): as classes @Serializable e seus serializers gerados.
-keep,includedescriptorclasses class com.example.trimino.net.**$$serializer { *; }
-keepclassmembers class com.example.trimino.net.** { *** Companion; kotlinx.serialization.KSerializer serializer(...); }
-keepattributes *Annotation*, InnerClasses
