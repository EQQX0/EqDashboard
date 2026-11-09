package com.eqqx2.s21control.data

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
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
    private lateinit var client: UpdateClient

    @get:Rule val tmp = TemporaryFolder()

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val host = server.hostName
        client = UpdateClient(apiBase = base(), isAllowed = { it.host == host }, retryDelayMs = 0)
    }

    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    private fun base() = server.url("/").toString().trimEnd('/')
    private fun url(path: String = "") = base() + path

    private fun meta(code: Int, sha: String = "abc", size: Long = 1000) =
        """{"versionCode":$code,"versionName":"0.2.0","sha256":"$sha","size":$size,"notes":"hi","extra":true}"""

    private fun release(
        draft: Boolean = false,
        prerelease: Boolean = false,
        metaUrl: String? = url("/dl/meta.json"),
        apkUrl: String? = url("/dl/app.apk"),
    ): String {
        val assets = buildList {
            if (metaUrl != null) add("""{"name":"meta.json","browser_download_url":"$metaUrl"}""")
            add("""{"name":"other.txt","browser_download_url":"${url("/dl/other.txt")}"}""")
            if (apkUrl != null) add("""{"name":"app.apk","browser_download_url":"$apkUrl"}""")
        }
        return """{"draft":$draft,"prerelease":$prerelease,"published_at":"2026-11-01T00:00:00Z","assets":[${assets.joinToString(",")}]}"""
    }

    private fun enqueueRelease(code: Int, rel: String = release()) {
        server.enqueue(MockResponse().setBody(rel))
        server.enqueue(MockResponse().setBody(meta(code)))
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    // ---- check ----

    @Test fun checkAvailableWhenNewer() = runBlocking {
        enqueueRelease(12)
        val r = client.check("EQQX0/EqDashboard", 1)
        assertTrue(r is UpdateCheck.Available)
        val info = (r as UpdateCheck.Available).info
        assertEquals(12, info.versionCode)
        assertEquals("0.2.0", info.versionName)
        assertEquals(1000L, info.size)
        assertEquals("hi", info.notes)
        assertEquals("2026-11-01T00:00:00Z", info.publishedAt)
        assertEquals(url("/dl/app.apk"), info.apkUrl)
    }

    @Test fun checkUpToDateWhenEqualOrOlder() = runBlocking {
        enqueueRelease(5)
        enqueueRelease(4)
        assertEquals(UpdateCheck.UpToDate, client.check("o/r", 5))
        assertEquals(UpdateCheck.UpToDate, client.check("o/r", 6))
    }

    @Test fun checkRequestShapeAndMetaFromBrowserDownloadUrl() = runBlocking {
        enqueueRelease(2)
        client.check("EQQX0/EqDashboard", 1)
        val rel = server.takeRequest()
        assertEquals("/repos/EQQX0/EqDashboard/releases/latest", rel.path)
        assertEquals("application/vnd.github+json", rel.getHeader("Accept"))
        assertEquals("S21Control-Updater", rel.getHeader("User-Agent"))
        val m = server.takeRequest()
        assertEquals("/dl/meta.json", m.path)
    }

    @Test fun draftAndPrereleaseAreIgnored() = runBlocking {
        server.enqueue(MockResponse().setBody(release(draft = true)))
        server.enqueue(MockResponse().setBody(release(prerelease = true)))
        assertEquals(UpdateCheck.NoRelease, client.check("o/r", 1))
        assertEquals(UpdateCheck.NoRelease, client.check("o/r", 1))
        assertEquals(2, server.requestCount)
    }

    @Test fun missingAssetsIsNoRelease() = runBlocking {
        server.enqueue(MockResponse().setBody(release(metaUrl = null)))
        server.enqueue(MockResponse().setBody(release(apkUrl = null)))
        assertEquals(UpdateCheck.NoRelease, client.check("o/r", 1))
        assertEquals(UpdateCheck.NoRelease, client.check("o/r", 1))
    }

    @Test fun http404IsNoRelease() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(UpdateCheck.NoRelease, client.check("o/r", 1))
    }

    @Test fun rateLimitsAreMapped() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(403))
        server.enqueue(MockResponse().setResponseCode(429))
        server.enqueue(MockResponse().setResponseCode(500).setHeader("X-RateLimit-Remaining", "0"))
        assertEquals(UpdateCheck.RateLimited, client.check("o/r", 1))
        assertEquals(UpdateCheck.RateLimited, client.check("o/r", 1))
        assertEquals(UpdateCheck.RateLimited, client.check("o/r", 1))
    }

    @Test fun otherErrorsAreFailure() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setResponseCode(502)) }
        val r = client.check("o/r", 1)
        assertTrue(r is UpdateCheck.Failure)
        assertTrue((r as UpdateCheck.Failure).message.contains("502"))
        server.enqueue(MockResponse().setBody(release()))
        repeat(3) { server.enqueue(MockResponse().setResponseCode(500)) }
        assertTrue(client.check("o/r", 1) is UpdateCheck.Failure)
    }

    @Test fun transientServerErrorIsRetried() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(MockResponse().setBody(release()))
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody(meta(9)))
        val r = client.check("o/r", 1)
        assertTrue(r is UpdateCheck.Available)
        assertEquals(9, (r as UpdateCheck.Available).info.versionCode)
        assertEquals(4, server.requestCount)
    }

    @Test fun oversizedMetaIsFailure() = runBlocking {
        server.enqueue(MockResponse().setBody(release()))
        server.enqueue(MockResponse().setBody(meta(9) + " ".repeat(20_000)))
        assertTrue(client.check("o/r", 1) is UpdateCheck.Failure)
    }

    @Test fun checkNeverThrowsOnGarbageOrIoError() = runBlocking {
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.check("o/r", 1) is UpdateCheck.Failure)
        server.enqueue(MockResponse().setBody(release()))
        server.enqueue(MockResponse().setBody("not json"))
        assertTrue(client.check("o/r", 1) is UpdateCheck.Failure)
        server.shutdown()
        assertTrue(client.check("o/r", 1) is UpdateCheck.Failure)
    }

    // ---- no credentials ----

    @Test fun noAuthorizationHeaderInCheck() = runBlocking {
        enqueueRelease(2)
        client.check("o/r", 1)
        repeat(2) { assertNull(server.takeRequest().getHeader("Authorization")) }
    }

    @Test fun noAuthorizationHeaderInDownload() = runBlocking {
        val bytes = ByteArray(10) { 3 }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        client.download(url("/signed?sig=abc"), File(tmp.root, "a.apk"), sha(bytes), 10L) {}
        val req = server.takeRequest()
        assertNull(req.getHeader("Authorization"))
        assertEquals("/signed?sig=abc", req.path)
    }

    // ---- host allowlist ----

    @Test fun productionAllowlist() {
        assertTrue(isAllowedUpdateUrl("https://api.github.com/x".toHttpUrl()))
        assertTrue(isAllowedUpdateUrl("https://github.com/x".toHttpUrl()))
        assertTrue(isAllowedUpdateUrl("https://objects.githubusercontent.com/x".toHttpUrl()))
        assertFalse(isAllowedUpdateUrl("http://github.com/x".toHttpUrl()))
        assertFalse(isAllowedUpdateUrl("https://evil.example/x".toHttpUrl()))
        assertFalse(isAllowedUpdateUrl("https://githubusercontent.com.evil.example/x".toHttpUrl()))
        assertFalse(isAllowedUpdateUrl("https://evilgithub.com/x".toHttpUrl()))
        assertFalse(isAllowedUpdateUrl("https://notgithubusercontent.com/x".toHttpUrl()))
    }

    @Test fun wrongHostInApkUrlIsRejected() = runBlocking {
        server.enqueue(MockResponse().setBody(release(apkUrl = "https://evil.example/app.apk")))
        val r = client.check("o/r", 1)
        assertTrue(r is UpdateCheck.Failure)
        assertEquals(1, server.requestCount)
    }

    @Test fun productionClientRejectsHttpAndForeignHostsWithoutNetwork() = runBlocking {
        val prod = UpdateClient()
        val dest = File(tmp.root, "app.apk")
        assertTrue(prod.download("http://github.com/a/app.apk", dest, "x", 1L) {} is DownloadResult.Failure)
        assertTrue(prod.download("https://evil.example/app.apk", dest, "x", 1L) {} is DownloadResult.Failure)
        assertTrue(UpdateClient(apiBase = "http://api.github.com").check("o/r", 1) is UpdateCheck.Failure)
        assertFalse(dest.exists())
    }

    @Test fun redirectOutsideAllowlistIsBlocked() = runBlocking {
        val other = if (server.hostName == "localhost") "127.0.0.1" else "localhost"
        val target = "http://$other:${server.port}/evil.apk"
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target))
        server.enqueue(MockResponse().setBody("payload"))
        val dest = File(tmp.root, "app.apk")
        val r = client.download(url("/dl/app.apk"), dest, "x", 7L) {}
        assertTrue(r is DownloadResult.Failure)
        assertFalse(dest.exists())
        assertEquals(1, server.requestCount)
    }

    @Test fun redirectWithinAllowlistIsFollowed() = runBlocking {
        val bytes = ByteArray(50) { 4 }
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", url("/real.apk")))
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        val dest = File(tmp.root, "app.apk")
        assertEquals(DownloadResult.Ok(dest), client.download(url("/dl/app.apk"), dest, sha(bytes), 50L) {})
    }

    // ---- download ----

    @Test fun downloadOkRenamesAndReportsProgress() = runBlocking {
        val bytes = ByteArray(200_000) { (it % 251).toByte() }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(bytes)))
        val dest = File(tmp.root, "sub/app.apk")
        var last = 0L
        val r = client.download(url("/f"), dest, sha(bytes).uppercase(), bytes.size.toLong()) { last = it }
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
