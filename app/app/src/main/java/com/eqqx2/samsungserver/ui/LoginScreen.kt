package com.eqqx2.samsungserver.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val PICK_TYPES = arrayOf("application/json", "application/octet-stream", "text/plain", "*/*")

/** Red-glass outlined pill for secondary actions on a glass card (dark text on pink, 48dp min). */
@Composable
fun SecondaryPillButton(
    text: String,
    enabled: Boolean = true,
    description: String = text,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(SamsungShapes.Pill)
            .background(SamsungColors.ChipErrorFill.copy(alpha = if (enabled) 0.14f else 0.06f))
            .border(1.dp, SamsungColors.ChipErrorFill.copy(alpha = if (enabled) 0.7f else 0.3f), SamsungShapes.Pill)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description }
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
            color = if (enabled) SamsungColors.OnGlass else SamsungColors.OnGlassMuted,
        )
    }
}

@Composable
fun LoginScreen(
    initialUrl: String,
    notice: String?,
    noticeTick: Int,
    busy: Boolean,
    onConnect: (url: String, token: String) -> Unit,
    onImport: (Uri) -> Unit,
) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) onImport(uri)
    }
    var url by remember { mutableStateOf(initialUrl) }
    var token by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    val reduce = rememberReducedMotion()
    val density = LocalDensity.current.density
    val shake = remember { Animatable(0f) }
    // One shake (3 oscillations of 6dp, 300 ms) each time a notice is raised.
    LaunchedEffect(noticeTick) {
        if (noticeTick > 0 && !reduce) {
            shake.snapTo(0f)
            shake.animateTo(
                0f,
                keyframes {
                    durationMillis = 300
                    6f at 25; -6f at 75; 6f at 125; -6f at 175; 6f at 225; -6f at 275
                },
            )
        }
    }

    GradientBackground {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            GlassCard(Modifier.fillMaxWidth().appear()) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    LogoTile(56.dp)
                    Spacer(Modifier.height(12.dp))
                    Text("Samsung Server", color = SamsungColors.OnGlass, fontSize = 28.sp, fontWeight = FontWeight.Light)
                    Text("Sign in to your server agent", color = SamsungColors.OnGlassMuted, fontSize = 14.sp)
                    Spacer(Modifier.height(20.dp))

                    val colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = SamsungColors.OnGlass,
                        unfocusedTextColor = SamsungColors.OnGlass,
                        focusedBorderColor = SamsungColors.Ink,
                        unfocusedBorderColor = SamsungColors.OnGlassMuted,
                        focusedLabelColor = SamsungColors.Ink,
                        unfocusedLabelColor = SamsungColors.OnGlassMuted,
                        cursorColor = SamsungColors.Ink,
                    )
                    val textStyle = TextStyle(fontSize = 16.sp, fontFamily = FontFamily.Monospace)
                    OutlinedTextField(
                        value = url, onValueChange = { url = it },
                        label = { Text("Server URL") },
                        placeholder = { Text("https://api.example.com") },
                        singleLine = true, colors = colors, textStyle = textStyle,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = token, onValueChange = { token = it },
                        label = { Text("Access token") },
                        singleLine = true, colors = colors, textStyle = textStyle,
                        visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        trailingIcon = {
                            Box(
                                Modifier.size(48.dp).clickable(role = Role.Button) { show = !show },
                                contentAlignment = Alignment.Center,
                            ) {
                                GlassIcon(
                                    if (show) SamsungIcons.VisibilityOff else SamsungIcons.Visibility,
                                    if (show) "Hide token" else "Show token",
                                    SamsungColors.OnGlassMuted,
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (notice != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            notice, color = SamsungColors.OnGlassCritical, fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.fillMaxWidth().graphicsLayer { translationX = shake.value * density },
                        )
                    }
                    Spacer(Modifier.height(20.dp))
                    PrimaryPillButton(
                        text = if (busy) "Connecting..." else "Connect",
                        enabled = !busy && token.isNotBlank() && url.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { onConnect(url.trim(), token.trim()) }
                    Spacer(Modifier.height(12.dp))
                    SecondaryPillButton(
                        text = "Import token file",
                        enabled = !busy,
                        description = "Import token file from your device",
                        modifier = Modifier.fillMaxWidth(),
                    ) { picker.launch(PICK_TYPES) }
                }
            }
        }
    }
}
