package com.eqqx2.s21control.ui

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shown after a successful token-file import. [message] replaces the default text when delete failed. */
@Composable
fun ImportedCard(message: String?, onDelete: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    GlassCard(modifier.fillMaxWidth().appear()) {
        Column(Modifier.padding(16.dp)) {
            Text(
                message ?: "Imported. You can delete the token file now.",
                color = if (message == null) S21Colors.OnGlass else S21Colors.OnGlassCritical,
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (message == null) {
                    PrimaryPillButton("Delete file", onClick = onDelete)
                }
                SecondaryPillButton("Dismiss", description = "Dismiss import message", onClick = onDismiss)
            }
        }
    }
}
