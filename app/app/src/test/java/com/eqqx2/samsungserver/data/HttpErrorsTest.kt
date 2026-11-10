package com.eqqx2.samsungserver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpErrorsTest {
    @Test fun otherCodesUnchanged() {
        assertEquals("Server returned HTTP 500", httpFailureText(500, null))
        assertEquals("Server returned HTTP 502", httpFailureText(502, "error code: 1033"))
    }

    @Test fun code530WithoutBody() {
        val t = httpFailureText(530, null)
        assertTrue(t.startsWith("Server unreachable (tunnel offline)."))
        assertTrue(t.contains("tunnel-doctor.js --probe"))
        assertFalse(t.contains("1033"))
    }

    @Test fun code530With1033() {
        val t = httpFailureText(530, "error code: 1033")
        assertTrue(t.endsWith(" (error 1033)"))
    }
}
