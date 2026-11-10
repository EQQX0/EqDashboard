package com.eqqx2.samsungserver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Non-blocking offer to sign in with a pairing file found in Downloads. Never connects by itself. */
@Composable
fun FoundPairCard(host: String, onUse: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    GlassCard(modifier.fillMaxWidth().appear()) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "Pairing file found in Downloads",
                color = SamsungColors.OnGlass, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                host,
                color = SamsungColors.OnGlassMuted, fontSize = 14.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.semantics { contentDescription = "Server $host" },
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryPillButton("Use it", onClick = onUse)
                SecondaryPillButton("Not now", description = "Dismiss pairing file offer", onClick = onDismiss)
            }
        }
    }
}
