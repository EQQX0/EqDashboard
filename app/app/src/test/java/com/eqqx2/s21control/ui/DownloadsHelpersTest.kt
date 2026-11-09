package com.eqqx2.s21control.ui

import com.eqqx2.s21control.data.DownloadItem
import com.eqqx2.s21control.data.DownloadsResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadsHelpersTest {
    private fun item(
        status: String = "active", total: Long = 0, done: Long = 0, speed: Long = 0, eta: Long? = null,
        error: String? = null, engine: String = "aria2",
    ) = DownloadItem("id", engine, "host/file.zip", "file.zip", status, total, done, speed, eta, error)

    @Test fun chipTextHasWordsForEveryStatus() {
        assertEquals("Downloading", downloadChipText("active"))
        assertEquals("Queued", downloadChipText("queued"))
        assertEquals("Paused", downloadChipText("paused"))
        assertEquals("Done", downloadChipText("complete"))
        assertEquals("Failed", downloadChipText("error"))
        assertEquals("Unknown", downloadChipText("weird"))
    }

    @Test fun percentIsClampedAndNullWhenSizeUnknown() {
        assertEquals(25, downloadPercent(item(total = 1000, done = 250)))
        assertEquals(100, downloadPercent(item(total = 1000, done = 5000)))
        assertEquals(0, downloadPercent(item(total = 1000, done = 0)))
        assertNull(downloadPercent(item(total = 0, done = 250)))
    }

    @Test fun etaReadsNaturally() {
        assertEquals("45 s", formatEta(45))
        assertEquals("3 min", formatEta(200))
        assertEquals("2 h 5 min", formatEta(7_500))
    }

    @Test fun activeDetailListsEverythingKnown() {
        val d = downloadDetail(item(total = 29_000_000, done = 12_300_000, speed = 3_200_000, eta = 300))
        assertEquals("42% • 11.7 MB of 27.7 MB • 3.1 MB/s • 5 min left", d)
    }

    @Test fun activeDetailLeavesOutWhatIsUnknown() {
        assertEquals("1.0 KB", downloadDetail(item(done = 1024)))
        assertEquals("50% • 500 B of 1000 B", downloadDetail(item(total = 1000, done = 500)))
    }

    @Test fun otherStatesHaveTheirOwnDetail() {
        assertEquals("Waiting to start", downloadDetail(item("queued")))
        assertEquals("Paused at 25% • 250 B", downloadDetail(item("paused", total = 1000, done = 250)))
        assertEquals("Paused", downloadDetail(item("paused")))
        assertEquals("1000 B", downloadDetail(item("complete", total = 1000, done = 1000)))
        assertEquals("Saved to Files", downloadDetail(item("complete")))
        assertEquals("File not found", downloadDetail(item("error", error = "File not found")))
        assertEquals("Download failed", downloadDetail(item("error")))
    }

    @Test fun buttonsFollowStatus() {
        assertTrue(canPause(item("active")))
        assertTrue(canPause(item("queued")))
        assertFalse(canPause(item("paused")))
        assertTrue(canResume(item("paused")))
        assertFalse(canResume(item("complete")))
        assertTrue(canRetry(item("error", engine = "ytdlp")))
        assertFalse(canRetry(item("error", engine = "aria2")))
        assertFalse(canRetry(item("active", engine = "ytdlp")))
    }

    @Test fun pollingSpeedsUpOnlyWhileSomethingRuns() {
        assertTrue(hasLiveDownloads(listOf(item("complete"), item("queued"))))
        assertFalse(hasLiveDownloads(listOf(item("complete"), item("paused"), item("error"))))
        assertFalse(hasLiveDownloads(emptyList()))
    }

    @Test fun linkDetection() {
        listOf(
            "https://example.com/a.zip", "  http://x.org/y  ", "ftp://f.example.com/z", "HTTPS://UPPER.COM/x",
            "magnet:?xt=urn:btih:abc&dn=Thing",
        ).forEach { assertTrue(it, looksLikeLink(it)) }
        listOf("", "example.com", "file:///etc/passwd", "javascript:alert(1)", "https://", "https://a b", "magnet:abc").forEach {
            assertFalse(it, looksLikeLink(it))
        }
    }

    @Test fun errorTextsAreHelpful() {
        assertTrue(downloadsErrorText(DownloadsResult.EngineMissing("aria2")).contains("pkg install aria2"))
        assertTrue(downloadsErrorText(DownloadsResult.EngineMissing("ytdlp")).contains("pip install -U yt-dlp"))
        assertEquals("Not enough free space on the Samsung server (1.0 KB left)", downloadsErrorText(DownloadsResult.LowSpace(1024)))
        assertEquals("Not enough free space on the Samsung server", downloadsErrorText(DownloadsResult.LowSpace(null)))
        assertTrue(downloadsErrorText(DownloadsResult.BadUrl).contains("magnet"))
        assertEquals("boom", downloadsErrorText(DownloadsResult.Failure("boom")))
    }
}
