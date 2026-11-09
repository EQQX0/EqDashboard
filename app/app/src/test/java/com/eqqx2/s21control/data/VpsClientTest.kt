package com.eqqx2.s21control.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class VpsClientTest {
    private lateinit var server: MockWebServer
    private val client = VpsClient()
    private fun base() = server.url("/").toString().trimEnd('/')

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private val listing = """{"engine":true,"distros":[{"id":"debian","label":"Debian"},{"id":"alpine","label":"Alpine Linux"}],
        "host":"192.168.1.20","maxSlices":4,"freeBytes":9000,"future":1,
        "items":[{"id":"web","name":"web","distro":"debian","distroLabel":"Debian","port":2201,"authMode":"password",
        "status":"creating","step":"Installing the SSH server","error":null,"createdAt":"2026-11-09T00:00:00Z","startedAt":null}]}"""

    @Test fun listDecodesAndSendsToken() = runBlocking {
        server.enqueue(MockResponse().setBody(listing))
        val r = client.list(base(), " tok ") as VpsResult.Ok
        assertTrue(r.value.engine)
        assertEquals("192.168.1.20", r.value.host)
        assertEquals(listOf("debian", "alpine"), r.value.distros.map { it.id })
        assertEquals("Installing the SSH server", r.value.items[0].step)
        assertEquals(2201, r.value.items[0].port)
        val req = server.takeRequest()
        assertEquals("/vps/list", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test fun createPostsFieldsAndReturnsPasswordOnce() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"web","name":"web","status":"creating"},"password":"s3cret"}"""))
        val r = client.create(base(), "t", "web", "debian", "") as VpsResult.Ok
        assertEquals("s3cret", r.value.password)
        val req = server.takeRequest()
        assertEquals("POST /vps/create", "${req.method} ${req.path}")
        val body = req.body.readUtf8()
        assertTrue(body, body.contains("\"name\":\"web\"") && body.contains("\"distro\":\"debian\""))
        assertFalse("blank key is left out: $body", body.contains("sshKey"))
    }

    @Test fun createWithKeyIncludesTrimmedKeyAndHasNoPassword() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"k","status":"creating"},"password":null}"""))
        val r = client.create(base(), "t", "k", "alpine", "  ssh-ed25519 AAAA  ") as VpsResult.Ok
        assertNull(r.value.password)
        assertTrue(server.takeRequest().body.readUtf8().contains("\"sshKey\":\"ssh-ed25519 AAAA\""))
    }

    @Test fun errorsMapToTypedResults() = runBlocking {
        fun enqueue(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))
        enqueue(400, """{"error":"bad_name"}""")
        enqueue(400, """{"error":"bad_key"}""")
        enqueue(409, """{"error":"exists"}""")
        enqueue(409, """{"error":"too_many","max":4}""")
        enqueue(503, """{"error":"engine_missing","engine":"proot-distro"}""")
        enqueue(507, """{"error":"low_space","freeBytes":99}""")
        enqueue(409, """{"error":"busy"}""")
        enqueue(401, """{"error":"unauthorized"}""")
        enqueue(429, """{"error":"rate_limited"}""")
        enqueue(500, "oops")
        val r = List(10) { client.create(base(), "t", "web", "debian", "") }
        assertEquals(VpsResult.BadName, r[0])
        assertEquals(VpsResult.BadKey, r[1])
        assertEquals(VpsResult.Exists, r[2])
        assertEquals(VpsResult.TooMany(4), r[3])
        assertEquals(VpsResult.EngineMissing, r[4])
        assertEquals(VpsResult.LowSpace(99), r[5])
        assertEquals(VpsResult.Busy, r[6])
        assertEquals(VpsResult.Unauthorized, r[7])
        assertEquals(VpsResult.RateLimited, r[8])
        assertEquals(VpsResult.Failure("Server returned HTTP 500"), r[9])
    }

    @Test fun startStopPasswordDeleteUseTheRightRoutes() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setBody("""{"ok":true}""")) }
        server.enqueue(MockResponse().setBody("""{"ok":true,"password":"newpw"}"""))
        assertEquals(VpsResult.Ok(Unit), client.start(base(), "t", "web"))
        assertEquals(VpsResult.Ok(Unit), client.stop(base(), "t", "web"))
        assertEquals(VpsResult.Ok(Unit), client.delete(base(), "t", "web"))
        assertEquals(VpsResult.Ok("newpw"), client.resetPassword(base(), "t", "web"))
        val a = server.takeRequest(); val b = server.takeRequest(); val c = server.takeRequest(); val d = server.takeRequest()
        assertEquals("POST /vps/start", "${a.method} ${a.path}")
        assertTrue(a.body.readUtf8().contains("\"id\":\"web\""))
        assertEquals("POST /vps/stop", "${b.method} ${b.path}")
        assertEquals("DELETE /vps?id=web", "${c.method} ${c.path}")
        assertEquals("POST /vps/password", "${d.method} ${d.path}")
    }

    @Test fun notFoundAndKeyOnlyMap() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"key_only"}"""))
        assertEquals(VpsResult.NotFound, client.start(base(), "t", "x"))
        assertEquals(VpsResult.KeyOnly, client.resetPassword(base(), "t", "x"))
    }

    @Test fun garbageAndDeadServerAreFailures() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.list(base(), "t") is VpsResult.Failure)
        server.shutdown()
        assertTrue(client.list(base(), "t") is VpsResult.Failure)
    }
}
