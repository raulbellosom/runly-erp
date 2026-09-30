package com.racoondevs.runlyerp

import android.os.Build
import android.os.Bundle
import java.lang.ref.WeakReference
import android.content.Intent
import android.webkit.WebView
import android.webkit.WebSettings
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = true

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    currentWebView = WeakReference(webView)
    applyRendererPriority(webView)
    // Preserve the real Chromium/Android UA for LiveKit and browser feature detection.
    webView.settings.userAgentString = WebSettings.getDefaultUserAgent(this) + " AtlasNativeHost/1.0"
    webView.settings.setSupportMultipleWindows(false)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    normalizeIntent(intent)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    normalizeIntent(intent)
    super.onNewIntent(intent)
  }

  override fun onPause() {
    super.onPause()
    // WryActivity pauses the WebView on every onPause (screen lock, app switch),
    // which suspends the live call. Undo it while a call is in progress.
    if (CallKeepAliveService.running) currentWebView?.get()?.onResume()
  }

  override fun onDestroy() {
    ScreenSharePlugin.stopCurrent()
    CallKeepAliveService.stop(this)
    super.onDestroy()
  }

  companion object {
    private var currentWebView: WeakReference<WebView>? = null

    // Keep the WebView renderer at foreground priority while hidden during a
    // call so the system doesn't kill it with the screen locked.
    private fun applyRendererPriority(webView: WebView) {
      if (Build.VERSION.SDK_INT < 26) return
      webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !CallKeepAliveService.running)
    }

    fun keepWebViewAlive(active: Boolean) {
      val webView = currentWebView?.get() ?: return
      webView.post {
        applyRendererPriority(webView)
        if (active) webView.onResume()
      }
    }
  }

  private fun normalizeIntent(intent: Intent) {
    // Tao 0.35's JNI intent handler unwraps a null getType() for VIEW/SEND.
    // Preserve URI/extras and provide a neutral MIME before entering Rust.
    // URI authorization remains in the deep-link parser; MIME grants no access.
    if (intent.type == null && intent.action in listOf(Intent.ACTION_VIEW, Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) {
      intent.setDataAndType(intent.data, "application/octet-stream")
    }
  }
}
