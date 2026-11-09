package com.eqqx2.s21control.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val size: Long,
    val notes: String = "",
    val publishedAt: String? = null,
    val apkUrl: String,
)

@Serializable
private data class UpdateMeta(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val size: Long,
    val notes: String = "",
)

sealed interface UpdateCheck {
    data object UpToDate : UpdateCheck
    data class Available(val info: UpdateInfo) : UpdateCheck
    data object NoRelease : UpdateCheck
    data object RateLimited : UpdateCheck
    data class Failure(val message: String) : UpdateCheck
}

sealed interface DownloadResult {
    data class Ok(val file: File) : DownloadResult
    data object HashMismatch : DownloadResult
    data object SizeMismatch : DownloadResult
    data class Failure(val message: String) : DownloadResult
}

fun isNewer(installed: Int, candidate: Int): Boolean = candidate > installed

/** True only for https URLs on api.github.com, github.com or *.githubusercontent.com. */
fun isAllowedUpdateUrl(url: HttpUrl): Boolean {
    if (url.scheme != "https") return false
    val h = url.host.lowercase()
    return h == "api.github.com" || h == "github.com" || h.endsWith(".githubusercontent.com")
}

private val updateJson = Json { ignoreUnknownKeys = true }
private const val UPDATE_CHUNK = 64 * 1024
private const val USER_AGENT = "S21Control-Updater"
private const val API_MAX_BYTES = 1024L * 1024
private const val META_MAX_BYTES = 16L * 1024

class UpdateClient(
    http: OkHttpClient = OkHttpClient(),
    private val apiBase: String = "https://api.github.com",
    /** Tests only: replaces the production host allowlist. */
    private val isAllowed: (HttpUrl) -> Boolean = ::isAllowedUpdateUrl,
) {
    /**
     * Network interceptor: runs for the first request and every redirect hop, so a redirect that
     * leaves the allowlist fails the call. It also strips any Authorization header, so no
     * credential can ever reach an update host.
     */
    private val guard = Interceptor { chain ->
        val req = chain.request()
        if (!isAllowed(req.url)) throw IOException("Blocked: untrusted update host")
        chain.proceed(req.newBuilder().removeHeader("Authorization").build())
    }

    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .addNetworkInterceptor(guard)
        .build()

    /** APK download: stall timeout only (the user can cancel), no whole-call cap. */
    private val transfer: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .addNetworkInterceptor(guard)
        .build()

    /** Never throws (except cancellation). Sends no credentials. */
    suspend fun check(repo: String, installedVersionCode: Int): UpdateCheck {
        val releaseUrl = apiBase.trim().trimEnd('/') + "/repos/" + repo.trim() + "/releases/latest"
        val r = when (val x = get(releaseUrl, API_MAX_BYTES, json = true)) {
            is Raw.Err -> return UpdateCheck.Failure(x.message)
            is Raw.Resp -> x
        }
        if (r.code == 404) return UpdateCheck.NoRelease
        if (r.code == 403 || r.code == 429 || (r.code !in 200..299 && r.remaining == "0")) {
            return UpdateCheck.RateLimited
        }
        if (r.code !in 200..299) return UpdateCheck.Failure("GitHub returned HTTP ${r.code}")
        val bad = UpdateCheck.Failure("Unexpected response from GitHub")
        val root = try { updateJson.parseToJsonElement(r.body).jsonObject } catch (e: Exception) { return bad }
        fun flag(k: String) = try { root[k]?.jsonPrimitive?.booleanOrNull ?: false } catch (e: Exception) { false }
        if (flag("draft") || flag("prerelease")) return UpdateCheck.NoRelease
        val assets = try {
            root["assets"]?.jsonArray.orEmpty().map { it.jsonObject }
        } catch (e: Exception) {
            return bad
        }
        fun assetUrl(name: String) = assets
            .firstOrNull { it["name"]?.jsonPrimitive?.contentOrNull == name }
            ?.get("browser_download_url")?.jsonPrimitive?.contentOrNull
        val metaUrl = assetUrl("meta.json")
        val apkUrl = assetUrl("app.apk")
        if (metaUrl.isNullOrBlank() || apkUrl.isNullOrBlank()) return UpdateCheck.NoRelease
        val apkHttp = apkUrl.toHttpUrlOrNull()
        if (apkHttp == null || !isAllowed(apkHttp)) {
            return UpdateCheck.Failure("Release points to an untrusted download address")
        }
        val m = when (val x = get(metaUrl, META_MAX_BYTES, json = false)) {
            is Raw.Err -> return UpdateCheck.Failure(x.message)
            is Raw.Resp -> x
        }
        if (m.code == 403 || m.code == 429) return UpdateCheck.RateLimited
        if (m.code !in 200..299) return UpdateCheck.Failure("GitHub returned HTTP ${m.code}")
        val meta = try {
            updateJson.decodeFromString(UpdateMeta.serializer(), m.body)
        } catch (e: Exception) {
            return bad
        }
        if (!isNewer(installedVersionCode, meta.versionCode)) return UpdateCheck.UpToDate
        return UpdateCheck.Available(
            UpdateInfo(
                versionCode = meta.versionCode,
                versionName = meta.versionName,
                sha256 = meta.sha256,
                size = meta.size,
                notes = meta.notes,
                publishedAt = try { root["published_at"]?.jsonPrimitive?.contentOrNull } catch (e: Exception) { null },
                apkUrl = apkUrl,
            )
        )
    }

    /**
     * Streams [url] (no Authorization header, allowlisted hosts only) to `dest.part`, hashing as it
     * goes. The file is renamed to [dest] only if size and SHA-256 both match; otherwise the
     * partial file is deleted.
     */
    suspend fun download(
        url: String,
        dest: File,
        expectedSha256: String,
        expectedSize: Long,
        onProgress: (Long) -> Unit,
    ): DownloadResult = withContext(Dispatchers.IO) {
        val part = File(dest.path + ".part")
        var success = false
        try {
            coroutineScope {
                var call: Call? = null
                val watcher = launch { try { awaitCancellation() } finally { call?.cancel() } }
                try {
                    val httpUrl = url.toHttpUrl()
                    if (!isAllowed(httpUrl)) {
                        return@coroutineScope DownloadResult.Failure("Blocked: untrusted download address")
                    }
                    val request = Request.Builder().url(httpUrl).header("User-Agent", USER_AGENT).build()
                    val c = transfer.newCall(request)
                    call = c
                    c.execute().use { resp ->
                        if (!resp.isSuccessful) {
                            return@coroutineScope DownloadResult.Failure("Download failed (HTTP ${resp.code})")
                        }
                        val body = resp.body ?: return@coroutineScope DownloadResult.Failure("Empty download")
                        val declared = body.contentLength()
                        if (declared > expectedSize) return@coroutineScope DownloadResult.SizeMismatch
                        dest.parentFile?.mkdirs()
                        val digest = MessageDigest.getInstance("SHA-256")
                        var total = 0L
                        part.outputStream().use { out ->
                            body.byteStream().use { input ->
                                val buf = ByteArray(UPDATE_CHUNK)
                                while (true) {
                                    ensureActive()
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    total += n
                                    if (total > expectedSize) return@coroutineScope DownloadResult.SizeMismatch
                                    digest.update(buf, 0, n)
                                    out.write(buf, 0, n)
                                    onProgress(total)
                                }
                            }
                        }
                        if (total != expectedSize) return@coroutineScope DownloadResult.SizeMismatch
                        val actual = digest.digest().joinToString("") { b -> "%02x".format(b) }
                        if (!actual.equals(expectedSha256.trim(), ignoreCase = true)) {
                            return@coroutineScope DownloadResult.HashMismatch
                        }
                        dest.delete()
                        if (!part.renameTo(dest)) {
                            return@coroutineScope DownloadResult.Failure("Could not save the download")
                        }
                        success = true
                        DownloadResult.Ok(dest)
                    }
                } finally {
                    watcher.cancel()
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            DownloadResult.Failure("Invalid download address")
        } catch (e: IOException) {
            DownloadResult.Failure(e.message ?: "Download interrupted")
        } catch (e: Exception) {
            DownloadResult.Failure(e.message ?: "Download failed")
        } finally {
            if (!success) {
                part.delete()
                dest.delete()
            }
        }
    }

    private sealed interface Raw {
        data class Resp(val code: Int, val body: String, val remaining: String?) : Raw
        data class Err(val message: String) : Raw
    }

    private suspend fun get(url: String, maxBytes: Long, json: Boolean): Raw =
        withContext(Dispatchers.IO) { coroutineScope {
            var call: Call? = null
            val watcher = launch { try { awaitCancellation() } finally { call?.cancel() } }
            try {
                val httpUrl = url.toHttpUrl()
                if (!isAllowed(httpUrl)) return@coroutineScope Raw.Err("Blocked: untrusted update host")
                val rb = Request.Builder().url(httpUrl).header("User-Agent", USER_AGENT)
                if (json) rb.header("Accept", "application/vnd.github+json")
                val c = api.newCall(rb.build())
                call = c
                c.execute().use { resp ->
                    val remaining = resp.header("X-RateLimit-Remaining")
                    if (!resp.isSuccessful) return@use Raw.Resp(resp.code, "", remaining)
                    val src = resp.body?.source() ?: return@use Raw.Resp(resp.code, "", remaining)
                    src.request(maxBytes + 1)
                    if (src.buffer.size > maxBytes) return@use Raw.Err("Unexpected response from GitHub")
                    Raw.Resp(resp.code, src.buffer.readUtf8(), remaining)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: IllegalArgumentException) {
                Raw.Err("Invalid update address")
            } catch (e: IOException) {
                Raw.Err("Can't reach GitHub. Check your connection.")
            } catch (e: Exception) {
                Raw.Err(e.message ?: "Could not reach GitHub")
            } finally {
                watcher.cancel()
            }
        } }
}
