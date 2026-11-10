package com.eqqx2.samsungserver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

class PairScanTest {
    private val tok = "abcdefghij0123456789XYZ"
    private fun good(host: String = "api.example.com") = """{"v":1,"url":"https://$host","token":"$tok"}"""
    private fun cand(id: String, name: String = "$id.pair", size: Long = 100, mod: Long = 1, dir: Boolean = false) =
        PairCandidate(id, name, size, mod, dir)

    private fun opener(map: Map<String, String>): (PairCandidate) -> java.io.InputStream? =
        { c -> map[c.id]?.let { ByteArrayInputStream(it.toByteArray()) } }

    @Test fun txtAndBakRejected() {
        val cs = listOf(cand("a", "a.txt"), cand("b", "b.pair.bak"))
        assertNull(pickPairFile(cs, opener(mapOf("a" to good(), "b" to good()))))
    }

    @Test fun oversizedRejected() {
        assertNull(pickPairFile(listOf(cand("a", size = 5000)), opener(mapOf("a" to good()))))
    }

    @Test fun zeroSizeRejected() {
        assertNull(pickPairFile(listOf(cand("a", size = 0)), opener(mapOf("a" to good()))))
    }

    @Test fun newestValidBeatsNewerInvalid() {
        val cs = listOf(cand("old", mod = 1), cand("bad", mod = 9), cand("mid", mod = 5))
        val r = pickPairFile(cs, opener(mapOf("old" to good("old.example.com"), "bad" to "nope", "mid" to good("mid.example.com"))))
        assertEquals("mid", r?.id)
        assertEquals("https://mid.example.com", r?.url)
    }

    @Test fun directorySkipped() {
        assertNull(pickPairFile(listOf(cand("d", dir = true)), opener(mapOf("d" to good()))))
    }

    @Test fun openThrowingSkipped() {
        val cs = listOf(cand("boom", mod = 9), cand("ok", mod = 1))
        val r = pickPairFile(cs) { c -> if (c.id == "boom") throw IOException("x") else ByteArrayInputStream(good().toByteArray()) }
        assertEquals("ok", r?.id)
    }

    @Test fun emptyListNull() = assertNull(pickPairFile(emptyList()) { null })

    @Test fun toStringHidesToken() {
        val r = pickPairFile(listOf(cand("a")), opener(mapOf("a" to good())))!!
        assertFalse(r.toString().contains(tok))
        assertTrue(r.token == tok)
    }

    @Test fun hostOnly() = assertEquals("api.example.com", foundHost("https://api.example.com:8443/x"))
}
