package com.eqqx2.s21control.ui

import java.util.Locale
import kotlin.math.abs

enum class Dir { Up, Down, Flat }

/** Meaning of a change, independent of its direction: Good = emerald, Warn = amber, Neutral = grey. */
enum class Tone { Good, Warn, Neutral }

data class Trend(val dir: Dir, val tone: Tone)

/** Changes smaller than this (in percent) are treated as flat. */
const val FLAT_PCT = 0.5

/** Signed percent change, or null when there is no usable baseline. */
fun percentChange(current: Double, previous: Double?): Double? {
    if (previous == null || previous == 0.0) return null
    return (current - previous) / previous * 100.0
}

fun dirOf(pct: Double?): Dir = when {
    pct == null || abs(pct) < FLAT_PCT -> Dir.Flat
    pct > 0 -> Dir.Up
    else -> Dir.Down
}

private fun signed(pct: Double) = String.format(Locale.US, "%s%.1f%%", if (pct >= 0) "+" else "-", abs(pct))

/** CPU load: lower is better, higher is amber. */
fun cpuTrend(pct: Double?): Trend = when (dirOf(pct)) {
    Dir.Down -> Trend(Dir.Down, Tone.Good)
    Dir.Up -> Trend(Dir.Up, Tone.Warn)
    Dir.Flat -> Trend(Dir.Flat, Tone.Neutral)
}

fun cpuHint(pct: Double?, label: String, fallback: String): String = when {
    pct == null -> fallback
    dirOf(pct) == Dir.Flat -> "Steady vs $label"
    else -> "${signed(pct)} vs $label"
}

/** Memory: neutral unless more than 85% is used. */
fun memoryTrend(pct: Double?, usedPercent: Double): Trend =
    Trend(dirOf(pct), if (usedPercent > 85.0) Tone.Warn else Tone.Neutral)

fun memoryHint(pct: Double?, fallback: String): String = when {
    pct == null -> fallback
    dirOf(pct) == Dir.Flat -> "Steady"
    else -> "${signed(pct)} since last update"
}

/** Storage: neutral until more than 90% is used. */
fun storageTrend(usedPercent: Double): Trend =
    Trend(Dir.Flat, if (usedPercent > 90.0) Tone.Warn else Tone.Neutral)

/** Battery: charging is good, discharging below 20% is amber, otherwise neutral. */
fun batteryTrend(percentage: Int, charging: Boolean): Trend = when {
    charging -> Trend(Dir.Up, Tone.Good)
    percentage < 20 -> Trend(Dir.Down, Tone.Warn)
    else -> Trend(Dir.Down, Tone.Neutral)
}
