package com.eqqx2.s21control.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class BatteryHintTest {
    @Test fun dischargingShowsStateAndTemperature() =
        assertEquals("Discharging 23.0°C", batteryHint(false, 23.0))

    @Test fun chargingShowsStateAndTemperature() =
        assertEquals("Charging 31.5°C", batteryHint(true, 31.5))

    @Test fun unitIsNeverSeparatedFromTheNumber() {
        // The only space is between the state and the temperature, so the unit cannot wrap alone.
        assertFalse(batteryHint(false, 40.25).substringAfter(' ').contains(' '))
        assertEquals("Charging 31.2°C".count { it == ' ' }, batteryHint(true, 31.2).count { it == ' ' })
    }

    @Test fun usesDotDecimalRegardlessOfLocale() {
        val old = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("Charging 31.5°C", batteryHint(true, 31.5))
        } finally {
            java.util.Locale.setDefault(old)
        }
    }
}
