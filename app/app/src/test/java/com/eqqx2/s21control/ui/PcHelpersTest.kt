package com.eqqx2.s21control.ui

import com.eqqx2.s21control.data.PcItem
import com.eqqx2.s21control.data.PcResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PcHelpersTest {
    private fun pc(online: Boolean, user: String = "me") = PcItem(id = "id", name = "Desktop", mac = "aa:bb:cc:dd:ee:ff", ip = "192.168.1.20", sshUser = user, sshPort = 22, online = online)

    @Test fun chipTextFollowsStateAndPendingTransitions() {
        assertEquals("Off", pcChipText(pc(false), null, 0))
        assertEquals("On", pcChipText(pc(true), null, 0))
        assertEquals("Starting", pcChipText(pc(false), PcTransition(true, 1_000), 500))
        assertEquals("Off", pcChipText(pc(false), PcTransition(true, 1_000), 1_500)) // gave up waiting
        assertEquals("On", pcChipText(pc(true), PcTransition(true, 1_000), 500)) // already up
        assertEquals("Shutting down", pcChipText(pc(true), PcTransition(false, 1_000), 500))
        assertEquals("Off", pcChipText(pc(false), PcTransition(false, 1_000), 500))
    }

    @Test fun buttonsFollowState() {
        assertTrue(canWake(pc(false), null, 0))
        assertFalse(canWake(pc(true), null, 0))
        assertFalse(canWake(pc(false), PcTransition(true, 1_000), 500))
        assertTrue(canShutdown(pc(true), null, 0))
        assertFalse(canShutdown(pc(false), null, 0))
        assertFalse(canShutdown(pc(true), PcTransition(false, 1_000), 500))
    }

    @Test fun macInput() {
        assertEquals("aa:bb:cc:dd:ee:ff", normalizeMacInput("AA-BB-CC-DD-EE-FF"))
        assertEquals("aa:bb:cc:dd:ee:ff", normalizeMacInput(" aabb.ccdd.eeff "))
        assertNull(normalizeMacInput("aa:bb:cc:dd:ee"))
        assertNull(normalizeMacInput("zz:bb:cc:dd:ee:ff"))
        assertNull(macInputError(""))
        assertNull(macInputError("AA:BB:CC:DD:EE:FF"))
        assertNotNull(macInputError("hello"))
    }

    @Test fun ipInputOnlyAcceptsHomeNetworkAddresses() {
        for (ok in listOf("", "192.168.1.20", "10.0.0.5", "172.16.0.1", "172.31.9.9")) assertNull(ok, ipInputError(ok))
        for (bad in listOf("8.8.8.8", "127.0.0.1", "172.32.0.1", "192.168.1", "192.168.1.300", "pc.local", "192.168.1.2.3")) assertNotNull(bad, ipInputError(bad))
    }

    @Test fun lightsLinkMustPointAtThePcWithAToken() {
        val ip = "192.168.0.174"
        assertNull(lightsLinkError("", ip))
        assertNull(lightsLinkError("   ", ip))
        assertNull(lightsLinkError("http://$ip:47822/?t=abcdef123456", ip))
        assertNull(lightsLinkError("  http://$ip:47822/?t=abcdef123456  ", ip))
        assertNull(lightsLinkError("http://$ip/?x=1&t=abcdef123456", ip))
        for (bad in listOf(
            "hello", "https://$ip:47822/?t=abcdef123456", "http://10.0.0.5:47822/?t=abcdef123456",
            "http://$ip:47822/", "http://$ip:47822/?t=short", "rgbcontrol://pair?host=$ip&t=abcdef123456",
            "http://$ip:47822/?t=" + "x".repeat(500),
        )) assertNotNull(bad, lightsLinkError(bad, ip))
    }

    @Test fun popupStaysInsideItsOwnRelaySession() {
        val sid = "0123456789abcdef0123456789abcdef"
        val start = "https://api.eqqx2.com/pc/lights/r/$sid/"
        assertTrue(lightsRequestAllowed(start, start))
        assertTrue(lightsRequestAllowed(start, "https://api.eqqx2.com/pc/lights/r/$sid/api/poll"))
        assertTrue(lightsRequestAllowed(start, "https://API.eqqx2.com:443/pc/lights/r/$sid/profiles/a.jpg?v=1"))
        assertFalse(lightsRequestAllowed(start, "https://api.eqqx2.com/status"))
        assertFalse(lightsRequestAllowed(start, "https://api.eqqx2.com/pc/lights/r/${sid.replace('0', '1')}/"))
        assertFalse(lightsRequestAllowed(start, "https://api.eqqx2.com/pc/lights/r/$sid/../../status"))
        assertFalse(lightsRequestAllowed(start, "https://api.eqqx2.com/pc/lights/r/$sid/%2e%2e/status"))
        assertFalse(lightsRequestAllowed(start, "https://api.eqqx2.com:8443/pc/lights/r/$sid/"))
        assertFalse(lightsRequestAllowed(start, "http://api.eqqx2.com/pc/lights/r/$sid/"))
        assertFalse(lightsRequestAllowed(start, "https://evil.example.com/pc/lights/r/$sid/"))
        assertFalse(lightsRequestAllowed(start, "intent://scan/#Intent;end"))
        assertFalse(lightsRequestAllowed(start, "file:///data/data/x"))
        assertFalse(lightsRequestAllowed(start, "not a url"))
        assertFalse(lightsRequestAllowed("https://api.eqqx2.com/status/", "https://api.eqqx2.com/status/x"))
        assertFalse(lightsRequestAllowed("garbage", "https://api.eqqx2.com/pc/lights/r/$sid/"))
    }

    @Test fun lightsErrorTexts() {
        assertTrue(pcErrorText(PcResult.BadLink).contains("EqRGB"))
        assertTrue(pcErrorText(PcResult.NoLights).contains("No lights link"))
    }

    @Test fun userInput() {
        assertNull(userInputError(""))
        assertNull(userInputError("Admin_1.x-y"))
        assertNotNull(userInputError("bad user"))
        assertNotNull(userInputError("a;b"))
    }

    @Test fun setupCommandLocksTheKeyToShutdownAndKeepsExistingKeys() {
        val key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKEKEY s21-agent"
        val cmd = pcSetupCommand("  $key \n")
        assertTrue(cmd.contains("command=\"shutdown /s /t 5\""))
        assertTrue(cmd.contains("no-pty,no-port-forwarding"))
        assertTrue(cmd.endsWith("\"SYSTEM:F\""))
        assertTrue(cmd.contains("$key'"))
        assertTrue("appends, never overwrites", cmd.contains("Add-Content") && !cmd.contains("Set-Content"))
        assertTrue(cmd.contains("administrators_authorized_keys"))
        assertTrue(cmd.contains("Start-Service sshd"))
    }

    @Test fun errorTextsSayWhatToDo() {
        assertTrue(pcErrorText(PcResult.NoSshUser).contains("Set up shutdown"))
        assertTrue(pcErrorText(PcResult.AuthFailed).contains("setup command"))
        assertTrue(pcErrorText(PcResult.SshMissing).contains("pkg install openssh"))
        assertEquals("You already have the most PCs allowed (8)", pcErrorText(PcResult.TooMany(8)))
        assertEquals("boom", pcErrorText(PcResult.Failure("boom")))
    }
}
