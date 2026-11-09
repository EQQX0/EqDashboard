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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.samsungserver.data.DownloadItem
import com.eqqx2.samsungserver.data.DownloadMode
import kotlinx.coroutines.delay

private val DownloadGradient = Brush.linearGradient(listOf(Color(0xFF10B981), Color(0xFF0EA5E9)))
private val CodeBg = Color(0xFF1A1013)

private fun modeHint(mode: DownloadMode): String = when (mode) {
    DownloadMode.Auto -> "Picks the right tool for the link"
    DownloadMode.Video -> "Video pages, saved as mp4 up to 1080p"
    DownloadMode.Audio -> "Video pages, saved as an mp3"
    DownloadMode.File -> "A plain file or torrent link"
}

private fun statusColor(status: String): Color = when (status) {
    "active", "complete" -> SamsungColors.Emerald
    "error" -> SamsungColors.Amber
    else -> SamsungColors.OnCrimsonMuted
}

@Composable
fun DownloadsScreen(
    vm: DownloadsViewModel,
    topInset: Dp,
    bottomInset: Dp,
    onOpenFiles: (String) -> Unit,
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

    var removeId by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize()) {
        Column(Modifier.appear(0, animateEntrance).padding(start = 16.dp, end = 16.dp, top = topInset, bottom = 4.dp)) {
            Text("Downloads", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
            Text(
                state.freeBytes?.let { "Save links to your Samsung server • ${formatBytes(it)} free" } ?: "Save links to your Samsung server",
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
            item(key = "add") {
                AddCard(adding = state.adding, onAdd = vm::add, modifier = Modifier.appear(1, animateEntrance))
            }
            if (state.loading && !state.loaded) {
                item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                        if (reduce) {
                            Text("Loading downloads", color = Color.White, fontSize = 16.sp)
                        } else {
                            CircularProgressIndicator(
                                color = Color.White, trackColor = SamsungColors.BarFill,
                                modifier = Modifier.semantics { contentDescription = "Loading downloads" },
                            )
                        }
                    }
                }
            }
            if (state.error != null && !state.loaded) {
                item(key = "error") {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Could not load downloads", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                            Text(state.error.orEmpty(), color = SamsungColors.OnGlassCritical, fontSize = 16.sp)
                            PrimaryPillButton("Retry", onClick = vm::refresh)
                        }
                    }
                }
            }
            if (state.loaded && (!state.engines.aria2 || !state.engines.ytdlp)) {
                item(key = "setup") {
                    SetupCard(aria2Missing = !state.engines.aria2, ytdlpMissing = !state.engines.ytdlp)
                }
            }
            if (state.loaded && state.items.isEmpty()) {
                item(key = "empty") {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("No downloads yet", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                "Paste a link above. Finished files appear in the Files tab under downloads.",
                                color = SamsungColors.OnGlassMuted, fontSize = 16.sp,
                            )
                        }
                    }
                }
            }
            items(state.items, key = { it.id }) { item ->
                DownloadRow(
                    item = item,
                    reduce = reduce,
                    onPause = { vm.pause(item) },
                    onResume = { vm.resume(item) },
                    onRetry = { vm.retry(item) },
                    onOpenFiles = { onOpenFiles(item.path?.substringBeforeLast('/', "downloads") ?: "downloads") },
                    onRemove = { removeId = item.id },
                )
            }
        }
    }

    removeId?.let { id ->
        val item = state.items.firstOrNull { it.id == id }
        if (item == null) {
            removeId = null
        } else {
            AlertDialog(
                onDismissRequest = { removeId = null },
                containerColor = Color(0xFFF6D5D8),
                titleContentColor = SamsungColors.OnGlass,
                textContentColor = SamsungColors.OnGlassMuted,
                title = { Text("Remove ${item.name.ifBlank { "download" }}?") },
                text = {
                    Text(
                        if (item.status == "complete") "It leaves this list. The file stays in your Files."
                        else "The download stops and its partial files are deleted.",
                        fontSize = 16.sp,
                    )
                },
                confirmButton = {
                    TextButton(onClick = { removeId = null; vm.remove(item) }) {
                        Text("Remove", color = SamsungColors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { removeId = null }) { Text("Cancel", color = SamsungColors.OnGlass, fontSize = 16.sp) }
                },
            )
        }
    }
}

@Composable
private fun AddCard(adding: Boolean, onAdd: (String, DownloadMode, (String?) -> Unit) -> Unit, modifier: Modifier = Modifier) {
    var link by rememberSaveable { mutableStateOf("") }
    var modeIndex by rememberSaveable { mutableStateOf(0) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var touched by rememberSaveable { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val mode = DownloadMode.entries[modeIndex]
    val valid = looksLikeLink(link)
    val error = serverError ?: if (touched && link.isNotBlank() && !valid) "Enter an http, https, ftp or magnet link" else null
    val submit = {
        touched = true
        if (valid && !adding) {
            serverError = null
            onAdd(link.trim(), mode) { err -> if (err == null) { link = ""; touched = false } else serverError = err }
        }
    }

    GlassCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = link,
                onValueChange = { link = it; touched = true; serverError = null },
                label = { Text("Link or magnet", fontSize = 14.sp) },
                singleLine = true,
                isError = error != null,
                supportingText = { if (error != null) Text(error, fontSize = 14.sp) },
                textStyle = TextStyle(fontSize = 16.sp),
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                colors = OutlinedTextFieldDefaults.colors(
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
                ),
            )
            Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DownloadMode.entries.forEachIndexed { i, m ->
                    val selected = i == modeIndex
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .clip(SamsungShapes.Pill)
                            .background(if (selected) SamsungColors.Ink else Color(0x14000000))
                            .border(1.dp, if (selected) SamsungColors.Ink else SamsungColors.OnGlassMuted, SamsungShapes.Pill)
                            .selectable(selected = selected, role = Role.RadioButton) { modeIndex = i },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            m.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                            color = if (selected) Color.White else SamsungColors.OnGlass,
                        )
                    }
                }
            }
            Text(modeHint(mode), color = SamsungColors.OnGlassMuted, fontSize = 14.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinePill("Paste") {
                    clipboard.getText()?.text?.trim()?.takeIf { it.isNotEmpty() }?.let { link = it; touched = true; serverError = null }
                }
                PrimaryPillButton(if (adding) "Adding" else "Download", enabled = valid && !adding, modifier = Modifier.weight(1f)) { submit() }
            }
        }
    }
}

@Composable
private fun SetupCard(aria2Missing: Boolean, ytdlpMissing: Boolean) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }
    val missing = listOfNotNull("aria2".takeIf { aria2Missing }, "yt-dlp".takeIf { ytdlpMissing }).joinToString(" and ")
    GlassCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Finish setup on your phone", color = SamsungColors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "$missing isn't ready on the Samsung server yet. Run this in Termux. This screen updates by itself within a minute.",
                color = SamsungColors.OnGlassMuted, fontSize = 16.sp,
            )
            Column(
                Modifier.fillMaxWidth().clip(SamsungShapes.Tile).background(CodeBg).border(1.dp, SamsungColors.NavBorder, SamsungShapes.Tile).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(SETUP_DOWNLOADS_COMMAND, color = Color.White, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clip(SamsungShapes.Pill)
                        .background(SamsungColors.PillSecondary)
                        .clickable(role = Role.Button, onClickLabel = "Copy setup command") {
                            clipboard.setText(AnnotatedString(SETUP_DOWNLOADS_COMMAND))
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
    }
}

@Composable
private fun DownloadRow(
    item: DownloadItem,
    reduce: Boolean,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRetry: () -> Unit,
    onOpenFiles: () -> Unit,
    onRemove: () -> Unit,
) {
    val pct = downloadPercent(item)
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
            Box(Modifier.size(48.dp).clip(SamsungShapes.Tile).background(DownloadGradient), contentAlignment = Alignment.Center) {
                GlassIcon(SamsungIcons.Downloads, null, Color.White, 24.dp)
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    item.name.ifBlank { "Download" }, color = SamsungColors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                if (item.source.isNotBlank()) {
                    Text(item.source, color = SamsungColors.OnGlassMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (item.status != "complete" && item.status != "error") {
            if (pct != null) {
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(SamsungShapes.Pill)
                        .semantics { contentDescription = "Progress $pct percent" },
                    color = SamsungColors.Ink, trackColor = Color(0x33000000),
                )
            } else if (item.status == "active" && !reduce) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(SamsungShapes.Pill),
                    color = SamsungColors.Ink, trackColor = Color(0x33000000),
                )
            }
        }
        Text(
            downloadDetail(item),
            color = if (item.status == "error") SamsungColors.OnGlassCritical else SamsungColors.OnGlassMuted,
            fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Crossfade(targetState = item.status, animationSpec = if (reduce) snap() else tween(200), label = "dlChip") { s ->
                StatusPill(downloadChipText(s), statusColor(s))
            }
            Spacer(Modifier.weight(1f))
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clip(SamsungShapes.Pill)
                    .clickable(role = Role.Button, onClickLabel = "Remove ${item.name.ifBlank { "download" }}", onClick = onRemove)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Remove", color = SamsungColors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        // One main action per state, full width so it never overflows a narrow card.
        val full = Modifier.fillMaxWidth()
        when {
            canPause(item) -> OutlinePill("Pause", full, onPause)
            canResume(item) -> OutlinePill("Resume", full, onResume)
            canRetry(item) -> OutlinePill("Retry", full, onRetry)
            item.status == "complete" -> OutlinePill("Open in Files", full, onOpenFiles)
        }
    }
}

/** Secondary button for light glass cards: dark outline and text, at least 48dp tall. */
@Composable
internal fun OutlinePill(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(SamsungShapes.Pill)
            .border(1.5.dp, SamsungColors.Ink, SamsungShapes.Pill)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = SamsungColors.Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}
