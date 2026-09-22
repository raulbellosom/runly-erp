package com.racoondevs.runlyerp

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.projection.MediaProjectionManager
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.AudioOptions
import io.livekit.android.audio.NoAudioHandler
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeout

@InvokeArg
class ScreenShareArgs {
  lateinit var callId: String
  lateinit var livekitUrl: String
  lateinit var token: String
  lateinit var ownerIdentity: String
}

@TauriPlugin
class ScreenSharePlugin(private val activity: Activity) : Plugin(activity) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var room: Room? = null
  private var operation: Job? = null
  private var pending: ScreenShareArgs? = null
  private var pendingInvoke: Invoke? = null
  private var callId: String? = null
  private var active = false

  init { instance = this }

  @Command
  fun notify(invoke: Invoke) { HostNotifications.show(activity, invoke) }

  @Command
  fun currentToken(invoke: Invoke) {
    invoke.resolve(JSObject().apply { put("token", RunlyMessagingService.currentToken(activity)) })
  }

  @Command
  fun getOrigin(invoke: Invoke) {
    val origin = activity.getSharedPreferences("runly_server", Context.MODE_PRIVATE).getString("origin", null)
    invoke.resolve(JSObject().apply { put("origin", origin) })
  }

  @Command
  fun setOrigin(invoke: Invoke) {
    val args = invoke.getArgs()
    val prefs = activity.getSharedPreferences("runly_server", Context.MODE_PRIVATE)
    if (args.isNull("origin")) prefs.edit().remove("origin").apply()
    else prefs.edit().putString("origin", args.getString("origin")).apply()
    invoke.resolve()
  }

  @Command
  fun start(invoke: Invoke) {
    if (!activity.hasWindowFocus()) { invoke.reject("Abre Runly para compartir pantalla."); return }
    if (pending != null || room != null) { invoke.reject("Ya hay una solicitud de pantalla activa."); return }
    val args = invoke.parseArgs(ScreenShareArgs::class.java)
    if (!Regex("^[a-zA-Z0-9-]{1,128}$").matches(args.callId) || !Regex("^[a-zA-Z0-9-]{1,128}$").matches(args.ownerIdentity)) {
      invoke.reject("INVALID_CALL"); return
    }
    pending = args
    pendingInvoke = invoke
    val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    startActivityForResult(invoke, manager.createScreenCaptureIntent(), "captureResult")
  }

  @ActivityCallback
  private fun captureResult(invoke: Invoke, result: ActivityResult) {
    val args = pending
    pending = null
    if (pendingInvoke !== invoke) return
    pendingInvoke = null
    if (result.resultCode != Activity.RESULT_OK || result.data == null || args == null) {
      invoke.reject("No se concedió permiso para compartir pantalla."); return
    }
    val current = LiveKit.create(activity.applicationContext, overrides = LiveKitOverrides(
      audioOptions = AudioOptions(audioHandler = NoAudioHandler(), disableCommunicationModeWorkaround = true, disableAudioPrewarming = true),
    ))
    room = current
    callId = args.callId
    operation = scope.launch {
      var responded = false
      try {
        withTimeout(25_000) {
          // Companion publishes only screen video. It must not acquire audio focus,
          // microphone, camera or subscriptions owned by the existing WebView call.
          current.connect(args.livekitUrl, args.token, ConnectOptions(autoSubscribe = false, audio = false, video = false))
          val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("runly-screen-v1", "Pantalla compartida", NotificationManager.IMPORTANCE_LOW))
          val notification = NotificationCompat.Builder(activity, "runly-screen-v1")
            .setSmallIcon(R.mipmap.ic_launcher_monochrome)
            .setContentTitle("Compartiendo pantalla")
            .setContentText("Puedes detener la transmisión desde Runly o el control de Android.")
            .setOngoing(true).build()
          val published = current.localParticipant.setScreenShareEnabled(true, ScreenCaptureParams(
            mediaProjectionPermissionResultData = result.data!!,
            notificationId = 47001,
            notification = notification,
            onStop = { scope.launch { if (room === current) release() } },
          ))
          check(published) { "No se pudo publicar la pantalla." }
        }
        if (room !== current) throw IllegalStateException("Solicitud cancelada.")
        active = true
        responded = true
        invoke.resolve(snapshot())
        current.events.collect { event ->
          if (event is RoomEvent.Disconnected || (event is RoomEvent.ParticipantDisconnected && event.participant.identity?.value == args.ownerIdentity)) {
            if (room === current) release()
          }
        }
      } catch (error: Exception) {
        if (!responded) invoke.reject("No se pudo iniciar la pantalla compartida. Comprueba la conexión y vuelve a intentarlo.")
        if (room === current) release()
      }
    }
  }

  private fun snapshot() = JSObject().apply {
    put("active", active)
    put("pending", pending != null || (room != null && !active))
    put("callId", callId)
  }

  private fun release() {
    pending = null
    pendingInvoke?.reject("Solicitud cancelada.")
    pendingInvoke = null
    val current = room
    room = null
    active = false
    callId = null
    // Disconnect disposes all published tracks and their projection service.
    current?.disconnect()
    current?.release()
  }

  @Command
  fun stop(invoke: Invoke) {
    release()
    operation?.cancel()
    invoke.resolve(snapshot())
  }

  @Command
  fun status(invoke: Invoke) { invoke.resolve(snapshot()) }

  companion object {
    private var instance: ScreenSharePlugin? = null
    fun stopCurrent() {
      instance?.release()
      instance?.scope?.cancel()
      instance = null
    }
  }
}
