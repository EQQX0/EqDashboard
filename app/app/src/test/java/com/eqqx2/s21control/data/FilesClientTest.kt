package com.eqqx2.s21control.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class FilesClientTest {
    private lateinit var server: MockWebServer
    private val client = FilesClient()

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private fun url() = server.url("/").toString().trimEnd('/')

    private val listBody =
        """{"path":"photos","extra":1,"entries":[{"name":"sub","type":"dir","size":0,"modified":"2026-11-01T10:00:00Z"},{"name":"a.jpg","type":"file","size":123,"modified":"2026-11-02T10:00:00Z"}]}"""

    @Test
    fun listParsesEntriesAndSendsBearer() = runBlocking {
        server.enqueue(MockResponse().setBody(listBody))
        val r = client.list(url(), " tok\n", "photos")
        assertTrue(r is FilesResult.Ok)
        val v = (r as FilesResult.Ok).value
        assertEquals("photos", v.path)
        assertEquals(2, v.entries.size)
        assertTrue(v.entries[0].isDir)
        assertEquals(123L, v.entries[1].size)
        val req = server.takeRequest()
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals("GET", req.method)
        assertEquals("/files/list?path=photos", req.path)
    }

    @Test
    fun listEncodesSpacesAmpersandAndUnicode() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"path":"x","entries":[]}"""))
        client.list(url(), "t", "my docs/a&b/café")
        val req = server.takeRequest()
        val raw = req.path!!
        assertTrue(raw, raw.startsWith("/files/list?path="))
        assertTrue(raw, !raw.contains(' '))
        assertTrue(raw, raw.contains("%26"))
        assertTrue(raw, !raw.substring(raw.indexOf('?')).contains("&"))
        // server-side decoding gives back the original
        assertEquals("my docs/a&b/café", req.requestUrl!!.queryParameter("path"))
    }

    @Test
    fun emptyPathIsSentAsEmptyValue() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"path":"","entries":[]}"""))
        assertTrue(client.list(url(), "t", "") is FilesResult.Ok)
        assertEquals("/files/list?path=", server.takeRequest().path)
    }

    @Test
    fun mapsStatusCodes() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(FilesResult.Unauthorized, client.list(url(), "t", ""))
        server.enqueue(MockResponse().setResponseCode(429))
        assertEquals(FilesResult.RateLimited, client.list(url(), "t", ""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"exists"}"""))
        assertEquals(FilesResult.Conflict, client.mkdir(url(), "t", "a"))
        server.enqueue(MockResponse().setResponseCode(413).setBody("""{"error":"too_large"}"""))
        assertEquals(FilesResult.TooLarge, client.delete(url(), "t", "a"))
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        assertEquals(FilesResult.NotFound, client.rename(url(), "t", "a", "b"))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"bad_path"}"""))
        assertTrue(client.list(url(), "t", "..") is FilesResult.Failure)
    }

    @Test
    fun malformedListBodyIsFailureAndConnectionErrorIsFailure() = runBlocking {
        server.enqueue(MockResponse().setBody("nope"))
        assertTrue(client.list(url(), "t", "") is FilesResult.Failure)
        val u = url()
        server.shutdown()
        assertTrue(client.list(u, "t", "") is FilesResult.Failure)
    }

    @Test
    fun mkdirRenameDeleteSendExpectedRequests() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setBody("""{"ok":true}""")) }
        assertTrue(client.mkdir(url(), "t", "photos/new") is FilesResult.Ok)
        assertTrue(client.rename(url(), "t", "a/b.txt", "a/c.txt") is FilesResult.Ok)
        assertTrue(client.delete(url(), "t", "a/c.txt") is FilesResult.Ok)

        val mk = server.takeRequest()
        assertEquals("POST", mk.method)
        assertEquals("/files/mkdir", mk.path)
        assertTrue(mk.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("""{"path":"photos/new"}""", mk.body.readUtf8())

        val rn = server.takeRequest()
        assertEquals("/files/rename", rn.path)
        assertEquals("""{"from":"a/b.txt","to":"a/c.txt"}""", rn.body.readUtf8())

        val del = server.takeRequest()
        assertEquals("DELETE", del.method)
        assertTrue(del.path!!.startsWith("/files?path="))
        assertEquals("a/c.txt", del.requestUrl!!.queryParameter("path"))
    }

    @Test
    fun uploadSendsRawBodyWithQuery() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"name":"my file.txt","size":11}"""))
        val data = "hello world".toByteArray()
        var last = 0L
        val r = client.upload(url(), "tok", "docs/x y", "my file.txt", false, { ByteArrayInputStream(data) }, data.size.toLong()) { last = it }
        assertTrue(r is FilesResult.Ok)
        assertEquals(11L, (r as FilesResult.Ok).value.size)
        assertEquals(11L, last)
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals("docs/x y", req.requestUrl!!.queryParameter("path"))
        assertEquals("my file.txt", req.requestUrl!!.queryParameter("name"))
        assertEquals(null, req.requestUrl!!.queryParameter("overwrite"))
        assertEquals(11L, req.bodySize)
        assertEquals("hello world", req.body.readUtf8())
    }

    @Test
    fun uploadOverwriteFlagAndConflict() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"exists"}"""))
        val r = client.upload(url(), "t", "", "a.bin", false, { ByteArrayInputStream(ByteArray(3)) }, 3) {}
        assertEquals(FilesResult.Conflict, r)
        server.takeRequest()
        server.enqueue(MockResponse().setBody("""{"ok":true,"name":"a.bin","size":3}"""))
        client.upload(url(), "t", "", "a.bin", true, { ByteArrayInputStream(ByteArray(3)) }, 3) {}
        assertEquals("1", server.takeRequest().requestUrl!!.queryParameter("overwrite"))
    }

    @Test
    fun uploadWithUnknownLengthStreamsLargeBody() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"name":"big","size":300000}"""))
        val data = ByteArray(300_000) { (it % 251).toByte() }
        val r = client.upload(url(), "t", "", "big", false, { ByteArrayInputStream(data) }, null) {}
        assertTrue(r is FilesResult.Ok)
        assertArrayEquals(data, server.takeRequest().body.readByteArray())
    }

    @Test
    fun downloadStreamsBytesIntoSink() = runBlocking {
        val data = ByteArray(200_000) { (it % 199).toByte() }
        server.enqueue(MockResponse().setBody(Buffer().write(data)))
        val out = ByteArrayOutputStream()
        var last = 0L
        val r = client.download(url(), "tok", "a/b c.bin", out) { last = it }
        assertEquals(FilesResult.Ok(200_000L), r)
        assertEquals(200_000L, last)
        assertArrayEquals(data, out.toByteArray())
        val req = server.takeRequest()
        assertEquals("a/b c.bin", req.requestUrl!!.queryParameter("path"))
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test
    fun download404IsNotFound() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(FilesResult.NotFound, client.download(url(), "t", "x", ByteArrayOutputStream()) {})
    }
}
