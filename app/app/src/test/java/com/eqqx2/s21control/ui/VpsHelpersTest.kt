package com.eqqx2.s21control.ui

import com.eqqx2.s21control.data.VpsResult
import com.eqqx2.s21control.data.VpsSlice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VpsHelpersTest {
    private fun slice(status: String = "running", auth: String = "password", step: String? = null, error: String? = null) =
        VpsSlice(id = "web", name = "web", distro = "debian", distroLabel = "Debian", port = 2201, authMode = auth, status = status, step = step, error = error)

    @Test fun chipTextHasWordsForEveryStatus() {
        assertEquals("Running", vpsChipText("running"))
        assertEquals("Stopped", vpsChipText("stopped"))
        assertEquals("Setting up", vpsChipText("creating"))
        assertEquals("Failed", vpsChipText("error"))
        assertEquals("Unknown", vpsChipText("odd"))
    }

    @Test fun nameRulesMatchTheAgent() {
        for (ok in listOf("", "a", "web-1", "a".repeat(23))) assertNull(ok, vpsNameError(ok))
        for (bad in listOf("1a", "Web", "a_b", "-a", "a-", "a b", "a".repeat(24))) assertNotNull(bad, vpsNameError(bad))
        assertEquals("Start with a lowercase letter", vpsNameError("9lives"))
        assertEquals("Use 23 characters or fewer", vpsNameError("a".repeat(30)))
    }

    @Test fun keyMustBeOnePublicKeyLineOrBlank() {
        val good = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@pc"
        assertNull(vpsKeyError(""))
        assertNull(vpsKeyError("   "))
        assertNull(vpsKeyError(good))
        assertNull(vpsKeyError("  $good\n"))
        assertNotNull(vpsKeyError("hello"))
        assertNotNull(vpsKeyError("$good\n$good"))
        assertNotNull(vpsKeyError("-----BEGIN OPENSSH PRIVATE KEY-----"))
    }

    @Test fun sshCommandUsesThePortAndFallsBackWhenHostUnknown() {
        assertEquals("ssh -p 2201 root@192.168.1.20", sshCommand(slice(), "192.168.1.20"))
        assertEquals("ssh -p 2201 root@<phone-ip>", sshCommand(slice(), null))
    }

    @Test fun detailTextPerState() {
        assertEquals("Downloading Debian. A first download can take a few minutes.", vpsDetail(slice("creating", step = "Downloading Debian")))
        assertEquals("Starting. A first download can take a few minutes.", vpsDetail(slice("creating")))
        assertEquals("Password login", vpsDetail(slice("running")))
        assertEquals("Key login only", vpsDetail(slice("running", auth = "key")))
        assertEquals("Not running", vpsDetail(slice("stopped")))
        assertEquals("SSH stopped unexpectedly", vpsDetail(slice("stopped", error = "SSH stopped unexpectedly")))
        assertEquals("Setup failed", vpsDetail(slice("error")))
        assertEquals("No space", vpsDetail(slice("error", error = "No space")))
    }

    @Test fun actionsFollowState() {
        assertTrue(canStartSlice(slice("stopped")))
        assertFalse(canStartSlice(slice("running")))
        assertFalse(canStartSlice(slice("creating")))
        assertFalse(canStartSlice(slice("error")))
        assertTrue(canStopSlice(slice("running")))
        assertFalse(canStopSlice(slice("stopped")))
        assertTrue(hasWorkingSlices(listOf(slice("running"), slice("creating"))))
        assertFalse(hasWorkingSlices(listOf(slice("running"), slice("error"))))
    }

    @Test fun errorTextsAreFriendly() {
        assertEquals("Token rejected", vpsErrorText(VpsResult.Unauthorized))
        assertEquals("You already have the most slices allowed (4)", vpsErrorText(VpsResult.TooMany(4)))
        assertEquals("You already have the most slices allowed", vpsErrorText(VpsResult.TooMany(null)))
        assertTrue(vpsErrorText(VpsResult.EngineMissing).contains("pkg install proot-distro"))
        assertTrue(vpsErrorText(VpsResult.LowSpace(1024)).contains("1.0 KB") || vpsErrorText(VpsResult.LowSpace(1024)).contains("left"))
        assertEquals("Server returned HTTP 500", vpsErrorText(VpsResult.Failure("Server returned HTTP 500")))
    }
}
