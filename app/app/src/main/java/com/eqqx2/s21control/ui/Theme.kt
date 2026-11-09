package com.eqqx2.s21control.ui

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Design tokens: red glassmorphism admin look. */
object S21Colors {
    val BgTop = Color(0xFF7F1D1D)
    val BgMid = Color(0xFFB91C1C)
    val BgBottom = Color(0xFFDC2626)
    val GlowLight = Color(0x33FFFFFF)

    // Light "moderation-style" glass (list items, login card)
    val GlassFill = Color(0xD9F6D5D8)       // pink tint at 0.85 alpha
    val GlassSheen = Color(0x26FFFFFF)
    val GlassBorder = Color(0x40FFFFFF)     // white 25%
    val OnGlass = Color(0xFF1F1215)
    val OnGlassMuted = Color(0xFF6B4A4F)
    val OnGlassCritical = Color(0xFF991B1B)

    // Dark glass for stat cards: black 25% scrim + white 10%
    val StatScrim = Color(0x66000000)       // black 40% (35% fell under 4.5:1 for emerald)
    val StatFill = Color(0x1FFFFFFF)        // white 12%
    val StatBorder = Color(0x33FFFFFF)      // white 20%
    val StatSheen = Color(0x24FFFFFF)       // white 14% diagonal sheen
    val StatTitle = Color(0x99FFFFFF)       // white 60%
    val Emerald = Color(0xFF34D399)
    val Amber = Color(0xFFFBBF24)

    val BarFill = Color(0x2EFFFFFF)         // white 18%
    val PillSecondary = Color(0x33FFFFFF)   // white 20%
    val NavScrim = Color(0x59000000)        // black 35%
    val NavFill = Color(0x24FFFFFF)         // white 14%
    val NavBorder = Color(0x40FFFFFF)       // white 25%
    val Ink = Color(0xFF1A1013)
    val OnCrimson = Color.White
    val OnCrimsonMuted = Color(0xB3FFFFFF)  // white 70%
    val LogoRed = Color(0xFFEF4444)

    val ChipDark = Color(0xCC1A1013)
    val ChipErrorText = Color(0xFFFEE2E2)
    val ChipErrorFill = Color(0xFFB91C1C)
}

object S21Shapes {
    val Card = RoundedCornerShape(28.dp)
    val Stat = RoundedCornerShape(24.dp)
    val Tile = RoundedCornerShape(12.dp)
    val Pill = RoundedCornerShape(percent = 50)
    val Circle = CircleShape
    val Logo = RoundedCornerShape(10.dp)
}

private val scheme = darkColorScheme(
    primary = S21Colors.Ink,
    onPrimary = Color.White,
    background = S21Colors.BgTop,
    onBackground = Color.White,
    surface = S21Colors.BgMid,
    onSurface = Color.White,
    error = S21Colors.ChipErrorText,
)

@Composable
fun S21Theme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

@Composable
fun rememberReducedMotion(): Boolean {
    val ctx: Context = LocalContext.current
    return remember {
        Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

@Composable
fun GradientBackground(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(S21Colors.BgTop, S21Colors.BgMid, S21Colors.BgBottom)))
            .background(
                Brush.radialGradient(
                    colors = listOf(S21Colors.GlowLight, Color.Transparent),
                    center = Offset(150f, 150f),
                    radius = 900f,
                )
            )
    ) { content() }
}

/** Light frosted panel faked with translucent fill, sheen and hairline border (no blur). */
@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .shadow(
                12.dp, S21Shapes.Card, clip = false,
                ambientColor = Color(0x66000000), spotColor = Color(0x66000000),
            )
            .clip(S21Shapes.Card)
            .background(S21Colors.GlassFill)
            .background(Brush.verticalGradient(listOf(S21Colors.GlassSheen, Color.Transparent)))
            .border(1.dp, S21Colors.GlassBorder, S21Shapes.Card)
    ) { content() }
}

@Composable
fun PrimaryPillButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(S21Shapes.Pill)
            .background(if (enabled) S21Colors.Ink else S21Colors.Ink.copy(alpha = 0.5f))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun StatusChip(text: String, textColor: Color, fill: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(S21Shapes.Pill)
            .background(fill)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Text(text, color = textColor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun LogoTile(size: Dp = 32.dp) {
    Box(
        Modifier
            .size(size)
            .clip(S21Shapes.Logo)
            .background(S21Colors.LogoRed)
            .border(1.dp, S21Colors.GlassBorder, S21Shapes.Logo),
        contentAlignment = Alignment.Center,
    ) {
        Text("S", color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.5f).sp)
    }
}

/**
 * Entrance: 350 ms fade and 24dp slide up, 60 ms stagger per item. Skipped when [enabled] is
 * false (already shown once) or when animations are off. Uses graphicsLayer only.
 */
@Composable
fun Modifier.appear(index: Int = 0, enabled: Boolean = true): Modifier {
    val reduce = rememberReducedMotion()
    val play = enabled && !reduce
    val a = remember { Animatable(if (play) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (play) a.animateTo(
            1f, tween(durationMillis = 350, delayMillis = (index * 60).coerceAtMost(480), easing = FastOutSlowInEasing),
        )
    }
    return this.graphicsLayer {
        alpha = a.value
        translationY = (1f - a.value) * 24.dp.toPx()
    }
}

@Composable
fun GlassIcon(vector: ImageVector, description: String?, tint: Color, size: Dp = 24.dp, modifier: Modifier = Modifier) {
    Icon(vector, contentDescription = description, tint = tint, modifier = modifier.size(size))
}

private fun icon(name: String, data: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString(data).toNodes(), fill = SolidColor(Color.Black))
    }.build()

object S21Icons {
    val Settings = icon("settings", "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z")
    val ArrowUpRight = icon("up_right", "M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5z")
    val Visibility = icon("vis", "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z")
    val VisibilityOff = icon("vis_off", "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z")
    val Logout = icon("logout", "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z")
    val Overview = icon("overview", "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z")
    val Files = icon("files", "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z")
    val FileDoc = icon("file_doc", "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z")
    val MoreVert = icon("more_vert", "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z")
    val Downloads = icon("downloads", "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z")
    val Sites = icon("sites", "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z")
    val Vps = icon("vps", "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z")
    val Cpu = icon("cpu", "M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z")
    val Memory = icon("memory", "M15 9H9v6h6V9zm-2 4h-2v-2h2v2zM3 3v18h18V3H3zm16 16H5V5h14v14z")
    val Battery = icon("battery", "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z")
    val Flat = icon("flat", "M5 11h14v2H5z")
    val Clock = icon("clock", "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z")
}
