package com.eqqx2.samsungserver.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeltaTest {
    @Test fun percentChangeIncrease() = assertEquals(3.2, percentChange(103.2, 100.0)!!, 1e-9)
    @Test fun percentChangeDecrease() = assertEquals(-10.0, percentChange(90.0, 100.0)!!, 1e-9)
    @Test fun nullPrevious() = assertNull(percentChange(1.0, null))
    @Test fun zeroPrevious() = assertNull(percentChange(1.0, 0.0))

    @Test fun dirThreshold() {
        assertEquals(Dir.Flat, dirOf(0.0))
        assertEquals(Dir.Flat, dirOf(0.49))
        assertEquals(Dir.Up, dirOf(0.5))
        assertEquals(Dir.Down, dirOf(-3.0))
        assertEquals(Dir.Flat, dirOf(null))
    }

    @Test fun cpuDownIsGoodUpIsAmberFlatIsNeutral() {
        assertEquals(Trend(Dir.Down, Tone.Good), cpuTrend(-10.0))
        assertEquals(Trend(Dir.Up, Tone.Warn), cpuTrend(10.0))
        assertEquals(Trend(Dir.Flat, Tone.Neutral), cpuTrend(0.0))
    }

    @Test fun cpuHints() {
        assertEquals("+3.2% vs 5 min avg", cpuHint(3.2, "5 min avg", "x"))
        assertEquals("-10.0% vs 5 min avg", cpuHint(-10.0, "5 min avg", "x"))
        assertEquals("Steady vs 5 min avg", cpuHint(0.0, "5 min avg", "x"))
        assertEquals("x", cpuHint(null, "5 min avg", "x"))
    }

    @Test fun memoryHintsAndTone() {
        assertEquals("Steady", memoryHint(0.2, "f"))
        assertEquals("+1.2% since last update", memoryHint(1.2, "f"))
        assertEquals("f", memoryHint(null, "f"))
        assertEquals(Tone.Neutral, memoryTrend(5.0, 60.0).tone)
        assertEquals(Tone.Warn, memoryTrend(5.0, 90.0).tone)
    }

    @Test fun storageAndBatteryTone() {
        assertEquals(Tone.Neutral, storageTrend(50.0).tone)
        assertEquals(Tone.Warn, storageTrend(91.0).tone)
        assertEquals(Trend(Dir.Up, Tone.Good), batteryTrend(50, true))
        assertEquals(Trend(Dir.Down, Tone.Warn), batteryTrend(15, false))
        assertEquals(Trend(Dir.Down, Tone.Neutral), batteryTrend(60, false))
    }
}
