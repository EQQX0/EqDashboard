package com.eqqx2.s21control.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {
    @Test fun bytesZero() = assertEquals("0 B", formatBytes(0))
    @Test fun bytesGb() = assertEquals("1.9 GB", formatBytes(2_040_000_000))
    @Test fun bytesMemory() = assertEquals("2.8 GB", formatBytes(2971799552))
    @Test fun bytesKb() = assertEquals("1.0 KB", formatBytes(1024))
    @Test fun uptimeDaysHours() = assertEquals("3d 15h", formatUptime(315205))
    @Test fun uptimeHoursMinutes() = assertEquals("2h 5m", formatUptime(7500))
    @Test fun uptimeMinutes() = assertEquals("4m", formatUptime(240))
    @Test fun ageSeconds() = assertEquals("12 s ago", formatAge(12_000))
    @Test fun ageMinutes() = assertEquals("3 min ago", formatAge(190_000))
    @Test fun ageNegativeClamped() = assertEquals("0 s ago", formatAge(-5))
}
