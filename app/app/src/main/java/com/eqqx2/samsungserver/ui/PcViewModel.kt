package com.eqqx2.samsungserver.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.samsungserver.data.PcClient
import com.eqqx2.samsungserver.data.PcItem
import com.eqqx2.samsungserver.data.PcResult
import com.eqqx2.samsungserver.data.TokenStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** A wake or shutdown the Samsung server has sent but the PC hasn't confirmed yet. [until] is a clock time in ms. */
data class PcTransition(val waking: Boolean, val until: Long)

/** Words for the status chip. Every state has its own text, so colour is never the only cue. */
fun pcChipText(item: PcItem, t: PcTransition?, now: Long): String = when {
    t != null && now < t.until && t.waking && !item.online -> "Starting"
    t != null && now < t.until && !t.waking && item.online -> "Shutting down"
    item.online -> "On"
    else -> "Off"
}

fun pcWorking(item: PcItem, t: PcTransition?, now: Long) = pcChipText(item, t, now).let { it == "Starting" || it == "Shutting down" }

fun canWake(item: PcItem, t: PcTransition?, now: Long) = !item.online && !pcWorking(item, t, now)

/** Shutdown needs the SSH user set up; without one the button explains instead of failing. */
fun canShutdown(item: PcItem, t: PcTransition?, now: Long) = item.online && !pcWorking(item, t, now)

fun normalizeMacInput(s: String): String? {
    val hex = s.filter { it.isLetterOrDigit() }.lowercase()
    if (hex.length != 12 || !hex.all { it in '0'..'9' || it in 'a'..'f' }) return null
    return hex.chunked(2).joinToString(":")
}

fun macInputError(s: String): String? = if (s.isBlank() || normalizeMacInput(s) != null) null else "Use 6 pairs like AA:BB:CC:DD:EE:FF"

fun ipInputError(s: String): String? {
    if (s.isBlank()) return null
    val p = s.trim().split('.')
    val ok = p.size == 4 && p.all { it.isNotEmpty() && it.length <= 3 && it.all(Char::isDigit) && it.toInt() in 0..255 }
    if (!ok) return "Use an address like 192.168.1.20"
    val a = p[0].toInt(); val b = p[1].toInt()
    val private = a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    return if (private) null else "Use the PC's home network address (192.168.x.x, 10.x.x.x or 172.16-31.x.x)"
}

fun userInputError(s: String): String? =
    if (s.isEmpty() || Regex("^[A-Za-z0-9._-]{1,32}$").matches(s)) null else "Letters, digits, dots, dashes and underscores only"

/** Null when the text is empty or looks like an EqRGB phone link for [pcIp]: http, the PC's own address, a `t=` token. */
fun lightsLinkError(text: String, pcIp: String): String? {
    val t = text.trim()
    if (t.isEmpty()) return null
    val m = Regex("""^http://([0-9.]+)(:\d{1,5})?/[^\s#]*[?&]t=([^&\s#]{8,})""").find(t)
    return if (m != null && m.groupValues[1] == pcIp && t.length <= 400) null
    else "Paste the EqRGB phone link for this PC. It looks like http://$pcIp:47822/?t=..."
}

/** The command to paste into PowerShell on the PC, as administrator. It lets the Samsung server shut the PC down and nothing else. */
fun pcSetupCommand(key: String): String =
    "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; " +
        "Set-Service sshd -StartupType Automatic; Start-Service sshd; " +
        "\$f = \"\$env:ProgramData\\ssh\\administrators_authorized_keys\"; " +
        "Add-Content -Force \$f (\"`n\" + 'command=\"shutdown /s /t 5\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ${key.trim()}'); " +
        "icacls \$f /inheritance:r /grant \"Administrators:F\" /grant \"SYSTEM:F\""

fun pcErrorText(r: PcResult<*>, fallback: String = "Action failed"): String = when (r) {
    is PcResult.Ok -> fallback
    PcResult.Unauthorized -> "Token rejected"
    PcResult.RateLimited -> "Too many requests, try again shortly"
    PcResult.BadName -> "Give the PC a name of 40 characters or fewer"
    PcResult.BadMac -> "That isn't a MAC address. Use 6 pairs like AA:BB:CC:DD:EE:FF"
    PcResult.BadIp -> "Use the PC's home network address, like 192.168.1.20"
    PcResult.BadUser -> "That Windows user name has characters that aren't allowed"
    PcResult.BadPort -> "That isn't a valid port"
    PcResult.Exists -> "A PC with that MAC address is already added"
    is PcResult.TooMany -> "You already have the most PCs allowed" + (r.max?.let { " ($it)" } ?: "")
    PcResult.NotFound -> "That PC no longer exists"
    PcResult.TooFast -> "Just a moment, that was sent a second ago"
    PcResult.BadLink -> "That isn't the EqRGB phone link for this PC. It looks like http://192.168.0.174:47822/?t=..."
    PcResult.NoLights -> "No lights link saved for this PC yet"
    PcResult.NoSshUser -> "Set up shutdown for this PC first. Open the PC's menu and tap Set up shutdown."
    PcResult.AuthFailed -> "The PC refused the Samsung server's key. Run the setup command on the PC again."
    PcResult.Unreachable -> "The Samsung server could not reach the PC over SSH. Is it on and is OpenSSH running?"
    PcResult.SshMissing -> "ssh isn't installed on the Samsung server. In Termux run: pkg install openssh"
    PcResult.SendFailed -> "The Samsung server could not send the wake signal. Check it is on Wi-Fi."
    is PcResult.Failure -> r.message
}

data class PcState(
    val items: List<PcItem> = emptyList(),
    val key: String? = null,
    val loaded: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val transitions: Map<String, PcTransition> = emptyMap(),
    val saving: Boolean = false,
    val unauthorized: Boolean = false,
)

class PcViewModel(
    private val client: PcClient,
    private val store: TokenStore,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _state = MutableStateFlow(PcState())
    val state: StateFlow<PcState> = _state.asStateFlow()
    private var pollJob: Job? = null

    /** Polls while Overview is visible: every 3 s while a wake or shutdown is pending, every 8 s otherwise. */
    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                load()
                val now = clock()
                delay(if (_state.value.transitions.values.any { now < it.until }) 3_000 else 8_000)
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
        when (val r = client.list(store.baseUrl, token)) {
            is PcResult.Ok -> _state.update {
                it.copy(items = r.value.items, key = r.value.key, loaded = true, error = null)
            }
            PcResult.Unauthorized -> fail401()
            else -> _state.update { it.copy(error = pcErrorText(r, "Could not load PCs")) }
        }
    }

    fun add(name: String, mac: String, ip: String, sshUser: String, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        val normalized = normalizeMacInput(mac) ?: return done(pcErrorText(PcResult.BadMac))
        if (_state.value.saving) return
        _state.update { it.copy(saving = true) }
        viewModelScope.launch {
            val r = client.add(store.baseUrl, token, name.trim(), normalized, ip.trim(), sshUser.trim(), 22)
            _state.update { it.copy(saving = false) }
            when (r) {
                is PcResult.Ok -> { done(null); load() }
                PcResult.Unauthorized -> fail401()
                else -> done(pcErrorText(r, "Could not add the PC"))
            }
        }
    }

    fun wake(item: PcItem) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.wake(store.baseUrl, token, item.id)) {
                is PcResult.Ok -> _state.update {
                    it.copy(
                        message = "Wake signal sent to ${item.name}. It can take up to a minute.",
                        transitions = it.transitions + (item.id to PcTransition(true, clock() + 90_000)),
                    )
                }
                PcResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = pcErrorText(r)) }
            }
            load()
        }
    }

    fun shutdown(item: PcItem) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.shutdown(store.baseUrl, token, item.id)) {
                is PcResult.Ok -> _state.update {
                    it.copy(
                        message = "Shutdown sent to ${item.name}.",
                        transitions = it.transitions + (item.id to PcTransition(false, clock() + 60_000)),
                    )
                }
                PcResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = pcErrorText(r)) }
            }
            load()
        }
    }

    /** Asks the Samsung server for its public SSH key (making it the first time). [done] gets the key or an error text. */
    fun fetchKey(done: (key: String?, error: String?) -> Unit) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.key(store.baseUrl, token)) {
                is PcResult.Ok -> done(r.value, null)
                PcResult.Unauthorized -> fail401()
                else -> done(null, pcErrorText(r, "Could not get the Samsung server's key"))
            }
        }
    }

    fun setSshUser(item: PcItem, user: String, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.setUser(store.baseUrl, token, item.id, user.trim())) {
                is PcResult.Ok -> { done(null); load() }
                PcResult.Unauthorized -> fail401()
                else -> done(pcErrorText(r))
            }
        }
    }

    /** Saves (or, with blank text, clears) the EqRGB link. [done] gets null on success or an error text. */
    fun setLights(item: PcItem, url: String, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.setLights(store.baseUrl, token, item.id, url.trim())) {
                is PcResult.Ok -> { done(null); load() }
                PcResult.Unauthorized -> fail401()
                else -> done(pcErrorText(r))
            }
        }
    }

    /** Opens an EqRGB session through the Samsung server, so it works away from home. [done] gets the address to show or an error text. */
    fun openLights(item: PcItem, done: (url: String?, error: String?) -> Unit) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            val base = store.baseUrl.trim().trimEnd('/')
            when (val r = client.lightsSession(base, token, item.id)) {
                is PcResult.Ok -> done(base + r.value, null)
                PcResult.Unauthorized -> fail401()
                else -> done(null, pcErrorText(r))
            }
        }
    }

    fun delete(item: PcItem) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            when (val r = client.delete(store.baseUrl, token, item.id)) {
                is PcResult.Ok -> _state.update { it.copy(message = "Removed ${item.name}") }
                PcResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = pcErrorText(r)) }
            }
            load()
        }
    }

    fun showMessage(text: String) = _state.update { it.copy(message = text) }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun reset() {
        stopPolling()
        _state.value = PcState()
    }

    private fun fail401() {
        store.clearToken()
        _state.update { it.copy(unauthorized = true) }
    }

    override fun onCleared() {
        pollJob?.cancel()
    }
}
