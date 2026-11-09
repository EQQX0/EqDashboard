package com.eqqx2.s21control.ui

import com.eqqx2.s21control.data.TunnelListing
import com.eqqx2.s21control.data.TunnelRoute
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelRoutesTest {
    private val gym = TunnelRoute("gym.eqqx2.com", "http://localhost:8080", 8080, "app", true)
    private val down = TunnelRoute("downloader.eqqx2.com", "http://127.0.0.1:8081", 8081, "app", false)
    private val api = TunnelRoute("api.eqqx2.com", "http://127.0.0.1:8787", 8787, "agent", true)
    private val wild = TunnelRoute("*.eqqx2.com", "http://127.0.0.1:8790", 8790, "sites", true)

    @Test fun externalRoutesHideAgentAndSitesWildcard() {
        val l = TunnelListing(found = true, routes = listOf(gym, api, wild, down))
        assertEquals(listOf(gym, down), externalRoutes(l))
    }

    @Test fun externalRoutesHideAnyWildcardHostname() {
        val other = TunnelRoute("*.other.com", "http://127.0.0.1:9000", 9000, "app", true)
        assertEquals(emptyList<TunnelRoute>(), externalRoutes(TunnelListing(true, null, listOf(other))))
    }

    @Test fun chipTextHasWordsForEveryState() {
        assertEquals("Running", tunnelChipText(true))
        assertEquals("Not running", tunnelChipText(false))
        assertEquals("Not checked", tunnelChipText(null))
    }

    @Test fun metaShowsPortOrService() {
        assertEquals("Local port 8080", tunnelMeta(gym))
        assertEquals("ssh://example.com", tunnelMeta(TunnelRoute("ssh.test", "ssh://example.com", null, "app", null)))
    }

    @Test fun onlyHttpRoutesOpenInBrowser() {
        assertTrue(isWebRoute(gym))
        assertTrue(isWebRoute(TunnelRoute("a", "https://x:443")))
        assertFalse(isWebRoute(TunnelRoute("a", "ssh://127.0.0.1:22")))
        assertFalse(isWebRoute(TunnelRoute("a", "tcp://127.0.0.1:5432")))
    }

    @Test fun decodesAgentResponseAndIgnoresUnknownFields() {
        val json = Json { ignoreUnknownKeys = true }
        val body = """{"found":true,"future":1,"routes":[{"hostname":"gym.eqqx2.com","service":"http://localhost:8080","port":8080,"kind":"app","up":true},
            {"hostname":"x.test","service":"http://example.com:80","port":80,"kind":"app","up":null}]}"""
        val l = json.decodeFromString(TunnelListing.serializer(), body)
        assertTrue(l.found)
        assertEquals(listOf(true, null), l.routes.map { it.up })
        assertEquals(listOf("Running", "Not checked"), l.routes.map { tunnelChipText(it.up) })
    }

    @Test fun decodesNotFoundListing() {
        val json = Json { ignoreUnknownKeys = true }
        val l = json.decodeFromString(TunnelListing.serializer(), """{"found":false,"routes":[]}""")
        assertFalse(l.found)
        assertEquals(emptyList<TunnelRoute>(), externalRoutes(l))
    }

    @Test
    fun setupCommandsUseThePersonsOwnDomain() {
        val cmds = setupCommands("example.org")
        assertEquals(3, cmds.size)
        assertTrue(cmds[0].contains("""hostname: "*.example.org"\n    service: http://127.0.0.1:8790"""))
        assertTrue("sed needs a literal backslash-n, not a real line break", !cmds[0].contains('\n'))
        assertTrue(cmds[1].contains("route dns samsung-server \"*.example.org\""))
        assertTrue(cmds.none { it.contains("eqqx2") })
    }
}
