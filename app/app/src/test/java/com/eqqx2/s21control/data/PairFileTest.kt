package com.eqqx2.s21control.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairFileTest {
    private val tok = "abcdefghij0123456789XYZ"

    private fun file(v: String = "1", url: String = "https://api.example.com", token: String = tok) =
        """{"v":$v,"url":"$url","token":"$token"}"""

    @Test fun valid() =
        assertEquals(PairResult.Ok("https://api.example.com", tok), parsePairFile(file()))

    @Test fun httpRejected() = assertTrue(parsePairFile(file(url = "http://api.example.com")) is PairResult.Invalid)

    @Test fun missingHostRejected() = assertTrue(parsePairFile(file(url = "https://")) is PairResult.Invalid)

    @Test fun missingToken() =
        assertTrue(parsePairFile("""{"v":1,"url":"https://a.example.com"}""") is PairResult.Invalid)

    @Test fun versionTwoRejected() = assertTrue(parsePairFile(file(v = "2")) is PairResult.Invalid)

    @Test fun oversizedRejected() {
        val big = file(token = "a".repeat(5000))
        assertTrue(parsePairFile(big) is PairResult.Invalid)
    }

    @Test fun trailingSlashStripped() =
        assertEquals(PairResult.Ok("https://api.example.com", tok), parsePairFile(file(url = "https://api.example.com/")))

    @Test fun tokenTrimmed() =
        assertEquals(PairResult.Ok("https://api.example.com", tok), parsePairFile(file(token = "  $tok \\n")))

    @Test fun tokenWithSpacesRejected() =
        assertTrue(parsePairFile(file(token = "abcdefghij 0123456789XYZ")) is PairResult.Invalid)

    @Test fun shortTokenRejected() = assertTrue(parsePairFile(file(token = "short")) is PairResult.Invalid)

    @Test fun invalidJson() {
        assertTrue(parsePairFile("not json {") is PairResult.Invalid)
        assertTrue(parsePairFile("[1,2]") is PairResult.Invalid)
    }

    @Test fun reasonNeverContainsToken() {
        val r = parsePairFile(file(url = "http://x.example.com")) as PairResult.Invalid
        assertTrue(!r.reason.contains(tok))
    }

    @Test fun readerStopsAtLimit() {
        assertNull(readPairText(ByteArray(PAIR_MAX_BYTES + 1) { 'a'.code.toByte() }.inputStream()))
        assertEquals("hi", readPairText("hi".toByteArray().inputStream()))
    }
}
