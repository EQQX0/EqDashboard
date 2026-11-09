package com.eqqx2.s21control.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.s21control.data.AgentUpdateClient
import com.eqqx2.s21control.data.AgentUpdateResult
import com.eqqx2.s21control.data.TokenStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface AgentUpdatePhase {
    data object Hidden : AgentUpdatePhase
    data class Available(val current: String, val latest: String) : AgentUpdatePhase
    data class Updating(val to: String) : AgentUpdatePhase
    data class Done(val version: String) : AgentUpdatePhase
    data class Error(val message: String, val retry: AgentUpdatePhase.Available?) : AgentUpdatePhase
}

fun agentUpdateErrorText(r: AgentUpdateResult<*>): String = when (r) {
    is AgentUpdateResult.Ok -> "Update failed"
    AgentUpdateResult.Unauthorized -> "Token rejected"
    AgentUpdateResult.RateLimited -> "GitHub is limiting checks right now. Try again later."
    AgentUpdateResult.Busy -> "An update is already running"
    AgentUpdateResult.Unsupported -> "This agent is too old to update itself. Install the new agent once from Termux."
    is AgentUpdateResult.Refused -> when (r.code) {
        "bad_checksum", "bad_archive" -> "The downloaded agent failed its safety check, so nothing was changed"
        "rate_limited" -> "GitHub is limiting checks right now. Try again later."
        "untrusted_host", "bad_url" -> "The release points somewhere untrusted, so nothing was changed"
        else -> "The Samsung server could not reach GitHub. Try again in a moment."
    }
    is AgentUpdateResult.Failure -> r.message
}

class AgentUpdateViewModel(
    private val client: AgentUpdateClient,
    private val store: TokenStore,
    private val pollDelayMs: Long = 3_000,
    private val maxWaitMs: Long = 120_000,
) : ViewModel() {
    private val _phase = MutableStateFlow<AgentUpdatePhase>(AgentUpdatePhase.Hidden)
    val phase: StateFlow<AgentUpdatePhase> = _phase.asStateFlow()
    private var checked = false

    /** One quiet check per app run. Any failure leaves the card hidden. */
    fun checkOnce() {
        if (checked) return
        val token = store.token ?: return
        checked = true
        viewModelScope.launch {
            val r = client.check(store.baseUrl, token)
            if (r is AgentUpdateResult.Ok && r.value.available && r.value.latest != null) {
                _phase.value = AgentUpdatePhase.Available(r.value.current, r.value.latest)
            }
        }
    }

    fun update() {
        val a = (_phase.value as? AgentUpdatePhase.Available)
            ?: (_phase.value as? AgentUpdatePhase.Error)?.retry ?: return
        val token = store.token ?: return
        _phase.value = AgentUpdatePhase.Updating(a.latest)
        viewModelScope.launch {
            val r = client.apply(store.baseUrl, token)
            when {
                r is AgentUpdateResult.Ok && r.value.updated -> waitForRestart(a.latest, token)
                r is AgentUpdateResult.Ok -> _phase.value = AgentUpdatePhase.Hidden // already current
                else -> _phase.value = AgentUpdatePhase.Error(agentUpdateErrorText(r), a)
            }
        }
    }

    /** The agent restarts a few seconds after answering; poll until it reports the new version. */
    private suspend fun waitForRestart(target: String, token: String) {
        var waited = 0L
        while (waited < maxWaitMs) {
            delay(pollDelayMs)
            waited += pollDelayMs
            val r = client.check(store.baseUrl, token)
            if (r is AgentUpdateResult.Ok && r.value.current == target) {
                _phase.value = AgentUpdatePhase.Done(target)
                return
            }
        }
        _phase.value = AgentUpdatePhase.Error("The update was installed but the agent hasn't come back yet. It restarts within a minute.", null)
    }

    fun dismiss() {
        _phase.update { if (it is AgentUpdatePhase.Updating) it else AgentUpdatePhase.Hidden }
    }

    fun reset() {
        checked = false
        _phase.value = AgentUpdatePhase.Hidden
    }
}
