package com.eqqx2.s21control.ui

import com.eqqx2.s21control.data.CheckResult
import com.eqqx2.s21control.data.SiteInfo
import com.eqqx2.s21control.data.isValidSiteName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SitesStatusTest {
    @Test fun validNames() {
        listOf("blog", "a", "my-site", "site2", "0day", "a".repeat(32)).forEach { assertTrue(it, isValidSiteName(it)) }
    }

    @Test fun invalidNames() {
        assertFalse(isValidSiteName("Blog"))
        assertFalse(isValidSiteName("-blog"))
        assertFalse(isValidSiteName("blog-"))
        assertFalse(isValidSiteName("a".repeat(33)))
        assertFalse(isValidSiteName(""))
        assertFalse(isValidSiteName("my_site"))
        assertFalse(isValidSiteName("café"))
        assertFalse(isValidSiteName("日本"))
        assertFalse(isValidSiteName("a b"))
    }

    @Test fun reservedNamesRejected() {
        listOf("api", "www", "admin", "sites", "ns1", "vercel", "cdn").forEach { assertFalse(it, isValidSiteName(it)) }
    }

    @Test fun chipTextFromCheckResults() {
        val live = reachFromCheck(CheckResult("h", true, 200, null))
        val dns = reachFromCheck(CheckResult("h", false, null, "dns"))
        assertEquals("Live", siteChipText(true, live))
        assertEquals("Not reachable yet", siteChipText(true, dns))
        assertEquals("Checking", siteChipText(true, SiteReach.Checking))
        assertEquals("Checking", siteChipText(true, SiteReach.Unknown))
        assertEquals("Offline", siteChipText(false, live))
        assertEquals(SiteReach.NotReady("http_502"), reachFromCheck(CheckResult("h", false, 502, "http_502")))
    }

    @Test fun setupHelpOnlyWhenNothingLiveAndSetupReason() {
        val a = SiteInfo("a", "a.x.com")
        val b = SiteInfo("b", "b.x.com")
        assertTrue(needsSetupHelp(listOf(a), mapOf("a" to SiteReach.NotReady("dns"))))
        assertFalse(needsSetupHelp(listOf(a), mapOf("a" to SiteReach.NotReady("http_502"))))
        assertFalse(needsSetupHelp(listOf(a, b), mapOf("a" to SiteReach.NotReady("dns"), "b" to SiteReach.Live)))
        assertFalse(needsSetupHelp(listOf(a), mapOf("a" to SiteReach.Checking)))
        assertFalse(needsSetupHelp(listOf(a.copy(enabled = false)), mapOf("a" to SiteReach.NotReady("dns"))))
    }

    @Test fun metaLine() {
        val now = java.time.Instant.parse("2026-11-01T12:00:00Z").toEpochMilli()
        val s = SiteInfo("a", "a.x.com", files = 12, bytes = 345_678, modified = "2026-11-01T10:00:00Z")
        assertEquals("12 files • 337.6 KB • updated 2 h ago", siteMeta(s, now))
        assertEquals("1 file • 0 B", siteMeta(SiteInfo("a", files = 1), now))
    }
}
