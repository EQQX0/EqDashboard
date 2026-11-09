package com.eqqx2.s21control.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PcClientTest {
    private lateinit var server: MockWebServer
    private val client = PcClient()
    private fun base() = server.url("/").toString().trimEnd('/')

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    @Test fun listDecodesAndSendsToken() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"items":[{"id":"a1","name":"Desktop","mac":"aa:bb:cc:dd:ee:ff","ip":"192.168.1.20","sshUser":"me","sshPort":22,"online":true,"x":1}],"maxPcs":8,"key":"ssh-ed25519 AAAA s21"}"""))
        val r = client.list(base(), " tok ") as PcResult.Ok
        assertEquals(listOf("Desktop"), r.value.items.map { it.name })
        assertTrue(r.value.items[0].online)
        assertEquals("ssh-ed25519 AAAA s21", r.value.key)
        val req = server.takeRequest()
        assertEquals("/pc/list", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test fun addPostsAllFields() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"a1","name":"Desktop","online":false}}"""))
        val r = client.add(base(), "t", "Desktop", "aa:bb:cc:dd:ee:ff", "192.168.1.20", "me", 22) as PcResult.Ok
        assertEquals("a1", r.value.id)
        val req = server.takeRequest()
        assertEquals("POST /pc/add", "${req.method} ${req.path}")
        val body = req.body.readUtf8()
        for (s in listOf("\"name\":\"Desktop\"", "\"mac\":\"aa:bb:cc:dd:ee:ff\"", "\"ip\":\"192.168.1.20\"", "\"sshUser\":\"me\"", "\"sshPort\":22")) assertTrue("$s in $body", body.contains(s))
    }

    @Test fun actionRoutes() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setBody("""{"ok":true}""")) }
        server.enqueue(MockResponse().setBody("""{"ok":true,"item":{"id":"a1","sshUser":"Admin"}}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true,"key":"ssh-ed25519 AAAA s21"}"""))
        assertEquals(PcResult.Ok(Unit), client.wake(base(), "t", "a1"))
        assertEquals(PcResult.Ok(Unit), client.shutdown(base(), "t", "a1"))
        assertEquals(PcResult.Ok(Unit), client.delete(base(), "t", "a1"))
        assertEquals("Admin", (client.setUser(base(), "t", "a1", "Admin") as PcResult.Ok).value.sshUser)
        assertEquals("ssh-ed25519 AAAA s21", (client.key(base(), "t") as PcResult.Ok).value)
        val r = List(5) { server.takeRequest() }.map { "${it.method} ${it.path}" }
        assertEquals(listOf("POST /pc/wake", "POST /pc/shutdown", "DELETE /pc?id=a1", "POST /pc/user", "POST /pc/key"), r)
    }

    @Test fun errorsMapToTypedResults() = runBlocking {
        fun enqueue(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))
        enqueue(400, """{"error":"bad_mac"}""")
        enqueue(400, """{"error":"bad_ip"}""")
        enqueue(409, """{"error":"exists"}""")
        enqueue(409, """{"error":"too_many","max":8}""")
        enqueue(409, """{"error":"no_ssh_user"}""")
        enqueue(502, """{"error":"auth_failed"}""")
        enqueue(502, """{"error":"unreachable"}""")
        enqueue(503, """{"error":"ssh_missing"}""")
        enqueue(429, """{"error":"too_fast"}""")
        enqueue(429, """{"error":"rate_limited"}""")
        enqueue(401, """{"error":"unauthorized"}""")
        enqueue(500, "oops")
        val r = List(12) { client.shutdown(base(), "t", "a1") }
        assertEquals(PcResult.BadMac, r[0])
        assertEquals(PcResult.BadIp, r[1])
        assertEquals(PcResult.Exists, r[2])
        assertEquals(PcResult.TooMany(8), r[3])
        assertEquals(PcResult.NoSshUser, r[4])
        assertEquals(PcResult.AuthFailed, r[5])
        assertEquals(PcResult.Unreachable, r[6])
        assertEquals(PcResult.SshMissing, r[7])
        assertEquals(PcResult.TooFast, r[8])
        assertEquals(PcResult.RateLimited, r[9])
        assertEquals(PcResult.Unauthorized, r[10])
        assertEquals(PcResult.Failure("Server returned HTTP 500"), r[11])
    }

    @Test fun garbageAndDeadServerAreFailures() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.list(base(), "t") is PcResult.Failure)
        server.shutdown()
        assertTrue(client.list(base(), "t") is PcResult.Failure)
    }
}
