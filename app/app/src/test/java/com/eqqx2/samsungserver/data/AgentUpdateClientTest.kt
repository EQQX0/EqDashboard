package com.eqqx2.samsungserver.data

import com.eqqx2.samsungserver.ui.agentUpdateErrorText
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgentUpdateClientTest {
    private lateinit var server: MockWebServer
    private val client = AgentUpdateClient()
    private fun base() = server.url("/").toString().trimEnd('/')

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    @Test fun checkDecodesAndSendsToken() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"current":"0.7.0","latest":"0.8.0","available":true,"size":1234,"notes":"x","future":1}"""))
        val r = client.check(base(), " tok ") as AgentUpdateResult.Ok
        assertEquals(AgentVersionInfo("0.7.0", "0.8.0", true, "x"), r.value)
        val req = server.takeRequest()
        assertEquals("GET /agent/update", "${req.method} ${req.path}")
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test fun checkWithNoAgentAssetHasNullLatest() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"current":"0.7.0","latest":null,"available":false}"""))
        val r = client.check(base(), "t") as AgentUpdateResult.Ok
        assertEquals(null, r.value.latest)
        assertEquals(false, r.value.available)
    }

    @Test fun applyPostsAndDecodes() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"updated":true,"from":"0.7.0","to":"0.8.0","restarting":true}"""))
        val r = client.apply(base(), "t") as AgentUpdateResult.Ok
        assertEquals(AgentApplyResult(true, "0.7.0", "0.8.0"), r.value)
        assertEquals("POST /agent/update", server.takeRequest().let { "${it.method} ${it.path}" })
    }

    @Test fun errorsMap() = runBlocking {
        fun enqueue(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))
        enqueue(404, """{"error":"not_found"}""")
        enqueue(409, """{"error":"busy"}""")
        enqueue(502, """{"error":"bad_checksum"}""")
        enqueue(401, """{"error":"unauthorized"}""")
        enqueue(429, """{"error":"rate_limited"}""")
        enqueue(500, "oops")
        val r = List(6) { client.apply(base(), "t") }
        assertEquals(AgentUpdateResult.Unsupported, r[0])
        assertEquals(AgentUpdateResult.Busy, r[1])
        assertEquals(AgentUpdateResult.Refused("bad_checksum"), r[2])
        assertEquals(AgentUpdateResult.Unauthorized, r[3])
        assertEquals(AgentUpdateResult.RateLimited, r[4])
        assertEquals(AgentUpdateResult.Failure("Server returned HTTP 500"), r[5])
    }

    @Test fun deadServerIsAFailure() = runBlocking {
        server.shutdown()
        assertTrue(client.check(base(), "t") is AgentUpdateResult.Failure)
    }

    @Test fun errorTextsSayWhatToDo() {
        assertTrue(agentUpdateErrorText(AgentUpdateResult.Unsupported).contains("Termux"))
        assertTrue(agentUpdateErrorText(AgentUpdateResult.Refused("bad_archive")).contains("nothing was changed"))
        assertTrue(agentUpdateErrorText(AgentUpdateResult.Refused("network")).contains("GitHub"))
        assertEquals("boom", agentUpdateErrorText(AgentUpdateResult.Failure("boom")))
    }
}
