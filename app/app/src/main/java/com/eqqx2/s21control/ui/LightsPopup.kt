package com.eqqx2.s21control.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.net.URI

/**
 * True when [request] is https on the same host and port as [start] and stays under [start]'s path
 * (the S21's /pc/lights/r/<session>/). Keeps the popup inside its one session.
 */
fun lightsRequestAllowed(start: String, request: String): Boolean = try {
    val a = URI(start)
    val b = URI(request)
    val prefix = a.rawPath ?: ""
    a.scheme.equals("https", ignoreCase = true) && b.scheme.equals("https", ignoreCase = true) &&
        a.host != null && a.host.equals(b.host, ignoreCase = true) && effectivePort(a) == effectivePort(b) &&
        prefix.startsWith("/pc/lights/r/") && prefix.endsWith("/") && (b.rawPath ?: "").let {
            it.startsWith(prefix) && !it.contains("..") && !it.contains("%2e", ignoreCase = true)
        }
} catch (e: Exception) {
    false
}

private fun effectivePort(u: URI) = if (u.port == -1) 443 else u.port

private val PopupBg = Color(0xFF14090C)

/** A small window that shows the EqRGB phone remote, relayed by the S21. Only that one session's pages can load in it. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LightsPopup(name: String, url: String, reduce: Boolean, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false),
    ) {
        Column(
            Modifier
                .fillMaxWidth(0.94f)
                .fillMaxHeight(0.62f)
                .clip(S21Shapes.Stat)
                .background(PopupBg)
                .border(1.dp, S21Colors.NavBorder, S21Shapes.Stat),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("EqRGB • $name", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1)
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clip(S21Shapes.Pill)
                        .clickable(role = Role.Button, onClickLabel = "Close lights", onClick = onClose)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Close", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            }
            Box(Modifier.fillMaxSize()) {
                if (!failed) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            WebView(context).apply {
                                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                                setBackgroundColor(android.graphics.Color.parseColor("#14090C"))
                                settings.apply {
                                    javaScriptEnabled = true // EqRGB's remote is a web app
                                    domStorageEnabled = true
                                    allowFileAccess = false
                                    allowContentAccess = false
                                    setSupportMultipleWindows(false)
                                    cacheMode = WebSettings.LOAD_NO_CACHE
                                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                                }
                                webViewClient = object : WebViewClient() {
                                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                                        !lightsRequestAllowed(url, request.url.toString())

                                    override fun onPageStarted(view: WebView, u: String?, favicon: Bitmap?) { loading = true }
                                    override fun onPageFinished(view: WebView, u: String?) { loading = false }
                                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                        if (request.isForMainFrame) { failed = true; loading = false }
                                    }

                                    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                                        // 404 = the session ended, 502 = the PC is off or EqRGB is closed
                                        if (request.isForMainFrame) { failed = true; loading = false }
                                    }
                                }
                                loadUrl(url)
                            }
                        },
                        onRelease = { web ->
                            // The link carries a token: leave nothing behind in cookies, cache or history.
                            web.stopLoading()
                            web.clearHistory()
                            web.clearCache(true)
                            CookieManager.getInstance().removeAllCookies(null)
                            web.destroy()
                        },
                    )
                }
                if (loading && !failed) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (reduce) Text("Loading EqRGB", color = Color.White, fontSize = 16.sp)
                        else CircularProgressIndicator(
                            color = Color.White, trackColor = S21Colors.BarFill,
                            modifier = Modifier.semantics { contentDescription = "Loading EqRGB" },
                        )
                    }
                }
                if (failed) {
                    Column(
                        Modifier.fillMaxSize().padding(24.dp).semantics { liveRegion = LiveRegionMode.Polite },
                        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Can't reach EqRGB", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Is the PC on, EqRGB running and its phone remote turned on? If you made a new link in EqRGB, add it again with Lights link.",
                            color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                        )
                        PrimaryPillButton("Try again", modifier = Modifier.fillMaxWidth()) { failed = false; loading = true }
                    }
                }
            }
        }
    }
}
