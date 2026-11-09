package com.eqqx2.s21control.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.s21control.data.CheckResult
import com.eqqx2.s21control.data.SiteInfo
import com.eqqx2.s21control.data.SitesClient
import com.eqqx2.s21control.data.SitesResult
import com.eqqx2.s21control.data.TokenStore
import com.eqqx2.s21control.data.TunnelListing
import com.eqqx2.s21control.data.TunnelRoute
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.time.Instant

sealed interface SiteReach {
    data object Unknown : SiteReach
    data object Checking : SiteReach
    data object Live : SiteReach
    data class NotReady(val reason: String) : SiteReach
}

private val SETUP_REASONS = setOf("dns", "tls", "connection", "not_ours")

/** Maps a server check result to the reachability shown on the card. */
fun reachFromCheck(r: CheckResult): SiteReach =
    if (r.reachable) SiteReach.Live else SiteReach.NotReady(r.error ?: "unknown")

/** Text of the status chip. Never colour-only: every state has its own words. */
fun siteChipText(enabled: Boolean, reach: SiteReach): String = when {
    !enabled -> "Offline"
    reach is SiteReach.Live -> "Live"
    reach is SiteReach.NotReady -> "Not reachable yet"
    else -> "Checking"
}

/** Tunnel hostnames hosted outside this tool: hides the agent's own API route and the sites wildcard. */
fun externalRoutes(l: TunnelListing): List<TunnelRoute> =
    l.routes.filter { it.kind == "app" && !it.hostname.startsWith("*.") }

/** Text of a tunnel route's chip. Never colour-only. */
fun tunnelChipText(up: Boolean?): String = when (up) {
    true -> "Running"
    false -> "Not running"
    null -> "Not checked"
}

fun tunnelMeta(r: TunnelRoute): String = if (r.port != null) "Local port ${r.port}" else r.service

/** Only http(s) services can be opened in a browser. */
fun isWebRoute(r: TunnelRoute): Boolean = r.service.startsWith("http://") || r.service.startsWith("https://")

/** Show the first-time setup card when enabled sites were checked, none is live, and one fails for a setup reason. */
fun needsSetupHelp(sites: List<SiteInfo>, reach: Map<String, SiteReach>): Boolean {
    val checked = sites.filter { it.enabled }.mapNotNull { reach[it.name] }
        .filter { it is SiteReach.Live || it is SiteReach.NotReady }
    if (checked.isEmpty() || checked.any { it is SiteReach.Live }) return false
    return checked.any { it is SiteReach.NotReady && it.reason in SETUP_REASONS }
}

/** "12 files • 337.1 KB • updated 2 h ago" */
fun siteMeta(site: SiteInfo, nowMs: Long): String {
    val files = "${site.files} file" + if (site.files == 1) "" else "s"
    val parts = mutableListOf(files, formatBytes(site.bytes))
    val ms = site.modified?.let { try { Instant.parse(it).toEpochMilli() } catch (e: Exception) { null } }
    if (ms != null) parts += "updated " + formatSiteAge(nowMs - ms)
    return parts.joinToString(" • ")
}

fun formatSiteAge(ms: Long): String {
    val s = ms.coerceAtLeast(0) / 1000
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> "${s / 86_400} d ago"
    }
}

/** Friendly text for any failed result. */
fun sitesErrorText(r: SitesResult<*>, fallback: String = "Action failed"): String = when (r) {
    is SitesResult.Ok -> fallback
    SitesResult.Unauthorized -> "Token rejected"
    SitesResult.RateLimited -> "Too many requests, try again shortly"
    SitesResult.Conflict -> "A site with that name already exists"
    SitesResult.BadName -> "Use 1-32 lowercase letters, numbers or hyphens"
    SitesResult.Reserved -> "That name is reserved"
    SitesResult.NotFound -> "That site was not found"
    SitesResult.TooLarge -> "Too big. Cloudflare allows 100 MB per upload"
    SitesResult.BadZip -> "That isn't a valid zip file"
    SitesResult.UnsafeZip -> "The zip contains files that aren't allowed (paths outside the site, links)"
    SitesResult.Busy -> "Another change is in progress"
    is SitesResult.Failure -> r.message
}

data class DeployState(
    val site: String,
    val done: Long = 0,
    val total: Long? = null,
) {
    val percent: Int?
        get() = total?.takeIf { it > 0 }?.let { ((done * 100) / it).toInt().coerceIn(0, 100) }
}

data class SitesState(
    val sites: List<SiteInfo> = emptyList(),
    val domain: String = "",
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val reach: Map<String, SiteReach> = emptyMap(),
    val deploy: DeployState? = null,
    val message: String? = null,
    val creating: Boolean = false,
    val unauthorized: Boolean = false,
    /** Other apps on the tunnel; null until loaded or when the agent is too old to report them. */
    val tunnel: List<TunnelRoute>? = null,
)

class SitesViewModel(
    private val client: SitesClient,
    private val store: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow(SitesState())
    val state: StateFlow<SitesState> = _state.asStateFlow()

    private var loadJob: Job? = null
    private var checkJob: Job? = null
    private var deployJob: Job? = null
    private var tunnelJob: Job? = null

    /** Reloads the list (old rows stay visible), then checks every enabled site. */
    fun refresh() {
        val token = store.token ?: return fail401()
        loadJob?.cancel()
        _state.update { it.copy(loading = true, error = null) }
        loadJob = viewModelScope.launch {
            when (val r = client.list(store.baseUrl, token)) {
                is SitesResult.Ok -> {
                    _state.update {
                        it.copy(
                            sites = r.value.sites, domain = r.value.domain, loading = false, loaded = true,
                            error = null, reach = it.reach.filterKeys { k -> r.value.sites.any { s -> s.name == k } },
                        )
                    }
                    runChecks(r.value.sites)
                    loadTunnel()
                }
                SitesResult.Unauthorized -> fail401()
                else -> _state.update { it.copy(loading = false, error = sitesErrorText(r, "Could not load sites")) }
            }
        }
    }

    /** "Check again": re-runs reachability for the sites already listed. */
    fun recheck() {
        runChecks(_state.value.sites)
        loadTunnel()
    }

    /** Best effort: any failure (including an older agent without the route) leaves the section as it was. */
    private fun loadTunnel() {
        val token = store.token ?: return
        tunnelJob?.cancel()
        val base = store.baseUrl
        tunnelJob = viewModelScope.launch {
            when (val r = client.tunnel(base, token)) {
                is SitesResult.Ok -> _state.update { it.copy(tunnel = externalRoutes(r.value)) }
                SitesResult.Unauthorized -> fail401()
                else -> Unit
            }
        }
    }

    private fun runChecks(sites: List<SiteInfo>) {
        val token = store.token ?: return
        val enabled = sites.filter { it.enabled }
        checkJob?.cancel()
        _state.update { s ->
            s.copy(reach = s.reach + enabled.associate { it.name to SiteReach.Checking })
        }
        val base = store.baseUrl
        checkJob = viewModelScope.launch {
            val gate = Semaphore(5)
            coroutineScope {
                enabled.map { site ->
                    async {
                        gate.withPermit {
                            val reach = when (val r = client.check(base, token, site.name)) {
                                is SitesResult.Ok -> reachFromCheck(r.value)
                                SitesResult.Unauthorized -> { fail401(); return@withPermit }
                                else -> SiteReach.NotReady("unknown")
                            }
                            _state.update { it.copy(reach = it.reach + (site.name to reach)) }
                        }
                    }
                }.awaitAll()
            }
        }
    }

    /** Creates a site; [done] gets null on success or the friendly error text. */
    fun create(name: String, spa: Boolean, done: (String?) -> Unit) {
        val token = store.token ?: return fail401()
        if (_state.value.creating) return
        _state.update { it.copy(creating = true) }
        viewModelScope.launch {
            val r = client.create(store.baseUrl, token, name, spa)
            _state.update { it.copy(creating = false) }
            when (r) {
                is SitesResult.Ok -> {
                    _state.update { it.copy(message = "Created ${r.value.hostname.ifBlank { name }}") }
                    done(null)
                    refresh()
                }
                SitesResult.Unauthorized -> fail401()
                else -> done(sitesErrorText(r, "Could not create the site"))
            }
        }
    }

    fun setEnabled(site: SiteInfo, enabled: Boolean) = action(
        if (enabled) "${site.name} enabled" else "${site.name} disabled",
    ) { token -> client.update(store.baseUrl, token, site.name, enabled = enabled) }

    fun setSpa(site: SiteInfo, spa: Boolean) = action(
        if (spa) "Single-page mode on for ${site.name}" else "Single-page mode off for ${site.name}",
    ) { token -> client.update(store.baseUrl, token, site.name, spa = spa) }

    fun delete(site: SiteInfo) = action("Moved ${site.name} to trash") { token ->
        client.delete(store.baseUrl, token, site.name)
    }

    private fun action(success: String, call: suspend (String) -> SitesResult<*>) {
        val token = store.token ?: return fail401()
        viewModelScope.launch {
            val r = call(token)
            when (r) {
                is SitesResult.Ok -> _state.update { it.copy(message = success) }
                SitesResult.Unauthorized -> { fail401(); return@launch }
                else -> _state.update { it.copy(message = sitesErrorText(r)) }
            }
            refresh()
        }
    }

    fun deploy(site: SiteInfo, item: UploadItem) {
        if (_state.value.deploy != null) return
        val token = store.token ?: return fail401()
        _state.update { it.copy(deploy = DeployState(site.name, 0, item.size)) }
        deployJob = viewModelScope.launch {
            try {
                val r = client.deploy(store.baseUrl, token, site.name, item.open, item.size) { sent ->
                    _state.update { s -> s.deploy?.let { d -> s.copy(deploy = d.copy(done = sent)) } ?: s }
                }
                when (r) {
                    is SitesResult.Ok -> _state.update {
                        it.copy(message = "Deployed ${r.value.files} files (${formatBytes(r.value.bytes)}) to ${site.name}")
                    }
                    SitesResult.Unauthorized -> { fail401(); return@launch }
                    else -> _state.update { it.copy(message = sitesErrorText(r, "Deploy failed")) }
                }
            } finally {
                _state.update { it.copy(deploy = null) }
            }
            refresh()
        }
    }

    fun cancelDeploy() {
        deployJob?.cancel()
        _state.update { it.copy(deploy = null, message = "Deploy cancelled") }
        refresh()
    }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun reset() {
        loadJob?.cancel()
        checkJob?.cancel()
        deployJob?.cancel()
        tunnelJob?.cancel()
        _state.value = SitesState()
    }

    private fun fail401() {
        store.clearToken()
        _state.update { it.copy(unauthorized = true, loading = false) }
    }

    override fun onCleared() {
        loadJob?.cancel()
        checkJob?.cancel()
        deployJob?.cancel()
        tunnelJob?.cancel()
    }
}
