package com.eqqx2.samsungserver.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream

class SitesClientTest {
    private lateinit var server: MockWebServer
    private val client = SitesClient()

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private fun url() = server.url("/").toString().trimEnd('/')

    private val siteJson =
        """{"name":"blog","hostname":"blog.eqqx2.com","enabled":true,"spa":false,"files":12,"bytes":345678,"modified":"2026-11-01T10:00:00Z","createdAt":"2026-10-01T10:00:00Z","extra":1}"""

    @Test
    fun listParsesSitesAndSendsBearer() = runBlocking {
        server.enqueue(MockResponse().setBody(
            """{"domain":"eqqx2.com","sites":[$siteJson,{"name":"new","hostname":"new.eqqx2.com","enabled":false,"spa":true,"files":0,"bytes":0,"modified":null,"createdAt":"x"}]}"""
        ))
        val r = client.list(url(), " tok\n")
        assertTrue(r is SitesResult.Ok)
        val v = (r as SitesResult.Ok).value
        assertEquals("eqqx2.com", v.domain)
        assertEquals(2, v.sites.size)
        assertEquals(345678L, v.sites[0].bytes)
        assertEquals(12, v.sites[0].files)
        assertNull(v.sites[1].modified)
        assertTrue(v.sites[1].spa)
        assertFalse(v.sites[1].enabled)
        val req = server.takeRequest()
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals("GET", req.method)
        assertEquals("/sites/list", req.path)
    }

    @Test
    fun createSendsJsonAndParsesSite() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"site":$siteJson}"""))
        val r = client.create(url(), "t", "blog", true)
        assertEquals("blog.eqqx2.com", (r as SitesResult.Ok).value.hostname)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/sites/create", req.path)
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("""{"name":"blog","spa":true}""", req.body.readUtf8())
    }

    @Test
    fun createErrorsMap() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"bad_name"}"""))
        assertEquals(SitesResult.BadName, client.create(url(), "t", "X", false))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"reserved_name"}"""))
        assertEquals(SitesResult.Reserved, client.create(url(), "t", "api", false))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"exists"}"""))
        assertEquals(SitesResult.Conflict, client.create(url(), "t", "blog", false))
    }

    @Test
    fun updateSendsOnlyGivenFields() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"site":$siteJson}"""))
        assertTrue(client.update(url(), "t", "blog", enabled = false) is SitesResult.Ok)
        val req = server.takeRequest()
        assertEquals("/sites/update", req.path)
        assertEquals("""{"name":"blog","enabled":false}""", req.body.readUtf8())
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        assertEquals(SitesResult.NotFound, client.update(url(), "t", "gone", spa = true))
    }

    @Test
    fun deleteEncodesQuery() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        assertTrue(client.delete(url(), "t", "my site&x=1") is SitesResult.Ok)
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        val raw = req.path!!
        assertTrue(raw, raw.startsWith("/sites?name="))
        assertTrue(raw, !raw.contains(' '))
        assertTrue(raw, !raw.substring(raw.indexOf('?')).contains("&"))
        assertEquals("my site&x=1", req.requestUrl!!.queryParameter("name"))
    }

    @Test
    fun deploySendsRawZipBody() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"files":3,"bytes":999}"""))
        val data = ByteArray(200_000) { (it % 251).toByte() }
        var last = 0L
        val r = client.deploy(url(), " tok ", "blog", { ByteArrayInputStream(data) }, data.size.toLong()) { last = it }
        assertEquals(3, (r as SitesResult.Ok).value.files)
        assertEquals(999L, r.value.bytes)
        assertEquals(data.size.toLong(), last)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/sites/deploy?name=blog", req.path)
        assertEquals("application/zip", req.getHeader("Content-Type"))
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertArrayEquals(data, req.body.readByteArray())
    }

    @Test
    fun deployErrorsMap() = runBlocking {
        suspend fun deployWith(code: Int, body: String): SitesResult<DeployReceipt> {
            server.enqueue(MockResponse().setResponseCode(code).setBody(body))
            return client.deploy(url(), "t", "blog", { ByteArrayInputStream(ByteArray(4)) }, 4) {}
        }
        assertEquals(SitesResult.BadZip, deployWith(400, """{"error":"bad_zip"}"""))
        assertEquals(SitesResult.UnsafeZip, deployWith(400, """{"error":"unsafe_zip"}"""))
        assertEquals(SitesResult.TooLarge, deployWith(413, """{"error":"too_large"}"""))
        assertEquals(SitesResult.Busy, deployWith(409, """{"error":"busy"}"""))
        assertEquals(SitesResult.NotFound, deployWith(404, """{"error":"not_found"}"""))
        assertTrue(deployWith(400, """{"error":"bad_request"}""") is SitesResult.Failure)
    }

    @Test
    fun checkParsesResult() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"hostname":"blog.eqqx2.com","reachable":false,"status":null,"error":"dns"}"""))
        val v = (client.check(url(), "t", "blog") as SitesResult.Ok).value
        assertFalse(v.reachable)
        assertNull(v.status)
        assertEquals("dns", v.error)
        assertEquals("/sites/check?name=blog", server.takeRequest().path)
        server.enqueue(MockResponse().setBody("""{"hostname":"blog.eqqx2.com","reachable":true,"status":200,"error":null}"""))
        val ok = (client.check(url(), "t", "blog") as SitesResult.Ok).value
        assertTrue(ok.reachable)
        assertEquals(200, ok.status)
    }

    @Test
    fun mapsAuthAndRateLimit() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(SitesResult.Unauthorized, client.list(url(), "t"))
        server.enqueue(MockResponse().setResponseCode(429))
        assertEquals(SitesResult.RateLimited, client.check(url(), "t", "blog"))
    }

    @Test
    fun tokenNeverInFailureMessages() = runBlocking {
        val secret = "SECRET-TOKEN-123"
        server.enqueue(MockResponse().setResponseCode(500).setBody("oops"))
        val a = client.list(url(), secret)
        assertTrue(a is SitesResult.Failure)
        assertFalse((a as SitesResult.Failure).message.contains(secret))
        server.enqueue(MockResponse().setBody("not json"))
        val b = client.list(url(), secret)
        assertFalse((b as SitesResult.Failure).message.contains(secret))
        val c = client.list("not a url", secret)
        assertFalse((c as SitesResult.Failure).message.contains(secret))
        server.shutdown()
        val d = client.list(url(), secret)
        assertFalse(d.toString().contains(secret))
    }
}
