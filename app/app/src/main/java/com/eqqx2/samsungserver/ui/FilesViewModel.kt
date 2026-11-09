package com.eqqx2.samsungserver.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.samsungserver.data.FileEntry
import com.eqqx2.samsungserver.data.FilesClient
import com.eqqx2.samsungserver.data.FilesResult
import com.eqqx2.samsungserver.data.TokenStore
import com.eqqx2.samsungserver.data.joinPath
import com.eqqx2.samsungserver.data.parentOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.InputStream
import java.io.OutputStream

/** A local file picked for upload; [open] is called once per attempt. */
class UploadItem(val name: String, val size: Long?, val open: () -> InputStream)

data class TransferState(
    val label: String,
    val upload: Boolean,
    val done: Long = 0,
    val total: Long? = null,
    val index: Int = 1,
    val count: Int = 1,
) {
    /** 0..100, or null when the total size is unknown. */
    val percent: Int?
        get() = total?.takeIf { it > 0 }?.let { ((done * 100) / it).toInt().coerceIn(0, 100) }
}

data class FilesState(
    val path: String = "",
    val entries: List<FileEntry> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val transfer: TransferState? = null,
    val message: String? = null,
    val conflictName: String? = null,
    val unauthorized: Boolean = false,
)

class FilesViewModel(
    private val client: FilesClient,
    private val store: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow(FilesState())
    val state: StateFlow<FilesState> = _state.asStateFlow()

    private var loadJob: Job? = null
    private var transferJob: Job? = null
    private var conflictAnswer: CompletableDeferred<Boolean>? = null

    // ---- navigation / listing ----

    /** Called when the tab is entered: reloads the current folder, keeping old rows visible. */
    fun refresh() {
        val token = store.token ?: return fail401()
        val path = _state.value.path
        loadJob?.cancel()
        _state.update { it.copy(loading = true, error = null) }
        loadJob = viewModelScope.launch {
            when (val r = client.list(store.baseUrl, token, path)) {
                is FilesResult.Ok -> _state.update {
                    if (it.path != path) it else it.copy(entries = r.value.entries, loading = false, loaded = true, error = null)
                }
                else -> handleFailure(r, "Could not load this folder", clearLoading = true)
            }
        }
    }

    fun open(path: String) {
        if (_state.value.path == path) { refresh(); return }
        _state.update { it.copy(path = path, entries = emptyList(), loaded = false, error = null) }
        refresh()
    }

    /** Jumps straight to [path] (used by other tabs, e.g. Sites -> Open files). */
    fun openPath(path: String) = open(path)

    /** Goes up one folder; returns false when already at the root. */
    fun up(): Boolean {
        val p = _state.value.path
        if (p.isEmpty()) return false
        open(parentOf(p))
        return true
    }

    // ---- single-item actions ----

    fun mkdir(name: String) = action("Folder created") { token ->
        client.mkdir(store.baseUrl, token, joinPath(_state.value.path, name.trim()))
    }

    fun rename(entry: FileEntry, newName: String) = action("Renamed to ${newName.trim()}") { token ->
        val from = joinPath(_state.value.path, entry.name)
        client.rename(store.baseUrl, token, from, joinPath(parentOf(from), newName.trim()))
    }

    fun delete(entry: FileEntry) = action("Moved ${entry.name} to trash") { token ->
        client.delete(store.baseUrl, token, joinPath(_state.value.path, entry.name))
    }

    private fun action(success: String, call: suspend (String) -> FilesResult<Unit>) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = call(token)) {
                is FilesResult.Ok -> {
                    _state.update { it.copy(message = success) }
                    refresh()
                }
                else -> {
                    handleFailure(r, "Action failed", clearLoading = false)
                    if (r !is FilesResult.Unauthorized) refresh()
                }
            }
        }
    }

    // ---- transfers ----

    fun upload(items: List<UploadItem>) {
        if (items.isEmpty() || _state.value.transfer != null) return
        val token = store.token ?: return fail401()
        val dir = _state.value.path
        transferJob = viewModelScope.launch {
            var ok = 0
            var skipped = 0
            var failed: String? = null
            try {
                loop@ for ((i, item) in items.withIndex()) {
                    var overwrite = false
                    while (true) {
                        _state.update {
                            it.copy(transfer = TransferState(item.name, true, 0, item.size, i + 1, items.size))
                        }
                        val r = client.upload(
                            store.baseUrl, token, dir, item.name, overwrite, item.open, item.size,
                        ) { sent -> _state.update { s -> s.transfer?.let { t -> s.copy(transfer = t.copy(done = sent)) } ?: s } }
                        when (r) {
                            is FilesResult.Ok -> { ok++; break }
                            FilesResult.Conflict -> {
                                if (overwrite) { failed = "Could not replace ${item.name}"; break }
                                val answer = CompletableDeferred<Boolean>()
                                conflictAnswer = answer
                                _state.update { it.copy(conflictName = item.name, transfer = null) }
                                val replace = answer.await()
                                conflictAnswer = null
                                _state.update { it.copy(conflictName = null) }
                                if (replace) overwrite = true else { skipped++; break }
                            }
                            FilesResult.Unauthorized -> { fail401(); return@launch }
                            FilesResult.TooLarge -> { failed = "${item.name} is too large"; break }
                            FilesResult.RateLimited -> { failed = "Too many requests, try again shortly"; break }
                            FilesResult.NotFound -> { failed = "Destination folder no longer exists"; break }
                            is FilesResult.Failure -> { failed = "${item.name}: ${r.message}"; break }
                        }
                    }
                    if (failed != null) break@loop
                }
            } finally {
                _state.update { it.copy(transfer = null, conflictName = null) }
                conflictAnswer = null
            }
            val summary = failed ?: buildString {
                append("Uploaded $ok file").append(if (ok == 1) "" else "s")
                if (skipped > 0) append(", skipped $skipped")
            }
            _state.update { it.copy(message = summary) }
            if (_state.value.path == dir) refresh()
        }
    }

    fun answerConflict(replace: Boolean) {
        conflictAnswer?.complete(replace)
    }

    fun download(entry: FileEntry, openSink: () -> OutputStream?) {
        if (_state.value.transfer != null) return
        val token = store.token ?: return fail401()
        val path = joinPath(_state.value.path, entry.name)
        transferJob = viewModelScope.launch {
            val sink = try { openSink() } catch (e: Exception) { null }
            if (sink == null) {
                _state.update { it.copy(message = "Could not open the destination file") }
                return@launch
            }
            _state.update { it.copy(transfer = TransferState(entry.name, false, 0, entry.size.takeIf { s -> s > 0 })) }
            try {
                val r = sink.use {
                    client.download(store.baseUrl, token, path, it) { got ->
                        _state.update { s -> s.transfer?.let { t -> s.copy(transfer = t.copy(done = got)) } ?: s }
                    }
                }
                when (r) {
                    is FilesResult.Ok -> _state.update { it.copy(message = "Downloaded ${entry.name}") }
                    FilesResult.Unauthorized -> fail401()
                    FilesResult.NotFound -> _state.update { it.copy(message = "${entry.name} no longer exists") }
                    FilesResult.RateLimited -> _state.update { it.copy(message = "Too many requests, try again shortly") }
                    FilesResult.Conflict, FilesResult.TooLarge ->
                        _state.update { it.copy(message = "Download failed") }
                    is FilesResult.Failure -> _state.update { it.copy(message = "Download failed: ${r.message}") }
                }
            } finally {
                _state.update { it.copy(transfer = null) }
            }
        }
    }

    fun cancelTransfer() {
        conflictAnswer?.complete(false)
        transferJob?.cancel()
        _state.update { it.copy(transfer = null, conflictName = null, message = "Transfer cancelled") }
    }

    // ---- misc ----

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun reset() {
        loadJob?.cancel()
        transferJob?.cancel()
        _state.value = FilesState()
    }

    private fun fail401() {
        store.clearToken()
        _state.update { it.copy(unauthorized = true, loading = false) }
    }

    private fun handleFailure(r: FilesResult<*>, fallback: String, clearLoading: Boolean) {
        val msg = when (r) {
            FilesResult.Unauthorized -> { fail401(); return }
            FilesResult.RateLimited -> "Too many requests, try again shortly"
            FilesResult.Conflict -> "An item with that name already exists"
            FilesResult.TooLarge -> "That file is too large"
            FilesResult.NotFound -> "That item was not found"
            is FilesResult.Failure -> r.message
            else -> fallback
        }
        _state.update {
            if (clearLoading) it.copy(loading = false, error = msg) else it.copy(message = msg)
        }
    }

    override fun onCleared() {
        loadJob?.cancel()
        transferJob?.cancel()
    }
}
