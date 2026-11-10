package com.eqqx2.samsungserver.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgentClientTest {
    private lateinit var server: MockWebServer
    private val client = AgentClient()
    private val body = """{"time":"2026-11-09T14:45:33.736Z","uptimeSec":315205,"load":[3.36,3.81,3.82],"cpuCores":0,"memory":{"totalBytes":7571623936,"freeBytes":2971799552},"storage":{"totalKb":6109176,"usedKb":6106336,"freeKb":2840},"battery":null}"""

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private fun url() = server.url("/").toString().trimEnd('/')

    @Test
    fun sendsBearerHeaderTrimmed() = runBlocking {
        server.enqueue(MockResponse().setBody(body))
        val r = client.fetchStatus(url(), " abc\n")
        assertTrue(r is FetchResult.Ok)
        val req = server.takeRequest()
        assertEquals("Bearer abc", req.getHeader("Authorization"))
        assertEquals("/status", req.path)
    }

    @Test
    fun maps401ToUnauthorized() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(FetchResult.Unauthorized, client.fetchStatus(url(), "x"))
    }

    @Test
    fun maps429ToRateLimited() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(429))
        assertEquals(FetchResult.RateLimited, client.fetchStatus(url(), "x"))
    }

    @Test
    fun mapsConnectionFailureToFailure() = runBlocking {
        val u = url()
        server.shutdown()
        assertTrue(client.fetchStatus(u, "x") is FetchResult.Failure)
    }

    @Test
    fun mapsMalformedJsonToFailure() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.fetchStatus(url(), "x") is FetchResult.Failure)
    }

    @Test
    fun maps530ToTunnelOfflineMessage() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(530).setBody("error code: 1033"))
        val r = client.fetchStatus(url(), "x")
        assertTrue(r is FetchResult.Failure)
        val msg = (r as FetchResult.Failure).message
        assertTrue(msg, msg.contains("tunnel offline"))
        assertTrue(msg, msg.contains("1033"))
    }
}
