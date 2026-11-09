package com.eqqx2.samsungserver.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Diagonal sheen: white 14% at top-left fading out by 60% of the diagonal. */
private val Sheen = Brush.linearGradient(
    0f to SamsungColors.StatSheen, 0.6f to Color.Transparent, 1f to Color.Transparent,
    start = Offset.Zero, end = Offset.Infinite,
)

/** Border: white 30% at the top fading to white 8% at the bottom. */
private val GlassEdge = Brush.verticalGradient(listOf(Color(0x4DFFFFFF), Color(0x14FFFFFF)))

private fun Modifier.statGlass(): Modifier = this
    .clip(SamsungShapes.Stat)
    .background(SamsungColors.StatScrim)
    .background(SamsungColors.StatFill)
    .background(Sheen)
    .border(1.dp, GlassEdge, SamsungShapes.Stat)

fun Tone.color(): Color = when (this) {
    Tone.Good -> SamsungColors.Emerald
    Tone.Warn -> SamsungColors.Amber
    Tone.Neutral -> SamsungColors.StatTitle
}

/**
 * Animated numeric text: counts up from 0 on the first load ([fromZero]) and tweens for 400 ms
 * between refreshes. Formatting runs each frame; with reduced motion it just snaps.
 */
@Composable
fun rememberCountUp(target: Double, fromZero: Boolean, format: (Double) -> String): String {
    val reduce = rememberReducedMotion()
    val anim = remember { Animatable(if (fromZero && !reduce) 0f else target.toFloat()) }
    LaunchedEffect(target, reduce) {
        if (reduce) anim.snapTo(target.toFloat()) else anim.animateTo(target.toFloat(), tween(400))
    }
    return format(anim.value.toDouble())
}

/**
 * Stat card, stacked: title + icon tile, one-line value (shrinks from 24sp to a 16sp floor),
 * then a full-width hint row with an optional trend arrow. Colour is never the only signal:
 * the hint text and arrow shape carry the meaning too.
 */
@Composable
fun StatsCard(
    title: String,
    value: String,
    hint: String?,
    icon: ImageVector,
    gradient: Brush,
    modifier: Modifier = Modifier,
    trend: Trend? = null,
    sizeBasis: String = value,
    onClick: (() -> Unit)? = null,
) {
    val reduce = rememberReducedMotion()
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val focused by source.collectIsFocusedAsState()
    var touching by remember { mutableStateOf(false) }
    val lifted = pressed || focused || touching
    val lift by animateFloatAsState(
        targetValue = if (lifted && !reduce) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "lift",
    )

    var m = modifier
        .graphicsLayer {
            translationY = -5.dp.toPx() * lift
            val s = 1f - 0.02f * lift
            scaleX = s
            scaleY = s
        }
        .statGlass()
    m = if (onClick != null) {
        m.heightIn(min = 48.dp).clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
    } else {
        m.focusable(interactionSource = source)
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    touching = true
                    tryAwaitRelease()
                    touching = false
                })
            }
    }

    Column(m.padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title, color = SamsungColors.StatTitle, fontSize = 14.sp, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.size(40.dp).clip(SamsungShapes.Tile).background(gradient),
                contentAlignment = Alignment.Center,
            ) {
                GlassIcon(icon, null, Color.White, 22.dp)
            }
        }
        Spacer(Modifier.height(4.dp))
        var widthPx by remember { mutableStateOf(0) }
        val density = LocalDensity.current.density
        Box(Modifier.fillMaxWidth().onSizeChanged { widthPx = it.width }) {
            // Monospace glyphs are ~0.62em wide, so size from the final text length: no re-measure loop.
            val fit = if (widthPx == 0) 24f else widthPx / density / (sizeBasis.length.coerceAtLeast(1) * 0.62f)
            Text(
                value, color = Color.White, fontSize = fit.coerceIn(16f, 24f).sp, fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
            )
        }
        if (hint != null) {
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Top) {
                val tint = trend?.tone?.color() ?: SamsungColors.StatTitle
                if (trend != null) {
                    TrendArrow(trend.dir, tint, reduce)
                    Spacer(Modifier.width(4.dp))
                }
                Text(hint, color = tint, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun TrendArrow(dir: Dir, tint: Color, reduce: Boolean) {
    val angle by animateFloatAsState(
        targetValue = if (dir == Dir.Down) 90f else 0f,
        animationSpec = if (reduce) snap() else tween(200),
        label = "arrow",
    )
    Box(Modifier.padding(top = 1.dp).size(16.dp)) {
        if (dir == Dir.Flat) {
            GlassIcon(SamsungIcons.Flat, null, tint, 16.dp)
        } else {
            GlassIcon(SamsungIcons.ArrowUpRight, null, tint, 16.dp, Modifier.rotate(angle))
        }
    }
}

/** Placeholder shaped like a stat card; alpha pulses 0.5 to 0.9 over 900 ms (static if reduced motion). */
@Composable
fun SkeletonCard(modifier: Modifier = Modifier) {
    val reduce = rememberReducedMotion()
    val alpha = if (reduce) 0.7f else {
        val t = rememberInfiniteTransition(label = "skeleton")
        val a by t.animateFloat(
            0.5f, 0.9f,
            infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse),
            label = "skeletonAlpha",
        )
        a
    }
    Column(
        modifier.graphicsLayer { this.alpha = alpha }.statGlass().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Bar(Modifier.width(72.dp).height(14.dp))
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(40.dp).clip(SamsungShapes.Tile).background(Color(0x26FFFFFF)))
        }
        Bar(Modifier.width(96.dp).height(24.dp))
        Bar(Modifier.fillMaxWidth(0.8f).height(13.dp))
    }
}

@Composable
private fun Bar(modifier: Modifier) {
    Box(modifier.clip(SamsungShapes.Pill).background(Color(0x33FFFFFF)))
}

/** Small status chip: dot plus text. The dot pulses (alpha 1 to 0.4, 1.2 s) only while [pulse]. */
@Composable
fun LiveChip(text: String, dot: Color, pulse: Boolean, modifier: Modifier = Modifier) {
    val reduce = rememberReducedMotion()
    val alpha = if (pulse && !reduce) {
        val t = rememberInfiniteTransition(label = "live")
        val a by t.animateFloat(
            1f, 0.4f,
            infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Reverse),
            label = "liveAlpha",
        )
        a
    } else 1f
    Row(
        modifier
            .clip(SamsungShapes.Pill)
            .background(SamsungColors.ChipDark)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).graphicsLayer { this.alpha = alpha }.clip(SamsungShapes.Circle).background(dot))
        Spacer(Modifier.width(8.dp))
        Text(text, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}
