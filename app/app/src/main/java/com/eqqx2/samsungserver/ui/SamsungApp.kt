package com.eqqx2.samsungserver.ui

import android.provider.OpenableColumns
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import com.eqqx2.samsungserver.data.PairResult
import com.eqqx2.samsungserver.data.isPairFileName
import com.eqqx2.samsungserver.data.parsePairFile
import com.eqqx2.samsungserver.data.readPairText
import com.eqqx2.samsungserver.BuildConfig
import com.eqqx2.samsungserver.data.ApkInstaller
import com.eqqx2.samsungserver.data.UpdateClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.eqqx2.samsungserver.data.AgentClient
import com.eqqx2.samsungserver.data.DownloadsClient
import com.eqqx2.samsungserver.data.VpsClient
import com.eqqx2.samsungserver.data.AgentUpdateClient
import com.eqqx2.samsungserver.data.PcClient
import com.eqqx2.samsungserver.data.isHttpsUrl
import com.eqqx2.samsungserver.data.FetchResult
import com.eqqx2.samsungserver.data.FilesClient
import com.eqqx2.samsungserver.data.SitesClient
import com.eqqx2.samsungserver.data.TokenStore
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

private data class Tab(val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("Overview", SamsungIcons.Overview),
    Tab("Files", SamsungIcons.Files),
    Tab("Downloads", SamsungIcons.Downloads),
    Tab("Sites", SamsungIcons.Sites),
    Tab("VPS", SamsungIcons.Vps),
)

@Composable
fun SamsungApp() {
    SamsungTheme {
        val context = LocalContext.current
        val store = remember { TokenStore(context) }
        val client = remember { AgentClient() }
        val vm: StatusViewModel = viewModel(factory = viewModelFactory {
            initializer { StatusViewModel(client, store) }
        })
        val filesClient = remember { FilesClient() }
        val filesVm: FilesViewModel = viewModel(factory = viewModelFactory {
            initializer { FilesViewModel(filesClient, store) }
        })
        val sitesClient = remember { SitesClient() }
        val sitesVm: SitesViewModel = viewModel(factory = viewModelFactory {
            initializer { SitesViewModel(sitesClient, store) }
        })
        val downloadsClient = remember { DownloadsClient() }
        val downloadsVm: DownloadsViewModel = viewModel(factory = viewModelFactory {
            initializer { DownloadsViewModel(downloadsClient, store) }
        })
        val pcClient = remember { PcClient() }
        val pcVm: PcViewModel = viewModel(factory = viewModelFactory {
            initializer { PcViewModel(pcClient, store) }
        })
        val agentUpdateClient = remember { AgentUpdateClient() }
        val agentUpdateVm: AgentUpdateViewModel = viewModel(factory = viewModelFactory {
            initializer { AgentUpdateViewModel(agentUpdateClient, store) }
        })
        val vpsClient = remember { VpsClient() }
        val vpsVm: VpsViewModel = viewModel(factory = viewModelFactory {
            initializer { VpsViewModel(vpsClient, store) }
        })
        val updateVm: UpdateViewModel = viewModel(factory = viewModelFactory {
            initializer {
                UpdateViewModel(
                    appContext = context.applicationContext,
                    client = UpdateClient(),
                    repo = BuildConfig.UPDATE_REPO,
                    versionName = BuildConfig.VERSION_NAME,
                    versionCode = BuildConfig.VERSION_CODE,
                    prefs = context.applicationContext.getSharedPreferences(
                        UpdateViewModel.PREFS_NAME, Context.MODE_PRIVATE,
                    ),
                )
            }
        })
        val scope = rememberCoroutineScope()
        LaunchedEffect(Unit) {
            withContext(Dispatchers.IO) { ApkInstaller.clearOldUpdates(context.applicationContext) }
        }

        var loggedIn by remember { mutableStateOf(store.token != null) }
        var notice by remember { mutableStateOf<String?>(null) }
        var noticeTick by remember { mutableStateOf(0) }
        val reduce = rememberReducedMotion()
        var busy by remember { mutableStateOf(false) }

        LaunchedEffect(loggedIn) {
            if (loggedIn) updateVm.backgroundCheck() else { downloadsVm.reset(); vpsVm.reset(); agentUpdateVm.reset(); pcVm.reset() }
        }
        val state by vm.state.collectAsState()
        LaunchedEffect(state.unauthorized) {
            if (state.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                vm.reset()
            }
        }

        val filesState by filesVm.state.collectAsState()
        LaunchedEffect(filesState.unauthorized) {
            if (filesState.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                filesVm.reset()
                vm.reset()
            }
        }

        val sitesState by sitesVm.state.collectAsState()
        LaunchedEffect(sitesState.unauthorized) {
            if (sitesState.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                sitesVm.reset()
                filesVm.reset()
                vm.reset()
            }
        }

        val downloadsState by downloadsVm.state.collectAsState()
        LaunchedEffect(downloadsState.unauthorized) {
            if (downloadsState.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                downloadsVm.reset()
                sitesVm.reset()
                filesVm.reset()
                vm.reset()
            }
        }

        val pcState by pcVm.state.collectAsState()
        LaunchedEffect(pcState.unauthorized) {
            if (pcState.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                pcVm.reset()
                vpsVm.reset()
                downloadsVm.reset()
                sitesVm.reset()
                filesVm.reset()
                vm.reset()
            }
        }

        val vpsState by vpsVm.state.collectAsState()
        LaunchedEffect(vpsState.unauthorized) {
            if (vpsState.unauthorized) {
                loggedIn = false
                notice = "Token rejected"; noticeTick++
                vpsVm.reset()
                downloadsVm.reset()
                sitesVm.reset()
                filesVm.reset()
                vm.reset()
            }
        }

        // Picked token file, kept only so it can be deleted after a successful import.
        var importedUri by remember { mutableStateOf<Uri?>(null) }
        var importMessage by remember { mutableStateOf<String?>(null) }
        val navBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

        fun connect(url: String, token: String, picked: Uri?) {
            if (!isHttpsUrl(url)) {
                notice = "The server address must start with https://"; noticeTick++
                return
            }
            busy = true
            notice = null
            scope.launch {
                when (val r = client.fetchStatus(url, token)) {
                    is FetchResult.Ok -> {
                        store.baseUrl = url
                        store.token = token
                        if (picked != null) { importedUri = picked; importMessage = null }
                        loggedIn = true
                    }
                    FetchResult.Unauthorized -> { notice = "Token rejected"; noticeTick++ }
                    FetchResult.RateLimited -> { notice = "Too many requests, retrying later"; noticeTick++ }
                    is FetchResult.Failure -> { notice = r.message; noticeTick++ }
                }
                busy = false
            }
        }

        fun import(uri: Uri) {
            busy = true
            notice = null
            scope.launch {
                val text = withContext(Dispatchers.IO) {
                    try {
                        context.contentResolver.openInputStream(uri)?.use { readPairText(it) }
                    } catch (e: Exception) {
                        null
                    }
                }
                val name = withContext(Dispatchers.IO) {
                    try {
                        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
                    } catch (e: Exception) {
                        null
                    }
                }
                if (name != null && !isPairFileName(name)) {
                    notice = "Pick a samsung-server.pair file"; noticeTick++
                    busy = false
                    return@launch
                }
                val parsed = text?.let { parsePairFile(it) }
                if (parsed is PairResult.Ok) {
                    connect(parsed.url, parsed.token, uri)
                } else {
                    notice = "That file isn't a valid Samsung server token file"; noticeTick++
                    busy = false
                }
            }
        }

        Box(Modifier.fillMaxSize()) {
        Crossfade(targetState = loggedIn, animationSpec = if (reduce) snap() else tween(300), label = "auth") { isIn ->
        if (!isIn) {
            LoginScreen(
                initialUrl = store.baseUrl,
                notice = notice,
                noticeTick = noticeTick,
                busy = busy,
                onConnect = { url, token -> connect(url, token, null) },
                onImport = { uri -> import(uri) },
            )
        } else {
            Shell(
                vm = vm,
                filesVm = filesVm,
                sitesVm = sitesVm,
                downloadsVm = downloadsVm,
                vpsVm = vpsVm,
                agentUpdateVm = agentUpdateVm,
                pcVm = pcVm,
                updateVm = updateVm,
            )
        }
        }
        val picked = importedUri
        if (picked != null && loggedIn) {
            ImportedCard(
                message = importMessage,
                onDelete = {
                    scope.launch {
                        val ok = withContext(Dispatchers.IO) {
                            try { DocumentsContract.deleteDocument(context.contentResolver, picked) } catch (e: Exception) { false }
                        }
                        if (ok) importedUri = null
                        else importMessage = "Couldn't delete it; remove it with: rm ~/storage/downloads/samsung-server.pair"
                    }
                },
                onDismiss = { importedUri = null },
                modifier = Modifier.align(Alignment.BottomCenter)
                    .padding(bottom = navBottom + NavHeight + 32.dp, start = 16.dp, end = 16.dp),
            )
        }
        }
    }
}

private val TopBarHeight = 76.dp
private val NavHeight = 68.dp

@Composable
private fun Shell(
    vm: StatusViewModel,
    filesVm: FilesViewModel,
    sitesVm: SitesViewModel,
    downloadsVm: DownloadsViewModel,
    vpsVm: VpsViewModel,
    agentUpdateVm: AgentUpdateViewModel,
    pcVm: PcViewModel,
    updateVm: UpdateViewModel,
) {
    val agentPhase by agentUpdateVm.phase.collectAsState()
    LaunchedEffect(Unit) { agentUpdateVm.checkOnce() }
    val updateState by updateVm.state.collectAsState()
    var showSheet by rememberSaveable { mutableStateOf(false) }
    InstallLauncher(updateVm)
    if (showSheet) UpdateSheet(updateVm) { showSheet = false }
    var tab by rememberSaveable { mutableStateOf(0) }
    val reduce = rememberReducedMotion()
    val density = LocalDensity.current
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    // Content scrolls under the floating bars, so it is padded by the bars' real heights.
    val topInset = statusTop + TopBarHeight + 12.dp
    val navClearance = navBottom + NavHeight + 16.dp
    GradientBackground {
        Box(Modifier.fillMaxSize()) {
            AnimatedContent(
                targetState = tab,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    if (reduce) {
                        EnterTransition.None togetherWith ExitTransition.None
                    } else {
                        val dir = if (targetState > initialState) 1 else -1
                        val px = with(density) { 16.dp.roundToPx() }
                        (fadeIn(tween(250)) + slideInHorizontally(tween(250)) { dir * px }) togetherWith
                            fadeOut(tween(150))
                    }
                },
                label = "tabs",
            ) { t ->
                when (t) {
                    0 -> OverviewScreen(
                        vm, topInset, navClearance + 24.dp, Modifier.fillMaxSize(),
                        updateInfo = updateState.available, onUpdateClick = { showSheet = true },
                        agentUpdate = agentPhase, onAgentUpdate = agentUpdateVm::update, onAgentDismiss = agentUpdateVm::dismiss,
                        pcSection = { PcSection(pcVm) },
                    )
                    1 -> FilesScreen(filesVm, topInset, navClearance + 8.dp, Modifier.fillMaxSize())
                    2 -> DownloadsScreen(
                        downloadsVm, topInset, navClearance + 8.dp,
                        onOpenFiles = { path -> filesVm.openPath(path); tab = 1 },
                        modifier = Modifier.fillMaxSize(),
                    )
                    3 -> SitesScreen(
                        sitesVm, topInset, navClearance + 8.dp,
                        onOpenFiles = { path -> filesVm.openPath(path); tab = 1 },
                        modifier = Modifier.fillMaxSize(),
                    )
                    else -> VpsScreen(vpsVm, topInset, navClearance + 8.dp, Modifier.fillMaxSize())
                }
            }
            TopPill({ showSheet = true }, updateState.available != null, Modifier.align(Alignment.TopCenter).padding(top = statusTop))
            BottomNav(
                selected = tab,
                onSelect = { tab = it },
                reduce = reduce,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = navBottom).padding(16.dp),
            )
        }
    }
}

@Composable
private fun TopPill(onAbout: () -> Unit, updateAvailable: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .fillMaxWidth()
            .height(TopBarHeight - 16.dp)
            .clip(SamsungShapes.Pill)
            .background(SamsungColors.NavScrim)
            .background(SamsungColors.NavFill)
            .border(1.dp, SamsungColors.NavBorder, SamsungShapes.Pill)
            .padding(start = 12.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LogoTile(32.dp)
        Spacer(Modifier.size(10.dp))
        Text(
            "Samsung Server", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier
                .size(48.dp)
                .clip(SamsungShapes.Circle)
                .clickable(onClickLabel = "Open settings and updates", role = Role.Button, onClick = onAbout)
                .semantics {
                    contentDescription =
                        if (updateAvailable) "Settings and updates, update available" else "Settings and updates"
                },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(40.dp).clip(SamsungShapes.Circle).background(SamsungColors.LogoRed)
                    .border(1.dp, SamsungColors.GlassBorder, SamsungShapes.Circle),
                contentAlignment = Alignment.Center,
            ) {
                GlassIcon(SamsungIcons.Settings, null, Color.White, 22.dp)
            }
            if (updateAvailable) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp).size(12.dp)
                        .clip(SamsungShapes.Circle).background(SamsungColors.Amber)
                        .border(1.dp, SamsungColors.Ink, SamsungShapes.Circle),
                )
            }
        }
    }
}

/** Only the selected destination shows icon + label inside the red pill; others are 48dp icon buttons. */
@Composable
private fun BottomNav(selected: Int, onSelect: (Int) -> Unit, reduce: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(SamsungShapes.Pill)
            .background(SamsungColors.NavScrim)
            .background(SamsungColors.NavFill)
            .border(1.dp, SamsungColors.NavBorder, SamsungShapes.Pill)
            .padding(6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { i, t ->
            val active = i == selected
            val fill by animateColorAsState(
                if (active) SamsungColors.LogoRed else Color.Transparent,
                animationSpec = if (reduce) snap() else tween(200), label = "navFill",
            )
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .widthIn(min = 48.dp)
                    .clip(SamsungShapes.Pill)
                    .background(fill)
                    .clickable(onClickLabel = "Open ${t.label}", role = Role.Tab) { onSelect(i) }
                    .semantics {
                        this.selected = active
                        contentDescription = t.label
                    }
                    .animateContentSize(if (reduce) snap() else spring(dampingRatio = 0.8f, stiffness = 400f))
                    .padding(horizontal = if (active) 14.dp else 0.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GlassIcon(t.icon, null, Color.White, 24.dp)
                AnimatedVisibility(
                    visible = active,
                    enter = if (reduce) EnterTransition.None else fadeIn(tween(220)) + expandHorizontally(tween(220)),
                    exit = if (reduce) ExitTransition.None else fadeOut(tween(150)) + shrinkHorizontally(tween(150)),
                ) {
                    Text(
                        t.label, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, softWrap = false, modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
        }
    }
}
