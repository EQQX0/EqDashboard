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
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class UpdateClientTest {
    private lateinit var server: MockWebServer
    private val client = UpdateClient()

    @get:Rule val tmp = TemporaryFolder()

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private fun url() = server.url("/").toString().trimEnd('/')

    private fun latest(code: Int) =
        """{"versionCode":$code,"versionName":"0.2.0","sha256":"abc","size":1000,"notes":"hi","publishedAt":"2026-11-01T00:00:00Z","extra":true}"""

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    // ---- check ----

    @Test fun checkAvailableWhenNewer() = runBlocking {
        server.enqueue(MockResponse().setBody(latest(12)))
        val r = client.check(url(), "tok", 1)
        assertTrue(r is UpdateCheck.Available)
        val info = (r as UpdateCheck.Available).info
        assertEquals(12, info.versionCode)
        assertEquals("0.2.0", info.versionName)
        assertEquals(1000L, info.size)
    }

    @Test fun checkUpToDateWhenEqualOrOlder() = runBlocking {
        server.enqueue(MockResponse().setBody(latest(5)))
        server.enqueue(MockResponse().setBody(latest(4)))
        assertEquals(UpdateCheck.UpToDate, client.check(url(), "t", 5))
        assertEquals(UpdateCheck.UpToDate, client.check(url(), "t", 6))
    }

    @Test fun checkSendsTrimmedBearerToLatest() = runBlocking {
        server.enqueue(MockResponse().setBody(latest(1)))
        client.check(url() + "/", " tok\n", 1)
        val req = server.takeRequest()
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals("/api/latest", req.path)
    }

    @Test fun checkMapsErrorCodes() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}"""))
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"no_release"}"""))
        server.enqueue(MockResponse().setResponseCode(429))
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"not_configured"}"""))
        server.enqueue(MockResponse().setResponseCode(502).setBody("""{"error":"upstream"}"""))
        assertEquals(UpdateCheck.Unauthorized, client.check(url(), "t", 1))
        assertEquals(UpdateCheck.NoRelease, client.check(url(), "t", 1))
        assertEquals(UpdateCheck.RateLimited, client.check(url(), "t", 1))
        assertEquals(UpdateCheck.NotConfigured, client.check(url(), "t", 1))
        assertTrue(client.check(url(), "t", 1) is UpdateCheck.Failure)
    }

    @Test fun checkNeverThrowsOnGarbageOrBadUrl() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.check(url(), "t", 1) is UpdateCheck.Failure)
        assertTrue(client.check("not a url", "t", 1) is UpdateCheck.Failure)
        server.shutdown()
        assertTrue(client.check(url(), "t", 1) is UpdateCheck.Failure)
    }

    // ---- resolveApkUrl ----

    @Test fun resolveApkUrlOkSendsVersionCodeAndBearer() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"url":"https://cdn.example/app.apk?sig=1","expiresInSec":300}"""))
        val r = client.resolveApkUrl(url(), " tok ", 12)
        assertEquals(ApkUrlResult.Ok("https://cdn.example/app.apk?sig=1"), r)
        val req = server.takeRequest()
        assertEquals("/api/apk?versionCode=12", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
    }

    @Test fun resolveApkUrlMapsErrors() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(MockResponse().setResponseCode(429))
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody("""{"nope":1}"""))
        assertEquals(ApkUrlResult.Unauthorized, client.resolveApkUrl(url(), "t", 1))
        assertEquals(ApkUrlResult.NotFound, client.resolveApkUrl(url(), "t", 1))
        assertEquals(ApkUrlResult.RateLimited, client.resolveApkUrl(url(), "t", 1))
        assertEquals(ApkUrlResult.NotConfigured, client.resolveApkUrl(url(), "t", 1))
        assertTrue(client.resolveApkUrl(url(), "t", 1) is ApkUrlResult.Failure)
    }

    // ---- download ----

    @Test fun downloadOkRenamesAndReportsProgress() = runBlocking {
        val bytes = ByteArray(200_000) { (it % 251).toByte() }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        val dest = File(tmp.root, "sub/app.apk")
        var last = 0L
        val r = client.download(url() + "/f", dest, sha(bytes).uppercase(), bytes.size.toLong()) { last = it }
        assertEquals(DownloadResult.Ok(dest), r)
        assertTrue(dest.exists())
        assertEquals(bytes.size.toLong(), dest.length())
        assertEquals(bytes.size.toLong(), last)
        assertFalse(File(dest.path + ".part").exists())
    }

    @Test fun downloadHashMismatchDeletesFiles() = runBlocking {
        val bytes = ByteArray(5000) { 7 }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        val dest = File(tmp.root, "app.apk")
        val r = client.download(url(), dest, "0".repeat(64), bytes.size.toLong()) {}
        assertEquals(DownloadResult.HashMismatch, r)
        assertFalse(dest.exists())
        assertFalse(File(dest.path + ".part").exists())
    }

    @Test fun downloadShorterThanExpectedIsSizeMismatch() = runBlocking {
        val bytes = ByteArray(3000) { 1 }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        val dest = File(tmp.root, "app.apk")
        val r = client.download(url(), dest, sha(bytes), 4000L) {}
        assertEquals(DownloadResult.SizeMismatch, r)
        assertFalse(dest.exists())
        assertFalse(File(dest.path + ".part").exists())
    }

    @Test fun downloadAbortsWhenBodyLongerThanExpected() = runBlocking {
        val bytes = ByteArray(300_000) { 2 }
        // chunked: no Content-Length, so the overrun is only caught while streaming
        server.enqueue(MockResponse().setChunkedBody(okio.Buffer().write(bytes), 8192))
        val dest = File(tmp.root, "app.apk")
        var seen = 0L
        val r = client.download(url(), dest, sha(bytes), 100_000L) { seen = it }
        assertEquals(DownloadResult.SizeMismatch, r)
        assertTrue(seen <= 100_000L)
        assertFalse(dest.exists())
        assertFalse(File(dest.path + ".part").exists())
    }

    @Test fun downloadSendsNoAuthorizationHeader() = runBlocking {
        val bytes = ByteArray(10) { 3 }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        client.download(url() + "/signed?sig=abc", File(tmp.root, "a.apk"), sha(bytes), 10L) {}
        val req = server.takeRequest()
        assertNull(req.getHeader("Authorization"))
        assertEquals("/signed?sig=abc", req.path)
    }

    @Test fun downloadHttpErrorIsFailureAndLeavesNothing() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(403))
        val dest = File(tmp.root, "app.apk")
        val r = client.download(url(), dest, "x", 10L) {}
        assertTrue(r is DownloadResult.Failure)
        assertFalse(dest.exists())
    }

    // ---- isNewer ----

    @Test fun isNewerComparesVersionCodes() {
        assertTrue(isNewer(1, 2))
        assertFalse(isNewer(2, 2))
        assertFalse(isNewer(3, 2))
    }
}
