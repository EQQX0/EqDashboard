package com.eqqx2.s21control.ui

import android.content.ActivityNotFoundException
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.s21control.BuildConfig
import com.eqqx2.s21control.data.ApkInstaller
import com.eqqx2.s21control.data.UpdateInfo

private val SheetBg = Color(0xFF2B1014)
private val SheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)

/** Slim glass banner at the top of Overview; tapping opens the About and updates sheet. */
@Composable
fun UpdateBanner(info: UpdateInfo, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .background(S21Colors.NavScrim)
            .background(S21Colors.NavFill)
            .border(1.dp, S21Colors.NavBorder, S21Shapes.Pill)
            .clickable(onClickLabel = "Open updates", role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlassIcon(S21Icons.Downloads, null, S21Colors.Amber, 20.dp)
        Spacer(Modifier.size(10.dp))
        Text(
            "Update ${info.versionName} available",
            color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        GlassIcon(S21Icons.ArrowUpRight, null, Color.White, 20.dp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateSheet(vm: UpdateViewModel, onDismiss: () -> Unit) {
    val state by vm.state.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SheetBg,
        contentColor = Color.White,
        scrimColor = Color(0x99000000),
        shape = SheetShape,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LogoTile(40.dp)
                Spacer(Modifier.size(12.dp))
                Column {
                    Text("S21 Control", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                        color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                    )
                }
            }
            Text("Updates from github.com/${vm.repo}", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
            StateArea(vm, state)
        }
    }
}

@Composable
private fun StateArea(vm: UpdateViewModel, state: UpdateUiState) {
    val context = LocalContext.current
    val reduce = rememberReducedMotion()
    val phase = state.phase
    Column(
        Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (phase) {
            UpdatePhase.Idle -> {
                state.available?.let { AvailableBlock(vm, it) }
                    ?: Text("Check whether a newer version is available.", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
                if (state.available == null) SheetButton("Check for updates", primary = true) { vm.checkNow() }
            }
            UpdatePhase.Checking -> Row(verticalAlignment = Alignment.CenterVertically) {
                if (!reduce) {
                    CircularProgressIndicator(
                        Modifier.size(24.dp), color = Color.White, strokeWidth = 3.dp, trackColor = S21Colors.BarFill,
                    )
                    Spacer(Modifier.size(12.dp))
                }
                Text("Checking for updates", color = Color.White, fontSize = 16.sp)
            }
            UpdatePhase.UpToDate -> {
                Text("You're up to date", color = S21Colors.Emerald, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                SheetButton("Check for updates", primary = false) { vm.checkNow() }
            }
            UpdatePhase.NoRelease -> {
                Text("No release has been published yet", color = Color.White, fontSize = 16.sp)
                SheetButton("Check for updates", primary = false) { vm.checkNow() }
            }
            is UpdatePhase.Available -> AvailableBlock(vm, phase.info)
            is UpdatePhase.Downloading -> {
                val total = phase.info.size.coerceAtLeast(1L)
                val frac = (phase.read.toFloat() / total).coerceIn(0f, 1f)
                val pct = (frac * 100).toInt()
                Text("Downloading ${phase.info.versionName}", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                LinearProgressIndicator(
                    progress = { frac },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(S21Shapes.Pill)
                        .semantics { contentDescription = "Download progress $pct percent" },
                    color = Color.White,
                    trackColor = S21Colors.BarFill,
                )
                Text(
                    "$pct%  ${formatBytes(phase.read)} of ${formatBytes(phase.info.size)}",
                    color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                )
                SheetButton("Cancel", primary = false) { vm.cancelDownload() }
            }
            is UpdatePhase.PermissionNeeded -> {
                Text("Allow installs from this app", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "Android needs your permission before S21 Control can open an update. " +
                        "Turn on \"Allow from this source\" in settings, come back, and try again. " +
                        "You will still confirm the install in Android's own dialog.",
                    color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                )
                SheetButton("Open settings", primary = true) {
                    try {
                        context.startActivity(ApkInstaller.permissionSettingsIntent(context))
                    } catch (e: ActivityNotFoundException) {
                        // no settings screen available; the message above still explains what to do
                    }
                }
                SheetButton("Try again", primary = false) { vm.downloadAndInstall(phase.info) }
            }
            is UpdatePhase.ChecksumFailed -> {
                StatusChip(
                    "Download didn't match its checksum, not installed",
                    S21Colors.ChipErrorText, S21Colors.ChipErrorFill,
                )
                SheetButton("Download again", primary = true) { vm.downloadAndInstall(phase.info) }
            }
            is UpdatePhase.ReadyToInstall -> {
                Text("Update ${phase.info.versionName} downloaded and verified", color = S21Colors.Emerald, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text("Tap Install in Android's dialog to finish.", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
                SheetButton("Open installer", primary = true) { vm.reopenInstaller() }
            }
            is UpdatePhase.Error -> {
                StatusChip(phase.message, S21Colors.ChipErrorText, S21Colors.ChipErrorFill)
                val retry = phase.retry
                if (retry != null) SheetButton("Try again", primary = true) { vm.downloadAndInstall(retry) }
                else SheetButton("Check for updates", primary = true) { vm.checkNow() }
            }
        }
    }
}

@Composable
private fun AvailableBlock(vm: UpdateViewModel, info: UpdateInfo) {
    Text("Version ${info.versionName} available", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    Text(formatBytes(info.size), color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
    if (info.notes.isNotBlank()) {
        // 8 lines at 20sp line height; longer notes scroll inside the box.
        Box(
            Modifier.fillMaxWidth().heightIn(max = 160.dp)
                .clip(S21Shapes.Tile).background(S21Colors.BarFill).padding(12.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(info.notes, color = Color.White, fontSize = 14.sp, lineHeight = 20.sp)
        }
    }
    SheetButton("Download and install", primary = true) { vm.downloadAndInstall(info) }
}

@Composable
private fun SheetButton(text: String, primary: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .background(if (primary) Color.White else S21Colors.PillSecondary)
            .then(if (primary) Modifier else Modifier.border(1.dp, S21Colors.GlassBorder, S21Shapes.Pill))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (primary) S21Colors.Ink else Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Launches Android's installer once per [UpdateUiState.pendingInstall]. */
@Composable
fun InstallLauncher(vm: UpdateViewModel) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val file = state.pendingInstall
    LaunchedEffect(file) {
        if (file != null) {
            try {
                context.startActivity(ApkInstaller.installIntent(context, file))
            } catch (e: ActivityNotFoundException) {
                // no installer available
            } catch (e: IllegalArgumentException) {
                // FileProvider could not map the file
            }
            vm.installLaunched()
        }
    }
}
