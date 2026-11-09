package com.eqqx2.s21control.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.s21control.data.PcItem
import kotlinx.coroutines.delay

private fun pcChipColor(text: String): Color = when (text) {
    "On" -> S21Colors.Emerald
    "Starting", "Shutting down" -> S21Colors.Amber
    else -> S21Colors.OnCrimsonMuted
}

/** Turn a PC on (Wake-on-LAN) or off (SSH shutdown) from Overview. */
@Composable
fun PcSection(vm: PcViewModel, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    DisposableEffect(Unit) {
        vm.startPolling()
        onDispose { vm.stopPolling() }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    LaunchedEffect(state.message) {
        if (state.message != null) {
            delay(6_000)
            vm.clearMessage()
        }
    }

    var showAdd by rememberSaveable { mutableStateOf(false) }
    var setupId by rememberSaveable { mutableStateOf<String?>(null) }
    // A PC was just added: open its setup as soon as it shows up in the list.
    var setupMac by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(state.items, setupMac) {
        val mac = setupMac ?: return@LaunchedEffect
        state.items.firstOrNull { it.mac == mac }?.let { setupId = it.id; setupMac = null }
    }
    // Not saveable on purpose: the link holds a token and should not be written into saved state.
    var popup by remember { mutableStateOf<Pair<String, String>?>(null) }
    val reduce = rememberReducedMotion()
    var offId by rememberSaveable { mutableStateOf<String?>(null) }
    var removeId by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.padding(top = 8.dp)) {
            Text("My PC", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Light)
            Text("Turn a computer on or off from here", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
        }
        state.message?.let { msg ->
            StatusChip(msg, Color.White, S21Colors.ChipDark, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
        if (state.error != null && !state.loaded) {
            StatusChip("Could not load PCs: ${state.error}", S21Colors.ChipErrorText, S21Colors.ChipErrorFill)
        }
        state.items.forEach { item ->
            val t = state.transitions[item.id]
            PcRow(
                item = item,
                chip = pcChipText(item, t, now),
                canWake = canWake(item, t, now),
                canOff = canShutdown(item, t, now),
                onWake = { vm.wake(item) },
                onOff = { if (item.sshUser.isBlank()) setupId = item.id else offId = item.id },
                onSetup = { setupId = item.id },
                onLights = {
                    vm.openLights(item) { url, err ->
                        if (url != null) popup = item.name to url else vm.showMessage(err ?: "Could not open the lights")
                    }
                },
                onRemove = { removeId = item.id },
            )
        }
        if (state.loaded) {
            GlassCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.items.isEmpty()) {
                        Text("No PC added yet", color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Add your PC's MAC address and home network address. Turning it on needs Wake-on-LAN enabled on the PC.",
                            color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                        )
                    }
                    OutlinePill("Add a PC", Modifier.fillMaxWidth()) { showAdd = true }
                }
            }
        }
    }

    if (showAdd) {
        AddPcDialog(
            saving = state.saving,
            onAdd = { n, m, i, u, cb -> vm.add(n, m, i, u) { err -> if (err == null) setupMac = normalizeMacInput(m); cb(err) } },
            onDismiss = { showAdd = false },
        )
    }
    popup?.let { (n, u) -> LightsPopup(n, u, reduce, onClose = { popup = null }) }
    setupId?.let { id ->
        val item = state.items.firstOrNull { it.id == id }
        if (item == null) setupId = null else SetupDialog(item, vm, onDismiss = { setupId = null })
    }
    offId?.let { id ->
        val item = state.items.firstOrNull { it.id == id }
        if (item == null) offId = null else {
            AlertDialog(
                onDismissRequest = { offId = null },
                containerColor = Color(0xFFF6D5D8),
                titleContentColor = S21Colors.OnGlass,
                textContentColor = S21Colors.OnGlassMuted,
                title = { Text("Turn off ${item.name}?") },
                text = { Text("Windows shuts down in a few seconds. Unsaved work on the PC is lost.", fontSize = 16.sp) },
                confirmButton = {
                    TextButton(onClick = { offId = null; vm.shutdown(item) }) {
                        Text("Turn off", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = { TextButton(onClick = { offId = null }) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) } },
            )
        }
    }
    removeId?.let { id ->
        val item = state.items.firstOrNull { it.id == id }
        if (item == null) removeId = null else {
            AlertDialog(
                onDismissRequest = { removeId = null },
                containerColor = Color(0xFFF6D5D8),
                titleContentColor = S21Colors.OnGlass,
                textContentColor = S21Colors.OnGlassMuted,
                title = { Text("Remove ${item.name}?") },
                text = { Text("It leaves this list. The PC itself is not changed.", fontSize = 16.sp) },
                confirmButton = {
                    TextButton(onClick = { removeId = null; vm.delete(item) }) {
                        Text("Remove", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = { TextButton(onClick = { removeId = null }) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) } },
            )
        }
    }
}

@Composable
private fun PcRow(
    item: PcItem,
    chip: String,
    canWake: Boolean,
    canOff: Boolean,
    onWake: () -> Unit,
    onOff: () -> Unit,
    onSetup: () -> Unit,
    onLights: () -> Unit,
    onRemove: () -> Unit,
) {
    val setUp = item.sshUser.isNotBlank() && item.hasLights
    GlassCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(item.name, color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${item.ip} • ${item.mac}", color = S21Colors.OnGlassMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.size(8.dp))
                StatusPill(chip, pcChipColor(chip))
            }
            if (canWake) PrimaryPillButton("Turn on", modifier = Modifier.fillMaxWidth(), onClick = onWake)
            if (canOff) OutlinePill("Turn off", Modifier.fillMaxWidth(), onOff)
            if (item.hasLights && chip == "On") OutlinePill("Lights", Modifier.fillMaxWidth(), onLights)
            if (!setUp) {
                // Shown only until shutdown and lights are both saved.
                OutlinePill(if (item.sshUser.isBlank() && !item.hasLights) "Set up" else "Finish setup", Modifier.fillMaxWidth(), onSetup)
            }
            if (!canWake && !canOff) {
                Text(
                    if (chip == "Starting") "Waiting for Windows to start" else "Shutting down",
                    color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (setUp) TextAction("Edit setup", onSetup, Modifier.weight(1f))
                TextAction("Remove", onRemove, Modifier.weight(1f), critical = true)
            }
        }
    }
}

@Composable
private fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, critical: Boolean = false) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (critical) S21Colors.OnGlassCritical else S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AddPcDialog(saving: Boolean, onAdd: (String, String, String, String, (String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var mac by rememberSaveable { mutableStateOf("") }
    var ip by rememberSaveable { mutableStateOf("") }
    var serverError by remember { mutableStateOf<String?>(null) }
    val macError = macInputError(mac)
    val ipError = ipInputError(ip)
    val ready = name.isNotBlank() && mac.isNotBlank() && ip.isNotBlank() && macError == null && ipError == null && !saving
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFFF6D5D8),
        titleContentColor = S21Colors.OnGlass,
        textContentColor = S21Colors.OnGlassMuted,
        title = { Text("Add a PC") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it; serverError = null }, singleLine = true,
                    label = { Text("Name", fontSize = 14.sp) }, textStyle = TextStyle(fontSize = 16.sp),
                    colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = mac, onValueChange = { mac = it; serverError = null }, singleLine = true,
                    label = { Text("MAC address", fontSize = 14.sp) }, isError = macError != null,
                    supportingText = { Text(macError ?: "Windows: run ipconfig /all, look for Physical Address", fontSize = 14.sp) },
                    textStyle = TextStyle(fontSize = 16.sp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = ip, onValueChange = { ip = it; serverError = null }, singleLine = true,
                    label = { Text("PC address", fontSize = 14.sp) }, isError = ipError != null,
                    supportingText = { Text(ipError ?: "Like 192.168.1.20. Give the PC a fixed address in your router.", fontSize = 14.sp) },
                    textStyle = TextStyle(fontSize = 16.sp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                serverError?.let { Text(it, color = S21Colors.OnGlassCritical, fontSize = 14.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = ready,
                onClick = { onAdd(name, mac, ip, "") { err -> if (err == null) onDismiss() else serverError = err } },
            ) {
                Text(if (saving) "Adding" else "Add", color = if (ready) S21Colors.OnGlass else S21Colors.OnGlassMuted, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) } },
    )
}

/**
 * One setup for everything the S21 does with this PC: shutdown (a Windows user and one PowerShell command) and
 * lights (the EqRGB phone link). Each part is optional, so the PC can be set up in one go or in two visits.
 * Turning on needs none of it.
 */
@Composable
private fun SetupDialog(item: PcItem, vm: PcViewModel, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var user by rememberSaveable { mutableStateOf(item.sshUser) }
    // Not saveable on purpose: the link holds a token and should not be written into saved state.
    var link by remember { mutableStateOf("") }
    var key by remember { mutableStateOf<String?>(null) }
    var keyError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.fetchKey { k, e -> key = k; keyError = e } }
    val userError = userInputError(user)
    val linkError = lightsLinkError(link, item.ip)
    val userChanged = user.isNotEmpty() && user != item.sshUser
    val canSave = !saving && userError == null && linkError == null && (userChanged || link.isNotBlank())

    fun save() {
        saving = true
        error = null
        fun saveLights() {
            if (link.isBlank()) { onDismiss(); return }
            vm.setLights(item, link) { err -> saving = false; if (err == null) onDismiss() else error = err }
        }
        if (userChanged) vm.setSshUser(item, user) { err -> if (err == null) saveLights() else { saving = false; error = err } }
        else saveLights()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFFF6D5D8),
        titleContentColor = S21Colors.OnGlass,
        textContentColor = S21Colors.OnGlassMuted,
        title = { Text("Set up ${item.name}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Turning on already works. This adds turning off and the lights. Fill in what you want, then Save. You can come back for the rest.", fontSize = 14.sp)

                Text("Turn off", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = S21Colors.OnGlass)
                OutlinedTextField(
                    value = user, onValueChange = { user = it.trim(); error = null }, singleLine = true,
                    label = { Text("Windows user (an administrator)", fontSize = 14.sp) }, isError = userError != null,
                    supportingText = { Text(userError ?: if (item.sshUser.isNotBlank()) "Saved" else "The name you sign in to Windows with", fontSize = 14.sp) },
                    textStyle = TextStyle(fontSize = 16.sp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                Text("On the PC, open PowerShell as administrator and paste this once. It installs OpenSSH and lets the S21 shut the PC down, nothing else.", fontSize = 14.sp)
                val k = key
                if (k != null) CommandBlock(pcSetupCommand(k), "Copy PowerShell command")
                else Text(keyError ?: "Getting the S21's key", fontSize = 14.sp, color = if (keyError != null) S21Colors.OnGlassCritical else S21Colors.OnGlassMuted)

                Text("Lights", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = S21Colors.OnGlass)
                Text(
                    "In EqRGB on the PC, turn on the phone remote and copy its link. The Lights button then works from any network, through the S21, while the PC is on and EqRGB is running.",
                    fontSize = 14.sp,
                )
                if (item.hasLights) Text("A link is saved. Paste a new one to replace it.", fontSize = 14.sp, color = S21Colors.OnGlass)
                OutlinedTextField(
                    value = link, onValueChange = { link = it; error = null }, minLines = 2, maxLines = 4,
                    label = { Text("EqRGB phone link", fontSize = 14.sp) }, isError = linkError != null,
                    supportingText = { Text(linkError ?: "Treat this link like a password: anyone with it controls the lights.", fontSize = 14.sp) },
                    textStyle = TextStyle(fontSize = 14.sp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                OutlinePill("Paste", Modifier.fillMaxWidth()) {
                    clipboard.getText()?.text?.trim()?.takeIf { it.isNotEmpty() }?.let { link = it; error = null }
                }
                if (item.hasLights) {
                    TextAction("Remove saved link", { vm.setLights(item, "") { err -> if (err == null) onDismiss() else error = err } }, Modifier.fillMaxWidth(), critical = true)
                }
                error?.let { Text(it, color = S21Colors.OnGlassCritical, fontSize = 14.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            }
        },
        confirmButton = {
            TextButton(enabled = canSave, onClick = ::save) {
                Text(if (saving) "Saving" else "Save", color = if (canSave) S21Colors.OnGlass else S21Colors.OnGlassMuted, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close", color = S21Colors.OnGlass, fontSize = 16.sp) } },
    )
}
