package com.eqqx2.s21control.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.s21control.data.TokenStore
import com.eqqx2.s21control.data.VpsClient
import com.eqqx2.s21control.data.VpsDistro
import com.eqqx2.s21control.data.VpsResult
import com.eqqx2.s21control.data.VpsSlice
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Words for the status chip. Every state has its own text, so colour is never the only cue. */
fun vpsChipText(status: String): String = when (status) {
    "running" -> "Running"
    "stopped" -> "Stopped"
    "creating" -> "Setting up"
    "error" -> "Failed"
    else -> "Unknown"
}

private val NAME_RE = Regex("^[a-z]([a-z0-9-]{0,21}[a-z0-9])?$")

/** Null when the name is fine, otherwise a sentence that says how to fix it. */
fun vpsNameError(name: String): String? = when {
    name.isEmpty() -> null
    name[0] !in 'a'..'z' -> "Start with a lowercase letter"
    name.length > 23 -> "Use 23 characters or fewer"
    !NAME_RE.matches(name) -> "Use lowercase letters, digits and dashes, and don't end with a dash"
    else -> null
}

private val KEY_RE = Regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\\.com) [A-Za-z0-9+/]{20,2000}={0,2}( [A-Za-z0-9@._-]{1,60})?$")

/** Blank is fine (password login). Otherwise the text has to be one public key line. */
fun vpsKeyError(key: String): String? =
    if (key.isBlank() || KEY_RE.matches(key.trim())) null else "Paste one public key line, starting with ssh-ed25519 or ssh-rsa"

/** The command to log in. The phone address is unknown when the agent could not read it. */
fun sshCommand(slice: VpsSlice, host: String?): String = "ssh -p ${slice.port} root@${host ?: "<phone-ip>"}"

fun vpsDetail(s: VpsSlice): String = when (s.status) {
    "creating" -> (s.step ?: "Starting") + ". A first download can take a few minutes."
    "running" -> if (s.authMode == "key") "Key login only" else "Password login"
    "stopped" -> s.error ?: "Not running"
    "error" -> s.error ?: "Setup failed"
    else -> ""
}

fun canStartSlice(s: VpsSlice) = s.status == "stopped"

fun canStopSlice(s: VpsSlice) = s.status == "running"

fun isWorking(s: VpsSlice) = s.status == "creating"

fun hasWorkingSlices(items: List<VpsSlice>) = items.any(::isWorking)

const val SETUP_VPS_COMMAND = "pkg install -y proot-distro"

fun vpsErrorText(r: VpsResult<*>, fallback: String = "Action failed"): String = when (r) {
    is VpsResult.Ok -> fallback
    VpsResult.Unauthorized -> "Token rejected"
    VpsResult.RateLimited -> "Too many requests, try again shortly"
    VpsResult.BadName -> "That name or Linux choice isn't valid"
    VpsResult.BadKey -> "That isn't a public SSH key"
    VpsResult.Exists -> "A slice with that name already exists"
    is VpsResult.TooMany -> "You already have the most slices allowed" + (r.max?.let { " ($it)" } ?: "")
    VpsResult.NotFound -> "That slice no longer exists"
    VpsResult.Busy -> "That slice is busy, try again in a moment"
    VpsResult.WrongState -> "That can't be done while the slice is in this state"
    VpsResult.KeyOnly -> "This slice only accepts keys, so it has no password"
    VpsResult.EngineMissing -> "proot-distro isn't installed on the S21. In Termux run: pkg install proot-distro"
    is VpsResult.LowSpace ->
        "Not enough free space on the S21" + (r.freeBytes?.let { " (${formatBytes(it)} left)" } ?: "")
    is VpsResult.Failure -> r.message
}

/** A password the agent just handed over. It exists only in memory and is dropped when dismissed. */
data class ShownPassword(val sliceName: String, val password: String, val isNew: Boolean)

data class VpsState(
    val items: List<VpsSlice> = emptyList(),
    val distros: List<VpsDistro> = emptyList(),
    val host: String? = null,
    val engine: Boolean = true,
    val maxSlices: Int = 4,
    val freeBytes: Long? = null,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val creating: Boolean = false,
    val shown: ShownPassword? = null,
    val unauthorized: Boolean = false,
)

class VpsViewModel(
    private val client: VpsClient,
    private val store: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow(VpsState())
    val state: StateFlow<VpsState> = _state.asStateFlow()

    private var pollJob: Job? = null

    /** Polls while the screen is visible: every 2 s while a slice is being set up, every 8 s otherwise. */
    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                load()
                delay(if (hasWorkingSlices(_state.value.items)) 2_000 else 8_000)
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
            is VpsResult.Ok -> _state.update {
                it.copy(
                    items = r.value.items, distros = r.value.distros, host = r.value.host, engine = r.value.engine,
                    maxSlices = r.value.maxSlices, freeBytes = r.value.freeBytes,
                    loading = false, loaded = true, error = null,
                )
            }
            VpsResult.Unauthorized -> fail401()
            else -> _state.update { it.copy(loading = false, error = vpsErrorText(r, "Could not load slices")) }
        }
    }

    /** Creates a slice; [done] gets null on success or the friendly error text. */
    fun create(name: String, distro: String, sshKey: String, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        if (_state.value.creating) return
        _state.update { it.copy(creating = true) }
        viewModelScope.launch {
            val r = client.create(store.baseUrl, token, name.trim(), distro, sshKey)
            _state.update { it.copy(creating = false) }
            when (r) {
                is VpsResult.Ok -> {
                    r.value.password?.let { pw -> _state.update { it.copy(shown = ShownPassword(r.value.item.name, pw, true)) } }
                    done(null)
                    load()
                }
                VpsResult.Unauthorized -> fail401()
                else -> done(vpsErrorText(r, "Could not create the slice"))
            }
        }
    }

    fun start(s: VpsSlice) = action("Started ${s.name}") { token -> client.start(store.baseUrl, token, s.id) }

    fun stop(s: VpsSlice) = action("Stopped ${s.name}") { token -> client.stop(store.baseUrl, token, s.id) }

    fun delete(s: VpsSlice) = action("Deleted ${s.name}") { token -> client.delete(store.baseUrl, token, s.id) }

    fun resetPassword(s: VpsSlice) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.resetPassword(store.baseUrl, token, s.id)) {
                is VpsResult.Ok -> _state.update { it.copy(shown = ShownPassword(s.name, r.value, false)) }
                VpsResult.Unauthorized -> fail401()
                else -> _state.update { it.copy(message = vpsErrorText(r)) }
            }
        }
    }

    private fun action(success: String, call: suspend (String) -> VpsResult<*>) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            val r = call(token)
            when (r) {
                is VpsResult.Ok -> _state.update { it.copy(message = success) }
                VpsResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = vpsErrorText(r)) }
            }
            load()
        }
    }

    fun dismissPassword() = _state.update { it.copy(shown = null) }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun reset() {
        stopPolling()
        _state.value = VpsState()
    }

    private fun fail401() {
        store.clearToken()
        _state.update { it.copy(unauthorized = true, loading = false) }
    }

    override fun onCleared() {
        pollJob?.cancel()
    }
}
