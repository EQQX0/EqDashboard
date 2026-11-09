package com.eqqx2.s21control.ui

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eqqx2.s21control.data.ApkInstaller
import com.eqqx2.s21control.data.DownloadResult
import com.eqqx2.s21control.data.UpdateCheck
import com.eqqx2.s21control.data.UpdateClient
import com.eqqx2.s21control.data.UpdateInfo
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

sealed interface UpdatePhase {
    data object Idle : UpdatePhase
    data object Checking : UpdatePhase
    data object UpToDate : UpdatePhase
    data object NoRelease : UpdatePhase
    data class Available(val info: UpdateInfo) : UpdatePhase
    data class Downloading(val info: UpdateInfo, val read: Long) : UpdatePhase
    data class PermissionNeeded(val info: UpdateInfo) : UpdatePhase
    data class ChecksumFailed(val info: UpdateInfo) : UpdatePhase
    data class ReadyToInstall(val info: UpdateInfo, val file: File) : UpdatePhase
    /** [retry] is the info to retry downloading, null when the failure came from a check. */
    data class Error(val message: String, val retry: UpdateInfo? = null) : UpdatePhase
}

data class UpdateUiState(
    val phase: UpdatePhase = UpdatePhase.Idle,
    /** Newer version found by any check; drives the Overview banner. */
    val available: UpdateInfo? = null,
    /** Set when the installer intent should be launched once; the UI calls [UpdateViewModel.installLaunched]. */
    val pendingInstall: File? = null,
)

class UpdateViewModel(
    private val appContext: Context,
    private val client: UpdateClient,
    val repo: String,
    val versionName: String,
    val versionCode: Int,
    private val prefs: SharedPreferences,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _state = MutableStateFlow(UpdateUiState())
    val state: StateFlow<UpdateUiState> = _state.asStateFlow()
    private var job: Job? = null
    private var autoChecked = false

    /** Silent check, at most once per [CHECK_INTERVAL_MS]. Failures are ignored and never surfaced. */
    fun backgroundCheck() {
        if (autoChecked) return
        autoChecked = true
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        if (clock() - last in 0 until CHECK_INTERVAL_MS) return
        viewModelScope.launch {
            val r = client.check(repo, versionCode)
            if (r !is UpdateCheck.Failure) prefs.edit().putLong(KEY_LAST_CHECK, clock()).apply()
            if (r is UpdateCheck.Available) _state.update { it.copy(available = r.info) }
        }
    }

    fun checkNow() {
        if (_state.value.phase is UpdatePhase.Checking || _state.value.phase is UpdatePhase.Downloading) return
        _state.update { it.copy(phase = UpdatePhase.Checking) }
        job = viewModelScope.launch {
            val phase = when (val r = client.check(repo, versionCode)) {
                is UpdateCheck.Available -> {
                    _state.update { it.copy(available = r.info) }
                    UpdatePhase.Available(r.info)
                }
                UpdateCheck.UpToDate -> UpdatePhase.UpToDate
                UpdateCheck.NoRelease -> UpdatePhase.NoRelease
                UpdateCheck.RateLimited -> UpdatePhase.Error("GitHub is limiting update checks right now. Try again later.")
                is UpdateCheck.Failure -> UpdatePhase.Error(r.message)
            }
            if (r0(phase)) prefs.edit().putLong(KEY_LAST_CHECK, clock()).apply()
            _state.update { it.copy(phase = phase) }
        }
    }

    private fun r0(phase: UpdatePhase) = phase !is UpdatePhase.Error

    /** Started only by an explicit tap on "Download and install". */
    fun downloadAndInstall(info: UpdateInfo) {
        if (_state.value.phase is UpdatePhase.Downloading) return
        if (!ApkInstaller.canInstall(appContext)) {
            _state.update { it.copy(phase = UpdatePhase.PermissionNeeded(info)) }
            return
        }
        _state.update { it.copy(phase = UpdatePhase.Downloading(info, 0L)) }
        job = viewModelScope.launch {
            val dest = ApkInstaller.apkFile(appContext, info.versionCode)
            val d = client.download(info.apkUrl, dest, info.sha256, info.size) { read ->
                _state.update { s ->
                    if (s.phase is UpdatePhase.Downloading) s.copy(phase = UpdatePhase.Downloading(info, read)) else s
                }
            }
            val phase: UpdatePhase = when (d) {
                is DownloadResult.Ok -> UpdatePhase.ReadyToInstall(info, d.file)
                DownloadResult.HashMismatch, DownloadResult.SizeMismatch -> UpdatePhase.ChecksumFailed(info)
                is DownloadResult.Failure -> UpdatePhase.Error(d.message, info)
            }
            _state.update {
                it.copy(
                    phase = phase,
                    pendingInstall = (phase as? UpdatePhase.ReadyToInstall)?.file,
                )
            }
        }
    }

    fun cancelDownload() {
        val p = _state.value.phase as? UpdatePhase.Downloading ?: return
        job?.cancel()
        job = null
        _state.update { it.copy(phase = UpdatePhase.Available(p.info)) }
    }

    /** Lets the user re-open the installer for an already verified file. */
    fun reopenInstaller() {
        val p = _state.value.phase as? UpdatePhase.ReadyToInstall ?: return
        _state.update { it.copy(pendingInstall = p.file) }
    }

    fun installLaunched() {
        _state.update { it.copy(pendingInstall = null) }
    }

    /** Back to the version prompt, e.g. after returning from the install-permission settings. */
    fun backToAvailable(info: UpdateInfo) {
        _state.update { it.copy(phase = UpdatePhase.Available(info)) }
    }

    fun reset() {
        job?.cancel()
        job = null
        _state.value = UpdateUiState()
        autoChecked = false
    }

    override fun onCleared() {
        job?.cancel()
    }

    companion object {
        const val PREFS_NAME = "s21_update_prefs"
        const val KEY_LAST_CHECK = "last_check_ms"
        const val CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000
    }
}
