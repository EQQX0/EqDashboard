package com.eqqx2.samsungserver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PathsTest {
    @Test fun joinWithEmptyDir() = assertEquals("a.txt", joinPath("", "a.txt"))
    @Test fun joinNested() = assertEquals("a/b/c.txt", joinPath("a/b", "c.txt"))
    @Test fun joinIgnoresStraySlashes() = assertEquals("a/b", joinPath("a/", "/b"))

    @Test fun parentOfRootIsRoot() = assertEquals("", parentOf(""))
    @Test fun parentOfOneLevelIsRoot() = assertEquals("", parentOf("a"))
    @Test fun parentOfNested() = assertEquals("a/b", parentOf("a/b/c"))

    @Test
    fun breadcrumbsForNestedPath() {
        assertEquals(
            listOf(Crumb(ROOT_LABEL, ""), Crumb("a", "a"), Crumb("b", "a/b"), Crumb("c", "a/b/c")),
            breadcrumbs("a/b/c"),
        )
    }

    @Test fun breadcrumbsForRoot() = assertEquals(listOf(Crumb(ROOT_LABEL, "")), breadcrumbs(""))

    @Test
    fun nameValidation() {
        assertNull(validateEntryName("photo 1.jpg"))
        assertNotNull(validateEntryName(""))
        assertNotNull(validateEntryName("   "))
        assertNotNull(validateEntryName("."))
        assertNotNull(validateEntryName(".."))
        assertNotNull(validateEntryName("a/b"))
        assertNotNull(validateEntryName("a\\b"))
    }
}
