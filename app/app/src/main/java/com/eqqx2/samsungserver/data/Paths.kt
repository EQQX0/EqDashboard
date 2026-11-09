package com.eqqx2.samsungserver.data

/** A breadcrumb segment: label to show and the cloud-relative path it opens. */
data class Crumb(val label: String, val path: String)

const val ROOT_LABEL = "Cloud"

/** Joins a cloud-relative directory and a child name; "" is the root. */
fun joinPath(dir: String, name: String): String {
    val d = dir.trim('/')
    val n = name.trim('/')
    return when {
        d.isEmpty() -> n
        n.isEmpty() -> d
        else -> "$d/$n"
    }
}

/** Parent directory of a cloud-relative path; the root's parent is the root. */
fun parentOf(path: String): String {
    val p = path.trim('/')
    val i = p.lastIndexOf('/')
    return if (i < 0) "" else p.substring(0, i)
}

/** Root first, then one crumb per segment: "a/b" gives Cloud, a, b. */
fun breadcrumbs(path: String): List<Crumb> {
    val out = mutableListOf(Crumb(ROOT_LABEL, ""))
    var acc = ""
    for (seg in path.split('/').filter { it.isNotEmpty() }) {
        acc = joinPath(acc, seg)
        out += Crumb(seg, acc)
    }
    return out
}

/** Returns an error message, or null when [name] is a valid single path segment. */
fun validateEntryName(name: String): String? {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Enter a name"
        n == "." || n == ".." -> "That name is not allowed"
        n.contains('/') || n.contains('\\') -> "Name cannot contain / or \\"
        else -> null
    }
}
