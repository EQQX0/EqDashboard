package com.eqqx2.samsungserver.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.samsungserver.data.DownloadEngines
import com.eqqx2.samsungserver.data.DownloadItem
import com.eqqx2.samsungserver.data.DownloadMode
import com.eqqx2.samsungserver.data.DownloadsClient
import com.eqqx2.samsungserver.data.DownloadsResult
import com.eqqx2.samsungserver.data.TokenStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Words for the status chip. Every state has its own text, so colour is never the only cue. */
fun downloadChipText(status: String): String = when (status) {
    "active" -> "Downloading"
    "queued" -> "Queued"
    "paused" -> "Paused"
    "complete" -> "Done"
    "error" -> "Failed"
    else -> "Unknown"
}

fun downloadPercent(i: DownloadItem): Int? =
    if (i.totalBytes > 0) ((i.doneBytes * 100) / i.totalBytes).toInt().coerceIn(0, 100) else null

fun formatEta(sec: Long): String = when {
    sec < 60 -> "$sec s"
    sec < 3_600 -> "${sec / 60} min"
    else -> "${sec / 3_600} h ${(sec % 3_600) / 60} min"
}

fun formatSpeed(bytesPerSec: Long): String = formatBytes(bytesPerSec) + "/s"

/** One line under the progress bar. Leaves out any part the agent could not measure. */
fun downloadDetail(i: DownloadItem): String = when (i.status) {
    "active" -> {
        val parts = mutableListOf<String>()
        downloadPercent(i)?.let { parts += "$it%" }
        parts += if (i.totalBytes > 0) "${formatBytes(i.doneBytes)} of ${formatBytes(i.totalBytes)}" else formatBytes(i.doneBytes)
        if (i.speedBps > 0) parts += formatSpeed(i.speedBps)
        i.etaSec?.let { parts += "${formatEta(it)} left" }
        parts.joinToString(" • ")
    }
    "queued" -> "Waiting to start"
    "paused" -> downloadPercent(i)?.let { "Paused at $it% • ${formatBytes(i.doneBytes)}" } ?: "Paused"
    "complete" -> if (i.totalBytes > 0) formatBytes(i.totalBytes) else "Saved to Files"
    "error" -> i.error ?: "Download failed"
    else -> ""
}

fun canPause(i: DownloadItem) = i.status == "active" || i.status == "queued"

fun canResume(i: DownloadItem) = i.status == "paused"

/** Video downloads can be restarted after a failure; a failed aria2 download has to be added again. */
fun canRetry(i: DownloadItem) = i.status == "error" && i.engine == "ytdlp"

fun hasLiveDownloads(items: List<DownloadItem>) = items.any { it.status == "active" || it.status == "queued" }

private val LINK_RE = Regex("^(https?://|ftp://|magnet:\\?)\\S+$", RegexOption.IGNORE_CASE)

/** True when the pasted text looks like something the agent accepts. The agent still validates it. */
fun looksLikeLink(text: String): Boolean = LINK_RE.matches(text.trim())

const val SETUP_DOWNLOADS_COMMAND = "pkg install -y aria2 ffmpeg python && pip install -U yt-dlp"

fun downloadsErrorText(r: DownloadsResult<*>, fallback: String = "Action failed"): String = when (r) {
    is DownloadsResult.Ok -> fallback
    DownloadsResult.Unauthorized -> "Token rejected"
    DownloadsResult.RateLimited -> "Too many requests, try again shortly"
    DownloadsResult.BadUrl -> "That isn't a link the server can download. Use http, https, ftp or a magnet link."
    DownloadsResult.Blocked -> "Links to the server itself aren't allowed"
    DownloadsResult.NotFound -> "That download no longer exists"
    DownloadsResult.EngineError -> "The download engine refused the link"
    is DownloadsResult.EngineMissing ->
        if (r.engine == "aria2") "aria2 isn't installed on the Samsung server. In Termux run: pkg install aria2"
        else "yt-dlp isn't installed on the Samsung server. In Termux run: pip install -U yt-dlp"
    is DownloadsResult.LowSpace ->
        "Not enough free space on the Samsung server" + (r.freeBytes?.let { " (${formatBytes(it)} left)" } ?: "")
    is DownloadsResult.Failure -> r.message
}

data class DownloadsState(
    val items: List<DownloadItem> = emptyList(),
    val engines: DownloadEngines = DownloadEngines(),
    val freeBytes: Long? = null,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val adding: Boolean = false,
    val unauthorized: Boolean = false,
)

class DownloadsViewModel(
    private val client: DownloadsClient,
    private val store: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow(DownloadsState())
    val state: StateFlow<DownloadsState> = _state.asStateFlow()

    private var pollJob: Job? = null

    /** Polls while the screen is visible: every 2 s while something runs, every 8 s otherwise. */
    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                load()
                delay(if (hasLiveDownloads(_state.value.items)) 2_000 else 8_000)
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        val token = store.token ?: return fail401()
        if (!_state.value.loaded) _state.update { it.copy(loading = true) }
        when (val r = client.list(store.baseUrl, token)) {
            is DownloadsResult.Ok -> _state.update {
                it.copy(
                    items = r.value.items, engines = r.value.engines, freeBytes = r.value.freeBytes,
                    loading = false, loaded = true, error = null,
                )
            }
            DownloadsResult.Unauthorized -> fail401()
            else -> _state.update { it.copy(loading = false, error = downloadsErrorText(r, "Could not load downloads")) }
        }
    }

    /** Starts a download; [done] gets null on success or the friendly error text. */
    fun add(url: String, mode: DownloadMode, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        if (_state.value.adding) return
        _state.update { it.copy(adding = true) }
        viewModelScope.launch {
            val r = client.add(store.baseUrl, token, url.trim(), mode)
            _state.update { it.copy(adding = false) }
            when (r) {
                is DownloadsResult.Ok -> {
                    _state.update { it.copy(message = "Added ${r.value.name.ifBlank { "download" }}") }
                    done(null)
                    load()
                }
                DownloadsResult.Unauthorized -> fail401()
                else -> done(downloadsErrorText(r, "Could not add the download"))
            }
        }
    }

    fun pause(item: DownloadItem) = action { token -> client.pause(store.baseUrl, token, item.id) }

    fun resume(item: DownloadItem) = action { token -> client.resume(store.baseUrl, token, item.id) }

    /** Retry restarts a failed video download. */
    fun retry(item: DownloadItem) = resume(item)

    fun remove(item: DownloadItem) = action(
        if (item.status == "complete") "Removed from the list. The file is still in Files." else "Removed ${item.name}",
    ) { token -> client.remove(store.baseUrl, token, item.id) }

    private fun action(success: String? = null, call: suspend (String) -> DownloadsResult<*>) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            val r = call(token)
            when (r) {
                is DownloadsResult.Ok -> if (success != null) _state.update { it.copy(message = success) }
                DownloadsResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = downloadsErrorText(r)) }
            }
            load()
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun reset() {
        stopPolling()
        _state.value = DownloadsState()
    }

    private fun fail401() {
        store.clearToken()
        _state.update { it.copy(unauthorized = true, loading = false) }
    }

    override fun onCleared() {
        pollJob?.cancel()
    }
}
