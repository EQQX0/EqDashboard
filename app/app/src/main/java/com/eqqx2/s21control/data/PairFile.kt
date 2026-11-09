package com.eqqx2.s21control.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.InputStream

const val PAIR_MAX_BYTES = 4096

sealed interface PairResult {
    data class Ok(val url: String, val token: String) : PairResult
    data class Invalid(val reason: String) : PairResult
}

/** Reads at most [PAIR_MAX_BYTES] + 1 bytes; returns null when the file is larger than 4 KB. */
fun readPairText(input: InputStream): String? {
    val buf = ByteArray(PAIR_MAX_BYTES + 1)
    var n = 0
    while (n < buf.size) {
        val r = input.read(buf, n, buf.size - n)
        if (r < 0) break
        n += r
    }
    return if (n > PAIR_MAX_BYTES) null else String(buf, 0, n, Charsets.UTF_8)
}

/** Reasons never contain file content, so they are safe to show or log. */
fun parsePairFile(text: String): PairResult {
    if (text.length > PAIR_MAX_BYTES || text.toByteArray(Charsets.UTF_8).size > PAIR_MAX_BYTES) {
        return PairResult.Invalid("File is too large")
    }
    val obj = try {
        Json.parseToJsonElement(text.trim().removePrefix("﻿")) as? JsonObject
    } catch (_: Exception) {
        null
    } ?: return PairResult.Invalid("Not a JSON object")

    val v = (obj["v"] as? JsonPrimitive)?.takeIf { !it.isString }?.contentOrNull
    if (v != "1") return PairResult.Invalid("Unsupported version")

    val rawUrl = (obj["url"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
        ?: return PairResult.Invalid("Missing url")
    val parsed = rawUrl.toHttpUrlOrNull()
    if (parsed == null || parsed.scheme != "https" || parsed.host.isEmpty()) {
        return PairResult.Invalid("URL must be https with a host")
    }
    val url = rawUrl.trimEnd('/')

    val token = (obj["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
        ?: return PairResult.Invalid("Missing token")
    if (token.length !in 20..200 || token.any { it.code !in 0x21..0x7E }) {
        return PairResult.Invalid("Token has an invalid format")
    }
    return PairResult.Ok(url, token)
}
