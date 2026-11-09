package com.eqqx2.s21control.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DownloadsClientTest {
    private lateinit var server: MockWebServer
    private val client = DownloadsClient()
    private fun base() = server.url("/").toString().trimEnd('/')

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private val listing = """{"dir":"downloads","engines":{"aria2":true,"ytdlp":false},"freeBytes":5000,"future":1,
        "items":[{"id":"0123456789abcdef","engine":"aria2","source":"x.com/a.zip","name":"a.zip","status":"active",
        "totalBytes":1000,"doneBytes":250,"speedBps":50,"etaSec":15,"error":null,"path":null,"createdAt":"2026-11-09T00:00:00Z"}]}"""

    @Test fun listDecodesAndSendsToken() = runBlocking {
        server.enqueue(MockResponse().setBody(listing))
        val r = client.list(base(), " tok ") as DownloadsResult.Ok
        assertEquals(true, r.value.engines.aria2)
        assertEquals(false, r.value.engines.ytdlp)
        assertEquals(5000L, r.value.freeBytes)
        assertEquals(listOf("a.zip"), r.value.items.map { it.name })
        assertEquals(15L, r.value.items[0].etaSec)
        val req = server.takeRequest()
        assertEquals("/downloads/list", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test fun addPostsUrlAndMode() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"y123","engine":"ytdlp","name":"clip","status":"queued"}}"""))
        val r = client.add(base(), "t", "https://v.com/watch?v=1", DownloadMode.Audio) as DownloadsResult.Ok
        assertEquals("clip", r.value.name)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/downloads/add", req.path)
        val body = req.body.readUtf8()
        assertTrue(body, body.contains("\"url\":\"https://v.com/watch?v=1\"") && body.contains("\"mode\":\"audio\""))
    }

    @Test fun fileModeSendsDirect() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"y1"}}"""))
        client.add(base(), "t", "https://x.com/dl?id=1", DownloadMode.File)
        assertTrue(server.takeRequest().body.readUtf8().contains("\"mode\":\"direct\""))
    }

    @Test fun errorsMapToTypedResults() = runBlocking {
        fun enqueue(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))
        enqueue(400, """{"error":"bad_url"}""")
        enqueue(400, """{"error":"blocked_url"}""")
        enqueue(503, """{"error":"engine_missing","engine":"aria2"}""")
        enqueue(507, """{"error":"low_space","freeBytes":123}""")
        enqueue(502, """{"error":"engine_error","engine":"aria2"}""")
        enqueue(404, """{"error":"not_found"}""")
        enqueue(401, """{"error":"unauthorized"}""")
        enqueue(429, """{"error":"rate_limited"}""")
        enqueue(500, "oops")
        val results = List(9) { client.add(base(), "t", "https://x.com/a.zip", DownloadMode.Auto) }
        assertEquals(DownloadsResult.BadUrl, results[0])
        assertEquals(DownloadsResult.Blocked, results[1])
        assertEquals(DownloadsResult.EngineMissing("aria2"), results[2])
        assertEquals(DownloadsResult.LowSpace(123), results[3])
        assertEquals(DownloadsResult.EngineError, results[4])
        assertEquals(DownloadsResult.NotFound, results[5])
        assertEquals(DownloadsResult.Unauthorized, results[6])
        assertEquals(DownloadsResult.RateLimited, results[7])
        assertEquals(DownloadsResult.Failure("Server returned HTTP 500"), results[8])
    }

    @Test fun pauseResumeRemoveUseTheRightRoutes() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setBody("""{"ok":true}""")) }
        assertEquals(DownloadsResult.Ok(Unit), client.pause(base(), "t", "abc"))
        assertEquals(DownloadsResult.Ok(Unit), client.resume(base(), "t", "abc"))
        assertEquals(DownloadsResult.Ok(Unit), client.remove(base(), "t", "abc"))
        val a = server.takeRequest(); val b = server.takeRequest(); val c = server.takeRequest()
        assertEquals("POST /downloads/pause", "${a.method} ${a.path}")
        assertTrue(a.body.readUtf8().contains("\"id\":\"abc\""))
        assertEquals("POST /downloads/resume", "${b.method} ${b.path}")
        assertEquals("DELETE /downloads?id=abc", "${c.method} ${c.path}")
    }

    @Test fun garbageAndDeadServerAreFailures() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.list(base(), "t") is DownloadsResult.Failure)
        server.shutdown()
        assertTrue(client.list(base(), "t") is DownloadsResult.Failure)
    }
}
