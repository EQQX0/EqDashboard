package com.eqqx2.samsungserver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class StatusTest {
    private val real = """{"time":"2026-11-09T14:45:33.736Z","uptimeSec":315205,"load":[3.36,3.81,3.82],"cpuCores":0,"memory":{"totalBytes":7571623936,"freeBytes":2971799552},"storage":{"totalKb":6109176,"usedKb":6106336,"freeKb":2840},"battery":null}"""

    @Test
    fun parsesFullResponse() {
        val s = parseStatus(real)
        assertEquals("2026-11-09T14:45:33.736Z", s.time)
        assertEquals(315205L, s.uptimeSec)
        assertEquals(listOf(3.36, 3.81, 3.82), s.load)
        assertEquals(0, s.cpuCores)
        assertEquals(7571623936L, s.memory.totalBytes)
        assertEquals(2971799552L, s.memory.freeBytes)
        assertEquals(2840L, s.storage?.freeKb)
        assertNull(s.battery)
    }

    @Test
    fun parsesBatteryObject() {
        val json = real.replace(
            "\"battery\":null",
            "\"battery\":{\"percentage\":87,\"temperature\":31.5,\"status\":\"CHARGING\",\"plugged\":\"PLUGGED_AC\"}"
        )
        val b = parseStatus(json).battery
        assertNotNull(b)
        assertEquals(87, b!!.percentage)
        assertEquals(31.5, b.temperature, 0.0)
        assertEquals("CHARGING", b.status)
        assertEquals("PLUGGED_AC", b.plugged)
    }

    @Test
    fun ignoresUnknownKeys() {
        val s = parseStatus(real.replace("{\"time\"", "{\"extra\":{\"a\":1},\"time\""))
        assertEquals(315205L, s.uptimeSec)
    }
}
