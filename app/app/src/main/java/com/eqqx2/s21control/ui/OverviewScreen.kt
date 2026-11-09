package com.eqqx2.s21control.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.eqqx2.s21control.data.Status
import com.eqqx2.s21control.data.UpdateInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import java.util.Locale

private val RedOrange = Brush.linearGradient(listOf(Color(0xFFEF4444), Color(0xFFF97316)))
private val VioletBlue = Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF3B82F6)))
private val EmeraldTeal = Brush.linearGradient(listOf(Color(0xFF10B981), Color(0xFF14B8A6)))
private val AmberOrange = Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFEA580C)))
private val BlueCyan = Brush.linearGradient(listOf(Color(0xFF3B82F6), Color(0xFF06B6D4)))

@Composable
fun OverviewScreen(
    vm: StatusViewModel,
    topInset: Dp,
    bottomInset: Dp,
    modifier: Modifier = Modifier,
    updateInfo: UpdateInfo? = null,
    onUpdateClick: () -> Unit = {},
    agentUpdate: AgentUpdatePhase = AgentUpdatePhase.Hidden,
    onAgentUpdate: () -> Unit = {},
    onAgentDismiss: () -> Unit = {},
    pcSection: @Composable () -> Unit = {},
) {
    val state by vm.state.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Poll only while the screen is at least STARTED; rotation keeps the same VM loop.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            vm.startPolling()
            try {
                awaitCancellation()
            } catch (e: CancellationException) {
                vm.stopPolling()
                throw e
            }
        }
    }

    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
        }
    }

    val status = state.status
    // Captured once per composition of this screen: the intro plays only the first time data shows.
    val intro = remember { !vm.introPlayed }
    LaunchedEffect(status != null) {
        if (status != null) {
            delay(1500)
            vm.introPlayed = true
        }
    }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = topInset, bottom = bottomInset),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (updateInfo != null) UpdateBanner(updateInfo, onUpdateClick)
        AgentUpdateCard(agentUpdate, rememberReducedMotion(), onAgentUpdate, onAgentDismiss)
        Column(Modifier.appear(0, intro).padding(bottom = 4.dp)) {
            Text("Overview", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Light)
            Text("Live status of your S21 server", color = S21Colors.OnCrimsonMuted, fontSize = 14.sp)
            val age = state.lastOkMs?.let { formatAge(now - it) }
            val chipMod = Modifier.padding(top = 12.dp)
            when {
                status == null && state.error == null -> LiveChip("Connecting", Color.White, false, chipMod)
                state.stale -> LiveChip("Stale • updated ${age ?: "never"}", S21Colors.Amber, false, chipMod)
                else -> LiveChip("Live • updated ${age ?: "just now"}", S21Colors.Emerald, true, chipMod)
            }
            if (state.error != null) {
                StatusChip(state.error!!, S21Colors.ChipErrorText, S21Colors.ChipErrorFill, Modifier.padding(top = 8.dp))
            }
        }
        if (status != null) {
            StatCards(status, state.previous, intro)
        } else if (state.error == null) {
            SkeletonCard(Modifier.fillMaxWidth())
            repeat(2) {
                Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SkeletonCard(Modifier.weight(1f).fillMaxHeight())
                    SkeletonCard(Modifier.weight(1f).fillMaxHeight())
                }
            }
        }
        pcSection()
    }
}

@Composable
private fun StatCards(s: Status, prev: Status?, intro: Boolean) {
    // CPU (full width)
    val load = s.load.getOrNull(0) ?: 0.0
    val load5 = s.load.getOrNull(1)
    val cpuPct = percentChange(load, load5)
    val cpuFmt = { v: Double -> String.format(Locale.US, "%.2f", v) }
    StatsCard(
        "CPU load", rememberCountUp(load, intro, cpuFmt),
        cpuHint(cpuPct, "5 min avg", "5 min avg n/a"),
        S21Icons.Cpu, RedOrange, Modifier.fillMaxWidth().appear(1, intro),
        trend = cpuTrend(cpuPct), sizeBasis = cpuFmt(load),
    )

    // Memory + Storage
    Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val used = (s.memory.totalBytes - s.memory.freeBytes).toDouble()
        val pct = used / s.memory.totalBytes * 100
        val prevPct = prev?.memory?.let { (it.totalBytes - it.freeBytes).toDouble() / it.totalBytes * 100 }
        val delta = percentChange(pct, prevPct)
        val memFmt = { v: Double -> formatBytes(v.toLong()) }
        StatsCard(
            "Memory", rememberCountUp(used, intro, memFmt),
            memoryHint(delta, String.format(Locale.US, "%.0f%% of %s", pct, formatBytes(s.memory.totalBytes))),
            S21Icons.Memory, VioletBlue, Modifier.weight(1f).fillMaxHeight().appear(2, intro),
            trend = memoryTrend(delta, pct), sizeBasis = memFmt(used),
        )
        val st = s.storage
        if (st == null) {
            StatsCard(
                "Storage", "n/a", "Not reported", S21Icons.Files, EmeraldTeal,
                Modifier.weight(1f).fillMaxHeight().appear(3, intro),
            )
        } else {
            val usedPct = st.usedKb.toDouble() / st.totalKb * 100
            val free = (st.freeKb * 1024).toDouble()
            StatsCard(
                "Storage", rememberCountUp(free, intro, memFmt),
                String.format(Locale.US, "%.1f%% used", usedPct),
                S21Icons.Files, EmeraldTeal, Modifier.weight(1f).fillMaxHeight().appear(3, intro),
                trend = storageTrend(usedPct), sizeBasis = memFmt(free),
            )
        }
    }

    // Battery + Uptime
    Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val b = s.battery
        if (b == null) {
            StatsCard(
                "Battery", "n/a", "Install Termux:API", S21Icons.Battery, AmberOrange,
                Modifier.weight(1f).fillMaxHeight().appear(4, intro),
            )
        } else {
            val charging = b.status.equals("CHARGING", true) || b.status.equals("FULL", true)
            val pctFmt = { v: Double -> "${v.toInt()}%" }
            StatsCard(
                "Battery", rememberCountUp(b.percentage.toDouble(), intro, pctFmt),
                batteryHint(charging, b.temperature),
                S21Icons.Battery, AmberOrange, Modifier.weight(1f).fillMaxHeight().appear(4, intro),
                trend = batteryTrend(b.percentage, charging), sizeBasis = pctFmt(b.percentage.toDouble()),
            )
        }
        StatsCard(
            "Uptime", rememberCountUp(s.uptimeSec.toDouble(), intro) { formatUptime(it.toLong()) },
            "Since last restart", S21Icons.Clock, BlueCyan,
            Modifier.weight(1f).fillMaxHeight().appear(5, intro),
            sizeBasis = formatUptime(s.uptimeSec),
        )
    }
}
