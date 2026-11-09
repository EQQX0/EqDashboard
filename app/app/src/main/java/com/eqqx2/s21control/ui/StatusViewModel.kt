package com.eqqx2.s21control.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.s21control.data.AgentClient
import com.eqqx2.s21control.data.FetchResult
import com.eqqx2.s21control.data.Status
import com.eqqx2.s21control.data.TokenStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class OverviewState(
    val status: Status? = null,
    val previous: Status? = null,
    val error: String? = null,
    val stale: Boolean = false,
    val lastOkMs: Long? = null,
    val unauthorized: Boolean = false,
)

class StatusViewModel(
    private val client: AgentClient,
    private val store: TokenStore,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _state = MutableStateFlow(OverviewState())
    val state: StateFlow<OverviewState> = _state.asStateFlow()
    private var job: Job? = null

    /** True once the Overview entrance/count-up has played, so it does not replay on tab switches or polls. */
    var introPlayed: Boolean = false

    /** Idempotent: calling it again while polling (e.g. after rotation) does not restart the loop. */
    fun startPolling() {
        if (job?.isActive == true) return
        job = viewModelScope.launch {
            while (isActive) {
                val token = store.token
                if (token == null) {
                    _state.update { it.copy(unauthorized = true) }
                    return@launch
                }
                var wait = 5_000L
                when (val r = client.fetchStatus(store.baseUrl, token)) {
                    is FetchResult.Ok -> _state.update {
                        it.copy(
                            status = r.status, previous = it.status, error = null,
                            stale = false, lastOkMs = clock(), unauthorized = false,
                        )
                    }
                    FetchResult.Unauthorized -> {
                        store.clearToken()
                        _state.update { it.copy(error = "Token rejected", unauthorized = true) }
                        return@launch
                    }
                    FetchResult.RateLimited -> {
                        wait = 30_000L
                        _state.update { it.copy(error = "Too many requests, retrying", stale = it.status != null) }
                    }
                    is FetchResult.Failure -> _state.update {
                        it.copy(error = r.message, stale = it.status != null)
                    }
                }
                delay(wait)
            }
        }
    }

    fun stopPolling() {
        job?.cancel()
        job = null
    }

    fun reset() {
        stopPolling()
        _state.value = OverviewState()
    }

    override fun onCleared() {
        stopPolling()
    }
}
