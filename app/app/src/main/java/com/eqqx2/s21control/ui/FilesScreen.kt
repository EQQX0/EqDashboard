package com.eqqx2.s21control.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.s21control.data.FileEntry
import com.eqqx2.s21control.data.ROOT_LABEL
import com.eqqx2.s21control.data.breadcrumbs
import com.eqqx2.s21control.data.validateEntryName
import kotlinx.coroutines.delay
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val FolderGradient = Brush.linearGradient(listOf(Color(0xFFEF4444), Color(0xFFF97316)))
private val FileGradient = Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF3B82F6)))
private val DialogFill = Color(0xFFF6D5D8)

private sealed interface FilesDialog {
    data object NewFolder : FilesDialog
    data class Rename(val entry: FileEntry) : FilesDialog
    data class Delete(val entry: FileEntry) : FilesDialog
}

@Composable
fun FilesScreen(vm: FilesViewModel, topInset: Dp, bottomInset: Dp, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsState()
    val ctx = LocalContext.current
    val reduce = rememberReducedMotion()

    LaunchedEffect(Unit) { vm.refresh() }
    BackHandler(enabled = state.path.isNotEmpty()) { vm.up() }

    var dialog by remember { mutableStateOf<FilesDialog?>(null) }
    val removing = remember { mutableStateListOf<String>() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.entries) { removing.clear() }
    var pendingDownload by rememberSaveable { mutableStateOf<String?>(null) }

    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.upload(uris.map { uploadItem(ctx, it) })
    }
    val saveFile = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val name = pendingDownload
        pendingDownload = null
        val entry = state.entries.firstOrNull { it.name == name }
        if (uri != null && entry != null) {
            vm.download(entry) { ctx.applicationContext.contentResolver.openOutputStream(uri, "w") }
        }
    }

    LaunchedEffect(state.message) {
        if (state.message != null) {
            delay(5_000)
            vm.clearMessage()
        }
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.appear(0).padding(start = 16.dp, end = 16.dp, top = topInset, bottom = 4.dp)) {
                Text("Files", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
                Text(
                    if (state.path.isEmpty()) "$ROOT_LABEL root" else "/${state.path}",
                    color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Breadcrumbs(state.path, onOpen = vm::open)

            state.transfer?.let { t ->
                TransferCard(t, reduce, onCancel = vm::cancelTransfer, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            }
            state.message?.let { msg ->
                StatusChip(
                    msg, Color.White, S21Colors.ChipDark,
                    Modifier
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            if (state.loading && state.loaded) {
                if (reduce) {
                    Text("Refreshing", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 16.dp))
                } else {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                            .semantics { contentDescription = "Refreshing" },
                        color = Color.White, trackColor = S21Colors.BarFill,
                    )
                }
            }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = bottomInset + 48.dp + 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.loading && !state.loaded) {
                    item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                            if (reduce) {
                                Text("Loading files", color = Color.White, fontSize = 16.sp)
                            } else {
                                CircularProgressIndicator(
                                    color = Color.White, trackColor = S21Colors.BarFill,
                                    modifier = Modifier.semantics { contentDescription = "Loading files" },
                                )
                            }
                        }
                    }
                }
                state.error?.let { err ->
                    item(key = "error") {
                        GlassCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(
                                    "Could not load files", color = S21Colors.OnGlass, fontSize = 20.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(err, color = S21Colors.OnGlassCritical, fontSize = 16.sp)
                                PrimaryPillButton("Retry", onClick = vm::refresh)
                            }
                        }
                    }
                }
                if (state.loaded && state.error == null && state.entries.isEmpty()) {
                    item(key = "empty") {
                        GlassCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(
                                    "This folder is empty", color = S21Colors.OnGlass, fontSize = 20.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text("Upload files or create a folder to get started.", color = S21Colors.OnGlassMuted, fontSize = 16.sp)
                                PrimaryPillButton("Upload", enabled = state.transfer == null) {
                                    pickFiles.launch(arrayOf("*/*"))
                                }
                            }
                        }
                    }
                }
                itemsIndexed(state.entries, key = { _, e -> e.name }) { i, entry ->
                    EntryRow(
                        entry = entry,
                        visible = entry.name !in removing,
                        reduce = reduce,
                        modifier = Modifier.appear(minOf(i, 7), enabled = i < 8),
                        onOpenFolder = { vm.open(com.eqqx2.s21control.data.joinPath(state.path, entry.name)) },
                        onRename = { dialog = FilesDialog.Rename(entry) },
                        onDownload = {
                            pendingDownload = entry.name
                            saveFile.launch(entry.name)
                        },
                        onDelete = { dialog = FilesDialog.Delete(entry) },
                    )
                }
            }
        }

        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(start = 16.dp, end = 16.dp, bottom = bottomInset),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PrimaryPillButton("Upload", enabled = state.transfer == null, modifier = Modifier.weight(1f)) {
                pickFiles.launch(arrayOf("*/*"))
            }
            PrimaryPillButton("New folder", enabled = state.transfer == null, modifier = Modifier.weight(1f)) {
                dialog = FilesDialog.NewFolder
            }
        }
    }

    when (val d = dialog) {
        FilesDialog.NewFolder -> NameDialog(
            title = "New folder", label = "Folder name", initial = "", confirmLabel = "Create",
            onConfirm = { vm.mkdir(it); dialog = null },
            onDismiss = { dialog = null },
        )
        is FilesDialog.Rename -> NameDialog(
            title = "Rename", label = "New name", initial = d.entry.name, confirmLabel = "Rename",
            onConfirm = { if (it != d.entry.name) vm.rename(d.entry, it); dialog = null },
            onDismiss = { dialog = null },
        )
        is FilesDialog.Delete -> AlertDialog(
            onDismissRequest = { dialog = null },
            containerColor = DialogFill,
            titleContentColor = S21Colors.OnGlass,
            textContentColor = S21Colors.OnGlassMuted,
            title = { Text("Move ${d.entry.name} to trash?") },
            text = { Text("It will be moved to the trash folder on the server.", fontSize = 16.sp) },
            confirmButton = {
                TextButton(onClick = {
                    val e = d.entry
                    dialog = null
                    scope.launch {
                        if (!reduce) { removing.add(e.name); delay(220) }
                        vm.delete(e)
                    }
                }) {
                    Text("Move to trash", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { dialog = null }) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) }
            },
        )
        null -> {}
    }

    state.conflictName?.let { name ->
        AlertDialog(
            onDismissRequest = { vm.answerConflict(false) },
            containerColor = DialogFill,
            titleContentColor = S21Colors.OnGlass,
            textContentColor = S21Colors.OnGlassMuted,
            title = { Text("Replace $name?") },
            text = { Text("A file with this name already exists in this folder.", fontSize = 16.sp) },
            confirmButton = {
                TextButton(onClick = { vm.answerConflict(true) }) {
                    Text("Replace", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { vm.answerConflict(false) }) { Text("Skip", color = S21Colors.OnGlass, fontSize = 16.sp) }
            },
        )
    }
}

@Composable
private fun Breadcrumbs(path: String, onOpen: (String) -> Unit) {
    val crumbs = breadcrumbs(path)
    val scroll = rememberScrollState()
    LaunchedEffect(path, scroll.maxValue) { scroll.scrollTo(scroll.maxValue) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        crumbs.forEachIndexed { i, c ->
            val current = i == crumbs.lastIndex
            if (i > 0) {
                Text(
                    "/", color = S21Colors.OnCrimsonMuted, fontSize = 16.sp,
                    modifier = Modifier.padding(horizontal = 4.dp).clearAndSetSemantics {},
                )
            }
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .padding(vertical = 4.dp)
                    .clip(S21Shapes.Pill)
                    .background(if (current) Color.White else S21Colors.BarFill)
                    .border(1.dp, S21Colors.GlassBorder, S21Shapes.Pill)
                    .then(
                        if (current) Modifier.semantics { selected = true; contentDescription = "Current folder ${c.label}" }
                        else Modifier.clickable(onClickLabel = "Open ${c.label}", role = Role.Button) { onOpen(c.path) }
                    )
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    c.label, color = if (current) S21Colors.Ink else Color.White, fontSize = 14.sp,
                    fontWeight = if (current) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1, softWrap = false,
                )
            }
        }
    }
}

@Composable
private fun EntryRow(
    entry: FileEntry,
    visible: Boolean,
    reduce: Boolean,
    modifier: Modifier,
    onOpenFolder: () -> Unit,
    onRename: () -> Unit,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        exit = if (reduce) ExitTransition.None else fadeOut(tween(200)) + shrinkVertically(tween(200)),
    ) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .clip(S21Shapes.Stat)
            .background(S21Colors.GlassFill)
            .border(1.dp, S21Colors.GlassBorder, S21Shapes.Stat)
            .clickable(onClickLabel = if (entry.isDir) "Open folder" else "Show actions") {
                if (entry.isDir) onOpenFolder() else menu = true
            }
            .padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(48.dp).clip(S21Shapes.Tile).background(if (entry.isDir) FolderGradient else FileGradient),
            contentAlignment = Alignment.Center,
        ) {
            GlassIcon(if (entry.isDir) S21Icons.Files else S21Icons.FileDoc, null, Color.White, 24.dp)
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                entry.name, color = S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                entryMeta(entry), color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Box {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(S21Shapes.Circle)
                    .clickable(onClickLabel = "Open menu", role = Role.Button) { menu = true }
                    .semantics { contentDescription = "More actions for ${entry.name}" },
                contentAlignment = Alignment.Center,
            ) {
                GlassIcon(S21Icons.MoreVert, null, S21Colors.OnGlass, 24.dp)
            }
            DropdownMenu(
                expanded = menu,
                onDismissRequest = { menu = false },
                modifier = Modifier.background(DialogFill),
            ) {
                DropdownMenuItem(
                    text = { Text("Rename", color = S21Colors.OnGlass, fontSize = 16.sp) },
                    onClick = { menu = false; onRename() },
                )
                if (!entry.isDir) {
                    DropdownMenuItem(
                        text = { Text("Download", color = S21Colors.OnGlass, fontSize = 16.sp) },
                        onClick = { menu = false; onDownload() },
                    )
                }
                DropdownMenuItem(
                    text = { Text("Delete", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
                    onClick = { menu = false; onDelete() },
                )
            }
        }
    }
    }
}

@Composable
private fun TransferCard(t: TransferState, reduce: Boolean, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val pct = t.percent
    GlassCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val verb = if (t.upload) "Uploading" else "Downloading"
            val count = if (t.count > 1) " (${t.index} of ${t.count})" else ""
            Text(
                "$verb ${t.label}$count", color = S21Colors.OnGlass, fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (pct != null) {
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(S21Shapes.Pill)
                        .semantics { contentDescription = "$verb progress $pct percent" },
                    color = S21Colors.Ink, trackColor = Color(0x33000000),
                )
            } else if (!reduce) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(S21Shapes.Pill),
                    color = S21Colors.Ink, trackColor = Color(0x33000000),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    buildString {
                        append(pct?.let { "$it%" } ?: "In progress")
                        append(" • ").append(formatBytes(t.done))
                        t.total?.let { append(" of ").append(formatBytes(it)) }
                    },
                    color = S21Colors.OnGlassMuted, fontSize = 14.sp, modifier = Modifier.weight(1f),
                )
                PrimaryPillButton("Cancel", onClick = onCancel)
            }
        }
    }
}

@Composable
private fun NameDialog(
    title: String,
    label: String,
    initial: String,
    confirmLabel: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
    var touched by remember { mutableStateOf(false) }
    val error = if (touched) validateEntryName(value.text) else null
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    val submit = {
        touched = true
        if (validateEntryName(value.text) == null) onConfirm(value.text.trim())
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = DialogFill,
        titleContentColor = S21Colors.OnGlass,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it; touched = true },
                label = { Text(label, fontSize = 14.sp) },
                singleLine = true,
                isError = error != null,
                supportingText = { if (error != null) Text(error, fontSize = 14.sp) },
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { submit() }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = S21Colors.OnGlass,
                    unfocusedTextColor = S21Colors.OnGlass,
                    errorTextColor = S21Colors.OnGlass,
                    focusedBorderColor = S21Colors.Ink,
                    unfocusedBorderColor = S21Colors.OnGlassMuted,
                    errorBorderColor = S21Colors.OnGlassCritical,
                    focusedLabelColor = S21Colors.Ink,
                    unfocusedLabelColor = S21Colors.OnGlassMuted,
                    errorLabelColor = S21Colors.OnGlassCritical,
                    cursorColor = S21Colors.Ink,
                    errorCursorColor = S21Colors.OnGlassCritical,
                    errorSupportingTextColor = S21Colors.OnGlassCritical,
                ),
            )
        },
        confirmButton = {
            TextButton(onClick = { submit() }) {
                Text(confirmLabel, color = S21Colors.Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) }
        },
    )
}

private val dateFormat: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).withZone(ZoneId.systemDefault())

fun formatModified(iso: String): String =
    if (iso.isBlank()) "" else try {
        dateFormat.format(Instant.parse(iso))
    } catch (e: Exception) {
        iso.take(10)
    }

private fun entryMeta(e: FileEntry): String {
    val first = if (e.isDir) "Folder" else formatBytes(e.size)
    val date = formatModified(e.modified)
    return if (date.isEmpty()) first else "$first • $date"
}

private fun uploadItem(ctx: Context, uri: Uri): UploadItem {
    val resolver = ctx.applicationContext.contentResolver
    var name: String? = null
    var size: Long? = null
    try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val si = c.getColumnIndex(OpenableColumns.SIZE)
                if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni)
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si).takeIf { it >= 0 }
            }
        }
    } catch (_: Exception) {
    }
    val safe = (name ?: uri.lastPathSegment ?: "upload").replace('/', '_').replace('\\', '_').ifBlank { "upload" }
    return UploadItem(safe, size) {
        resolver.openInputStream(uri) ?: throw IOException("Cannot open the selected file")
    }
}
