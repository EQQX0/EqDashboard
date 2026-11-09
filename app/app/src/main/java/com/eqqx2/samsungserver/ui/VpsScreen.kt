package com.eqqx2.samsungserver.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.samsungserver.data.VpsDistro
import com.eqqx2.samsungserver.data.VpsSlice
import kotlinx.coroutines.delay

private val VpsGradient = Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF3B82F6)))
private val CodeBg = Color(0xFF1A1013)
private val FallbackDistros = listOf(VpsDistro("debian", "Debian"), VpsDistro("ubuntu", "Ubuntu"), VpsDistro("alpine", "Alpine Linux"))

private fun vpsStatusColor(status: String): Color = when (status) {
    "running" -> SamsungColors.Emerald
    "error" -> SamsungColors.Amber
    else -> SamsungColors.OnCrimsonMuted
}

private fun distroHint(id: String): String = when (id) {
    "debian" -> "The safe default. Most guides assume it."
    "ubuntu" -> "Familiar packages, a bit larger than Debian."
    "alpine" -> "Smallest download, uses apk instead of apt."
    else -> ""
}

@Composable
fun VpsScreen(
    vm: VpsViewModel,
    topInset: Dp,
    bottomInset: Dp,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val reduce = rememberReducedMotion()
    val animateEntrance = remember { !state.loaded }

    // Poll while this tab is on screen only.
    DisposableEffect(Unit) {
        vm.startPolling()
        onDispose { vm.stopPolling() }
    }
    LaunchedEffect(state.message) {
        if (state.message != null) {
            delay(5_000)
            vm.clearMessage()
        }
    }

    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize()) {
        Column(Modifier.appear(0, animateEntrance).padding(start = 16.dp, end = 16.dp, top = topInset, bottom = 4.dp)) {
            Text("VPS", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
            Text(
                if (state.loaded) "Linux slices on your Samsung server • ${state.items.size} of ${state.maxSlices}" else "Linux slices on your Samsung server",
                color = SamsungColors.OnCrimsonMuted, fontSize = 14.sp,
            )
        }
        state.message?.let { msg ->
            StatusChip(
                msg, Color.White, SamsungColors.ChipDark,
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (state.error != null && state.loaded) {
            StatusChip(
                "Connection problem, showing the last update", SamsungColors.Amber, SamsungColors.ChipDark,
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = bottomInset + 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.loading && !state.loaded) {
                item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                        if (reduce) {
                            Text("Loading slices", color = Color.White, fontSize = 16.sp)
                        } else {
                            CircularProgressIndicator(
                                color = Color.White, trackColor = SamsungColors.BarFill,
                                modifier = Modifier.semantics { contentDescription = "Loading slices" },
                            )
                        }
                    }
                }
            }
            if (state.error != null && !state.loaded) {
                item(key = "error") {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Could not load slices", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                            Text(state.error.orEmpty(), color = SamsungColors.OnGlassCritical, fontSize = 16.sp)
                            PrimaryPillButton("Retry", onClick = vm::refresh)
                        }
                    }
                }
            }
            if (state.loaded && !state.engine) {
                item(key = "setup") { SetupCard() }
            }
            if (state.loaded) {
                item(key = "create") {
                    CreateCard(
                        distros = state.distros.ifEmpty { FallbackDistros },
                        busy = state.creating,
                        blocked = !state.engine || state.items.size >= state.maxSlices,
                        blockedReason = when {
                            !state.engine -> "Install proot-distro first"
                            else -> "You have ${state.items.size} of ${state.maxSlices} slices. Delete one to add another."
                        },
                        onCreate = vm::create,
                        modifier = Modifier.appear(1, animateEntrance),
                    )
                }
            }
            if (state.loaded && state.items.isEmpty()) {
                item(key = "empty") {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("No slices yet", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                "A slice is a small Linux you log into over SSH. Pick a name and a Linux above to make one.",
                                color = SamsungColors.OnGlassMuted, fontSize = 16.sp,
                            )
                        }
                    }
                }
            }
            items(state.items, key = { it.id }) { slice ->
                SliceRow(
                    slice = slice,
                    host = state.host,
                    reduce = reduce,
                    onStart = { vm.start(slice) },
                    onStop = { vm.stop(slice) },
                    onPassword = { vm.resetPassword(slice) },
                    onDelete = { deleteId = slice.id },
                )
            }
        }
    }

    deleteId?.let { id ->
        val slice = state.items.firstOrNull { it.id == id }
        if (slice == null) {
            deleteId = null
        } else {
            AlertDialog(
                onDismissRequest = { deleteId = null },
                containerColor = Color(0xFFF6D5D8),
                titleContentColor = SamsungColors.OnGlass,
                textContentColor = SamsungColors.OnGlassMuted,
                title = { Text("Delete ${slice.name}?") },
                text = { Text("The slice stops and everything inside it is deleted. This can't be undone.", fontSize = 16.sp) },
                confirmButton = {
                    TextButton(onClick = { deleteId = null; vm.delete(slice) }) {
                        Text("Delete", color = SamsungColors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { deleteId = null }) { Text("Cancel", color = SamsungColors.OnGlass, fontSize = 16.sp) }
                },
            )
        }
    }

    state.shown?.let { shown ->
        PasswordDialog(shown, onDismiss = vm::dismissPassword)
    }
}

@Composable
internal fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = SamsungColors.OnGlass,
    unfocusedTextColor = SamsungColors.OnGlass,
    errorTextColor = SamsungColors.OnGlass,
    focusedBorderColor = SamsungColors.Ink,
    unfocusedBorderColor = SamsungColors.OnGlassMuted,
    errorBorderColor = SamsungColors.OnGlassCritical,
    focusedLabelColor = SamsungColors.Ink,
    unfocusedLabelColor = SamsungColors.OnGlassMuted,
    errorLabelColor = SamsungColors.OnGlassCritical,
    cursorColor = SamsungColors.Ink,
    errorCursorColor = SamsungColors.OnGlassCritical,
    errorSupportingTextColor = SamsungColors.OnGlassCritical,
    focusedSupportingTextColor = SamsungColors.OnGlassMuted,
    unfocusedSupportingTextColor = SamsungColors.OnGlassMuted,
)

@Composable
private fun CreateCard(
    distros: List<VpsDistro>,
    busy: Boolean,
    blocked: Boolean,
    blockedReason: String,
    onCreate: (String, String, String, (String?) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var distroIndex by rememberSaveable { mutableStateOf(0) }
    var key by rememberSaveable { mutableStateOf("") }
    var serverError by remember { mutableStateOf<String?>(null) }
    val distro = distros[distroIndex.coerceIn(0, distros.lastIndex)]
    val nameError = vpsNameError(name)
    val keyError = vpsKeyError(key)
    val ready = name.isNotEmpty() && nameError == null && keyError == null && !busy && !blocked

    GlassCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("New slice", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.trim(); serverError = null },
                label = { Text("Name", fontSize = 14.sp) },
                singleLine = true,
                isError = nameError != null,
                supportingText = { Text(nameError ?: "Lowercase letters, digits and dashes", fontSize = 14.sp) },
                textStyle = TextStyle(fontSize = 16.sp),
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                colors = fieldColors(),
            )
            Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                distros.forEachIndexed { i, d ->
                    val selected = i == distroIndex
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .clip(SamsungShapes.Pill)
                            .background(if (selected) SamsungColors.Ink else Color(0x14000000))
                            .border(1.dp, if (selected) SamsungColors.Ink else SamsungColors.OnGlassMuted, SamsungShapes.Pill)
                            .selectable(selected = selected, role = Role.RadioButton) { distroIndex = i }
                            .padding(horizontal = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            d.label.ifBlank { d.id }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, color = if (selected) Color.White else SamsungColors.OnGlass,
                        )
                    }
                }
            }
            Text(distroHint(distro.id), color = SamsungColors.OnGlassMuted, fontSize = 14.sp)
            OutlinedTextField(
                value = key,
                onValueChange = { key = it; serverError = null },
                label = { Text("SSH public key (optional)", fontSize = 14.sp) },
                minLines = 2,
                maxLines = 4,
                isError = keyError != null,
                supportingText = {
                    Text(keyError ?: "Leave empty to get a password. With a key, only the key can log in.", fontSize = 14.sp)
                },
                textStyle = TextStyle(fontSize = 14.sp, fontFamily = FontFamily.Monospace),
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                colors = fieldColors(),
            )
            serverError?.let {
                Text(it, color = SamsungColors.OnGlassCritical, fontSize = 14.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            if (blocked) Text(blockedReason, color = SamsungColors.OnGlassMuted, fontSize = 14.sp)
            PrimaryPillButton(if (busy) "Creating" else "Create slice", enabled = ready, modifier = Modifier.fillMaxWidth()) {
                serverError = null
                onCreate(name, distro.id, key) { err -> if (err == null) { name = ""; key = "" } else serverError = err }
            }
        }
    }
}

@Composable
private fun SetupCard() {
    GlassCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Finish setup on your phone", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "proot-distro isn't ready on the Samsung server yet. Run this in Termux. This screen updates by itself within a minute.",
                color = SamsungColors.OnGlassMuted, fontSize = 16.sp,
            )
            CommandBlock(SETUP_VPS_COMMAND, "Copy setup command")
        }
    }
}

/** A dark monospace block with a Copy button. */
@Composable
internal fun CommandBlock(command: String, copyLabel: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }
    Column(
        Modifier.fillMaxWidth().clip(SamsungShapes.Tile).background(CodeBg).border(1.dp, SamsungColors.NavBorder, SamsungShapes.Tile).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(command, color = Color.White, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
        Box(
            Modifier
                .heightIn(min = 48.dp)
                .clip(SamsungShapes.Pill)
                .background(SamsungColors.PillSecondary)
                .clickable(role = Role.Button, onClickLabel = copyLabel) {
                    clipboard.setText(AnnotatedString(command))
                    copied = true
                }
                .padding(horizontal = 20.dp)
                .semantics { if (copied) liveRegion = LiveRegionMode.Polite },
            contentAlignment = Alignment.Center,
        ) {
            Text(if (copied) "Copied" else "Copy", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun SliceRow(
    slice: VpsSlice,
    host: String?,
    reduce: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onPassword: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(SamsungShapes.Stat)
            .background(SamsungColors.GlassFill)
            .border(1.dp, SamsungColors.GlassBorder, SamsungShapes.Stat)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp).clip(SamsungShapes.Tile).background(VpsGradient), contentAlignment = Alignment.Center) {
                GlassIcon(SamsungIcons.Vps, null, Color.White, 24.dp)
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    slice.name, color = SamsungColors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${slice.distroLabel.ifBlank { slice.distro }} • port ${slice.port}",
                    color = SamsungColors.OnGlassMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (isWorking(slice) && !reduce) {
            androidx.compose.material3.LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().heightIn(min = 8.dp, max = 8.dp).clip(SamsungShapes.Pill),
                color = SamsungColors.Ink, trackColor = Color(0x33000000),
            )
        }
        Text(
            vpsDetail(slice),
            color = if (slice.status == "error") SamsungColors.OnGlassCritical else SamsungColors.OnGlassMuted,
            fontSize = 14.sp, maxLines = 4, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { if (isWorking(slice)) liveRegion = LiveRegionMode.Polite },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Crossfade(targetState = slice.status, animationSpec = if (reduce) snap() else tween(200), label = "vpsChip") { s ->
                StatusPill(vpsChipText(s), vpsStatusColor(s))
            }
            Spacer(Modifier.weight(1f))
            if (!isWorking(slice)) {
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clip(SamsungShapes.Pill)
                        .clickable(role = Role.Button, onClickLabel = "Delete ${slice.name}", onClick = onDelete)
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Delete", color = SamsungColors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (slice.status == "running") CommandBlock(sshCommand(slice, host), "Copy SSH command for ${slice.name}")
        val full = Modifier.fillMaxWidth()
        when {
            canStopSlice(slice) -> OutlinePill("Stop", full, onStop)
            canStartSlice(slice) -> OutlinePill("Start", full, onStart)
        }
        if (slice.authMode == "password" && (slice.status == "running" || slice.status == "stopped")) {
            OutlinePill("New password", full, onPassword)
        }
    }
}

@Composable
private fun PasswordDialog(shown: ShownPassword, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFFF6D5D8),
        titleContentColor = SamsungColors.OnGlass,
        textContentColor = SamsungColors.OnGlassMuted,
        title = { Text(if (shown.isNew) "${shown.sliceName} is on its way" else "New password for ${shown.sliceName}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("This is the root password. It shows once, so copy it now.", fontSize = 16.sp)
                Box(
                    Modifier.fillMaxWidth().clip(SamsungShapes.Tile).background(CodeBg).padding(12.dp),
                ) {
                    Text(shown.password, color = Color.White, fontSize = 16.sp, fontFamily = FontFamily.Monospace)
                }
                OutlinePill(if (copied) "Copied" else "Copy password", Modifier.fillMaxWidth().semantics {
                    if (copied) liveRegion = LiveRegionMode.Polite
                }) {
                    clipboard.setText(AnnotatedString(shown.password))
                    copied = true
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Done", color = SamsungColors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
        },
    )
}
