package com.eqqx2.s21control.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/** Shown on Overview when the S21 agent has a newer release. Hidden otherwise. */
@Composable
fun AgentUpdateCard(
    phase: AgentUpdatePhase,
    reduce: Boolean,
    onUpdate: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (phase is AgentUpdatePhase.Hidden) return
    LaunchedEffect(phase) {
        if (phase is AgentUpdatePhase.Done) {
            delay(6_000)
            onDismiss()
        }
    }
    GlassCard(modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when (phase) {
                is AgentUpdatePhase.Available -> {
                    Text("Agent ${phase.latest} is ready", color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "The S21 runs ${phase.current}. It downloads the new agent from GitHub, checks it and restarts. This takes under a minute.",
                        color = S21Colors.OnGlassMuted, fontSize = 14.sp,
                    )
                    PrimaryPillButton("Update agent", modifier = Modifier.fillMaxWidth(), onClick = onUpdate)
                    DismissText("Not now", onDismiss)
                }
                is AgentUpdatePhase.Updating -> {
                    Text("Updating the agent to ${phase.to}", color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text("Keep the app open. Data on this screen pauses while the agent restarts.", color = S21Colors.OnGlassMuted, fontSize = 14.sp)
                    if (!reduce) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth().heightIn(max = 8.dp).clip(S21Shapes.Pill),
                            color = S21Colors.Ink, trackColor = Color(0x33000000),
                        )
                    }
                }
                is AgentUpdatePhase.Done -> {
                    Text("Agent updated to ${phase.version}", color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    DismissText("Done", onDismiss)
                }
                is AgentUpdatePhase.Error -> {
                    Text("Agent update didn't finish", color = S21Colors.OnGlass, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text(phase.message, color = S21Colors.OnGlassCritical, fontSize = 14.sp)
                    if (phase.retry != null) PrimaryPillButton("Try again", modifier = Modifier.fillMaxWidth(), onClick = onUpdate)
                    DismissText("Close", onDismiss)
                }
                AgentUpdatePhase.Hidden -> Unit
            }
        }
    }
}

@Composable
private fun DismissText(text: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = S21Colors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}
