package com.eqqx2.s21control.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eqqx2.s21control.data.SiteInfo
import com.eqqx2.s21control.data.TunnelRoute
import com.eqqx2.s21control.data.isReservedSiteName
import com.eqqx2.s21control.data.isValidSiteName
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SiteGradient = Brush.linearGradient(listOf(Color(0xFF0EA5E9), Color(0xFF6366F1)))
private val OtherGradient = Brush.linearGradient(listOf(Color(0xFF475569), Color(0xFF1E293B)))
private val SiteDialogFill = Color(0xFFF6D5D8)
private val OfflineGrey = Color(0xFFD1D5DB)
private val SheetBg = Color(0xFF2B1014)
private val CodeBg = Color(0xFF1A1013)

/** The three commands that route every *.<domain> address to the site server. The domain is the person's own. */
internal fun setupCommands(domain: String): List<String> = listOf(
    """sed -i '/^  - service: http_status:404/i\  - hostname: "*.$domain"\n    service: http://127.0.0.1:8790' ~/.cloudflared/config.yml""",
    """cloudflared tunnel route dns samsung-server "*.$domain"""",
    """pkill cloudflared; nohup cloudflared tunnel run >> ~/cloudflared.log 2>&1 &""",
)

@Composable
fun SitesScreen(
    vm: SitesViewModel,
    topInset: Dp,
    bottomInset: Dp,
    onOpenFiles: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val ctx = LocalContext.current
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()

    // Entrance stagger plays only when the tab is first entered before any data exists.
    val animateEntrance = remember { !state.loaded }

    LaunchedEffect(Unit) { vm.refresh() }
    LaunchedEffect(state.message) {
        if (state.message != null) {
            delay(5_000)
            vm.clearMessage()
        }
    }

    var showNew by rememberSaveable { mutableStateOf(false) }
    var showHelp by rememberSaveable { mutableStateOf(false) }
    var deleteName by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingDeploy by rememberSaveable { mutableStateOf<String?>(null) }
    val removing = remember { mutableStateListOf<String>() }
    LaunchedEffect(state.sites) { removing.clear() }

    val pickZip = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val site = state.sites.firstOrNull { it.name == pendingDeploy }
        pendingDeploy = null
        if (uri != null && site != null) vm.deploy(site, uploadItem(ctx, uri))
    }
    fun startDeploy(site: SiteInfo) {
        pendingDeploy = site.name
        pickZip.launch(arrayOf("application/zip", "application/x-zip-compressed"))
    }

    val domain = state.domain.ifBlank { "yourdomain.com" }
    val busy = state.deploy != null

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.appear(0, animateEntrance).padding(start = 16.dp, end = 16.dp, top = topInset, bottom = 4.dp)) {
                Text("Sites", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
                Text("Websites hosted on your Samsung server", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
            }

            state.deploy?.let { d ->
                DeployCard(d, reduce, onCancel = vm::cancelDeploy, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            }
            state.message?.let { msg ->
                StatusChip(
                    msg, Color.White, S21Colors.ChipDark,
                    Modifier.padding(horizontal = 16.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
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
                                Text("Loading sites", color = Color.White, fontSize = 16.sp)
                            } else {
                                CircularProgressIndicator(
                                    color = Color.White, trackColor = S21Colors.BarFill,
                                    modifier = Modifier.semantics { contentDescription = "Loading sites" },
                                )
                            }
                        }
                    }
                }
                state.error?.let { err ->
                    item(key = "error") {
                        GlassCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Could not load sites", color = S21Colors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                                Text(err, color = S21Colors.OnGlassCritical, fontSize = 16.sp)
                                PrimaryPillButton("Retry", onClick = vm::refresh)
                            }
                        }
                    }
                }
                if (needsSetupHelp(state.sites, state.reach)) {
                    item(key = "setup") {
                        GlassCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Finish setup on your phone", color = S21Colors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "Your sites need a wildcard route in the Cloudflare tunnel before they can be reached.",
                                    color = S21Colors.OnGlassMuted, fontSize = 16.sp,
                                )
                                PrimaryPillButton("Show commands") { showHelp = true }
                            }
                        }
                    }
                }
                if (state.loaded && state.error == null && state.sites.isEmpty()) {
                    item(key = "empty") {
                        GlassCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("No sites yet", color = S21Colors.OnGlass, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                                Text("Create a site, then deploy a zip of your website to it.", color = S21Colors.OnGlassMuted, fontSize = 16.sp)
                                PrimaryPillButton("New site") { showNew = true }
                            }
                        }
                    }
                }
                itemsIndexed(state.sites, key = { _, s -> s.name }) { i, site ->
                    SiteRow(
                        site = site,
                        domain = domain,
                        reach = state.reach[site.name] ?: SiteReach.Unknown,
                        visible = site.name !in removing,
                        reduce = reduce,
                        deployBusy = busy,
                        modifier = Modifier.appear(minOf(i, 7), enabled = animateEntrance && i < 8),
                        onDeploy = { startDeploy(site) },
                        onOpenFiles = { onOpenFiles("sites/${site.name}") },
                        onToggleEnabled = { vm.setEnabled(site, !site.enabled) },
                        onToggleSpa = { vm.setSpa(site, !site.spa) },
                        onOpenBrowser = { openSite(ctx, site, domain) },
                        onDelete = { deleteName = site.name },
                    )
                }
                val others = state.tunnel.orEmpty()
                if (others.isNotEmpty()) {
                    item(key = "others-header") {
                        Column(Modifier.padding(top = 12.dp)) {
                            Text("Other apps on your tunnel", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                "Hosted outside this tool. Shown for status only.",
                                color = S21Colors.OnCrimsonMuted, fontSize = 14.sp,
                            )
                        }
                    }
                    items(others, key = { "tunnel-" + it.hostname + "|" + it.service }) { route ->
                        TunnelRow(route, reduce, onOpen = { openHost(ctx, route.hostname) })
                    }
                }
            }
        }

        Row(
            Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = bottomInset),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PrimaryPillButton("New site", modifier = Modifier.weight(1f)) { showNew = true }
            if (state.sites.size == 1) {
                val only = state.sites[0]
                SecondaryPillButton("Deploy zip", enabled = !busy, modifier = Modifier.weight(1f)) { startDeploy(only) }
            }
        }
    }

    if (showNew) {
        NewSiteDialog(
            domain = domain,
            creating = state.creating,
            onCreate = vm::create,
            onDismiss = { showNew = false },
        )
    }

    deleteName?.let { name ->
        val site = state.sites.firstOrNull { it.name == name }
        if (site == null) {
            deleteName = null
        } else {
            AlertDialog(
                onDismissRequest = { deleteName = null },
                containerColor = SiteDialogFill,
                titleContentColor = S21Colors.OnGlass,
                textContentColor = S21Colors.OnGlassMuted,
                title = { Text("Move ${site.name} to trash?") },
                text = { Text("The site goes offline and its files move to the trash folder on the server.", fontSize = 16.sp) },
                confirmButton = {
                    TextButton(onClick = {
                        deleteName = null
                        scope.launch {
                            if (!reduce) { removing.add(site.name); delay(220) }
                            vm.delete(site)
                        }
                    }) {
                        Text("Move to trash", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { deleteName = null }) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) }
                },
            )
        }
    }

    if (showHelp) {
        SetupSheet(
            domain = state.domain,
            onCheckAgain = { vm.recheck() },
            onDismiss = { showHelp = false },
        )
    }
}

private fun siteUrl(site: SiteInfo, domain: String): String =
    "https://" + site.hostname.ifBlank { "${site.name}.$domain" }

private fun openSite(ctx: android.content.Context, site: SiteInfo, domain: String) {
    try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(siteUrl(site, domain))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
    }
}

@Composable
private fun SiteRow(
    site: SiteInfo,
    domain: String,
    reach: SiteReach,
    visible: Boolean,
    reduce: Boolean,
    deployBusy: Boolean,
    modifier: Modifier,
    onDeploy: () -> Unit,
    onOpenFiles: () -> Unit,
    onToggleEnabled: () -> Unit,
    onToggleSpa: () -> Unit,
    onOpenBrowser: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val host = site.hostname.ifBlank { "${site.name}.$domain" }
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        exit = if (reduce) ExitTransition.None else fadeOut(tween(200)) + shrinkVertically(tween(200)),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(S21Shapes.Stat)
                .background(S21Colors.GlassFill)
                .border(1.dp, S21Colors.GlassBorder, S21Shapes.Stat)
                .padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).clip(S21Shapes.Tile).background(SiteGradient),
                    contentAlignment = Alignment.Center,
                ) {
                    GlassIcon(S21Icons.Sites, null, Color.White, 24.dp)
                }
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        site.name, color = S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Box(
                        Modifier
                            .heightIn(min = 48.dp)
                            .clickable(onClickLabel = "Open $host in browser", role = Role.Button, onClick = onOpenBrowser),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(
                            host, color = S21Colors.OnGlass, fontSize = 14.sp,
                            textDecoration = TextDecoration.Underline,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Box {
                    Box(
                        Modifier
                            .size(48.dp)
                            .clip(S21Shapes.Circle)
                            .clickable(onClickLabel = "Open menu", role = Role.Button) { menu = true }
                            .semantics { contentDescription = "More actions for ${site.name}" },
                        contentAlignment = Alignment.Center,
                    ) {
                        GlassIcon(S21Icons.MoreVert, null, S21Colors.OnGlass, 24.dp)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.background(SiteDialogFill)) {
                        MenuItem("Deploy zip", enabled = !deployBusy) { menu = false; onDeploy() }
                        MenuItem("Open files") { menu = false; onOpenFiles() }
                        MenuItem(if (site.enabled) "Disable" else "Enable") { menu = false; onToggleEnabled() }
                        MenuItem(if (site.spa) "Single-page app: turn off" else "Single-page app: turn on") { menu = false; onToggleSpa() }
                        MenuItem("Open in browser") { menu = false; onOpenBrowser() }
                        DropdownMenuItem(
                            text = { Text("Delete", color = S21Colors.OnGlassCritical, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
                            onClick = { menu = false; onDelete() },
                        )
                    }
                }
            }
            Row(
                Modifier.padding(top = 4.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ReachChip(site.enabled, reach, reduce)
                Text(
                    siteMeta(site, System.currentTimeMillis()), color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun MenuItem(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = if (enabled) S21Colors.OnGlass else S21Colors.OnGlassMuted, fontSize = 16.sp) },
        enabled = enabled,
        onClick = onClick,
    )
}

@Composable
private fun ReachChip(enabled: Boolean, reach: SiteReach, reduce: Boolean) {
    val text = siteChipText(enabled, reach)
    Crossfade(targetState = text, animationSpec = if (reduce) snap() else tween(200), label = "chip") { t ->
        val color = when (t) {
            "Live" -> S21Colors.Emerald
            "Offline" -> OfflineGrey
            "Not reachable yet" -> S21Colors.Amber
            else -> S21Colors.OnCrimsonMuted
        }
        StatusPill(t, color)
    }
}

/** Dark pill with coloured words. The words carry the meaning; colour only reinforces it. */
@Composable
internal fun StatusPill(text: String, color: Color) {
    Box(Modifier.clip(S21Shapes.Pill).background(S21Colors.Ink).padding(horizontal = 12.dp, vertical = 6.dp)) {
        Text(text, color = color, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

private fun openHost(ctx: android.content.Context, host: String) {
    try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://$host")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
    }
}

/** Read-only card for an app the tunnel routes but this tool does not host (gym, downloader, ...). */
@Composable
private fun TunnelRow(route: TunnelRoute, reduce: Boolean, onOpen: () -> Unit) {
    val text = tunnelChipText(route.up)
    val web = isWebRoute(route)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(S21Shapes.Stat)
            .background(S21Colors.GlassFill)
            .border(1.dp, S21Colors.GlassBorder, S21Shapes.Stat)
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(48.dp).clip(S21Shapes.Tile).background(OtherGradient),
                contentAlignment = Alignment.Center,
            ) {
                GlassIcon(S21Icons.Sites, null, Color.White, 24.dp)
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                if (web) {
                    Box(
                        Modifier
                            .heightIn(min = 48.dp)
                            .clickable(onClickLabel = "Open ${route.hostname} in browser", role = Role.Button, onClick = onOpen),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(
                            route.hostname, color = S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                            textDecoration = TextDecoration.Underline, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                } else {
                    Text(
                        route.hostname, color = S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(tunnelMeta(route), color = S21Colors.OnGlassMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(Modifier.padding(top = 8.dp)) {
            Crossfade(targetState = text, animationSpec = if (reduce) snap() else tween(200), label = "tunnelChip") { t ->
                StatusPill(
                    t,
                    when (t) {
                        "Running" -> S21Colors.Emerald
                        "Not running" -> S21Colors.Amber
                        else -> S21Colors.OnCrimsonMuted
                    },
                )
            }
        }
    }
}

@Composable
internal fun SecondaryPillButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .background(S21Colors.NavScrim)
            .background(S21Colors.PillSecondary)
            .border(1.dp, S21Colors.NavBorder, S21Shapes.Pill)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) Color.White else S21Colors.OnCrimsonMuted, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun DeployCard(d: DeployState, reduce: Boolean, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val pct = d.percent
    GlassCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Deploying to ${d.site}", color = S21Colors.OnGlass, fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (pct != null) {
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(S21Shapes.Pill)
                        .semantics { contentDescription = "Deploy progress $pct percent" },
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
                        append(" • ").append(formatBytes(d.done))
                        d.total?.let { append(" of ").append(formatBytes(it)) }
                    },
                    color = S21Colors.OnGlassMuted, fontSize = 14.sp, modifier = Modifier.weight(1f),
                )
                PrimaryPillButton("Cancel", onClick = onCancel)
            }
        }
    }
}

@Composable
private fun NewSiteDialog(
    domain: String,
    creating: Boolean,
    onCreate: (String, Boolean, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var touched by rememberSaveable { mutableStateOf(false) }
    var serverError by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    val trimmed = name.trim()
    val localError = when {
        !touched -> null
        trimmed.isEmpty() -> "Enter a name"
        isReservedSiteName(trimmed) -> "That name is reserved"
        !isValidSiteName(trimmed) -> "Use 1-32 lowercase letters, numbers or hyphens (not at the start or end)"
        else -> null
    }
    val error = localError ?: serverError
    val submit = {
        touched = true
        if (isValidSiteName(trimmed) && !creating) {
            serverError = null
            onCreate(trimmed, false) { err -> if (err == null) onDismiss() else serverError = err }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!creating) onDismiss() },
        containerColor = SiteDialogFill,
        titleContentColor = S21Colors.OnGlass,
        title = { Text("New site") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it; touched = true; serverError = null },
                    label = { Text("Site name", fontSize = 14.sp) },
                    singleLine = true,
                    isError = error != null,
                    supportingText = { if (error != null) Text(error, fontSize = 14.sp) },
                    textStyle = TextStyle(fontSize = 16.sp),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
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
                Text(
                    "Address: " + (trimmed.ifEmpty { "name" }) + "." + domain,
                    color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { submit() }, enabled = !creating) {
                Text(if (creating) "Creating" else "Create", color = S21Colors.Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !creating) { Text("Cancel", color = S21Colors.OnGlass, fontSize = 16.sp) }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetupSheet(domain: String, onCheckAgain: () -> Unit, onDismiss: () -> Unit) {
    val shownDomain = domain.ifBlank { "yourdomain.com" }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(copied) {
        if (copied != null) {
            delay(2_000)
            copied = null
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SheetBg,
        contentColor = Color.White,
        scrimColor = Color(0x99000000),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Finish setup on your phone", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Run these three commands in Termux once. They route every *.$shownDomain address to the site server." + if (domain.isBlank()) " Replace yourdomain.com with your own domain first." else "",
                color = S21Colors.OnCrimsonMuted, fontSize = 16.sp,
            )
            setupCommands(shownDomain).forEachIndexed { i, cmd ->
                Column(
                    Modifier.fillMaxWidth().clip(S21Shapes.Tile).background(CodeBg)
                        .border(1.dp, S21Colors.NavBorder, S21Shapes.Tile)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Step ${i + 1}", color = S21Colors.OnCrimsonMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text(cmd, color = Color.White, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
                    Box(
                        Modifier
                            .heightIn(min = 48.dp)
                            .clip(S21Shapes.Pill)
                            .background(S21Colors.PillSecondary)
                            .clickable(role = Role.Button, onClickLabel = "Copy command ${i + 1}") {
                                clipboard.setText(AnnotatedString(cmd))
                                copied = i
                            }
                            .padding(horizontal = 20.dp)
                            .semantics { if (copied == i) liveRegion = LiveRegionMode.Polite },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (copied == i) "Copied" else "Copy",
                            color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            PrimaryPillButton("Check again", modifier = Modifier.fillMaxWidth()) {
                onCheckAgain()
                onDismiss()
            }
        }
    }
}
