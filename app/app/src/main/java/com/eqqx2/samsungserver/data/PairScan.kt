package com.eqqx2.samsungserver.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.InputStream

data class PairCandidate(
    val id: String,
    val name: String,
    val size: Long,
    val modified: Long,
    val isDir: Boolean,
)

data class FoundPair(val id: String, val url: String, val token: String, val modified: Long) {
    override fun toString() = "FoundPair(id=$id, url=$url, token=<hidden>, modified=$modified)"
}

/** Newest valid *.pair candidate, or null. Every per-file failure is skipped. */
fun pickPairFile(cands: List<PairCandidate>, open: (PairCandidate) -> InputStream?): FoundPair? {
    val eligible = cands
        .filter { !it.isDir && isPairFileName(it.name) && it.size in 1..PAIR_MAX_BYTES.toLong() }
        .sortedByDescending { it.modified }
    for (c in eligible) {
        try {
            val text = open(c)?.use { readPairText(it) } ?: continue
            val r = parsePairFile(text)
            if (r is PairResult.Ok) return FoundPair(c.id, r.url, r.token, c.modified)
        } catch (_: Exception) {
            // unreadable or invalid, try the next
        }
    }
    return null
}

/** Host only, for display; empty when the URL does not parse. */
fun foundHost(url: String): String = url.trim().toHttpUrlOrNull()?.host ?: ""
