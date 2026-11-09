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
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

@Serializable
data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val size: Long,
    val notes: String = "",
    val publishedAt: String? = null,
)

sealed interface UpdateCheck {
    data object UpToDate : UpdateCheck
    data class Available(val info: UpdateInfo) : UpdateCheck
    data object Unauthorized : UpdateCheck
    data object NotConfigured : UpdateCheck
    data object NoRelease : UpdateCheck
    data object RateLimited : UpdateCheck
    data class Failure(val message: String) : UpdateCheck
}

sealed interface ApkUrlResult {
    data class Ok(val url: String) : ApkUrlResult
    data object Unauthorized : ApkUrlResult
    data object NotConfigured : ApkUrlResult
    data object NotFound : ApkUrlResult
    data object RateLimited : ApkUrlResult
    data class Failure(val message: String) : ApkUrlResult
}

sealed interface DownloadResult {
    data class Ok(val file: File) : DownloadResult
    data object HashMismatch : DownloadResult
    data object SizeMismatch : DownloadResult
    data class Failure(val message: String) : DownloadResult
}

fun isNewer(installed: Int, candidate: Int): Boolean = candidate > installed

private val updateJson = Json { ignoreUnknownKeys = true }
private const val UPDATE_CHUNK = 64 * 1024

class UpdateClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    /** APK download: stall timeout only (the user can cancel), no whole-call cap. */
    private val transfer: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .build()

    /** Never throws (except cancellation). */
    suspend fun check(baseUrl: String, token: String, installedVersionCode: Int): UpdateCheck {
        return when (val r = get(baseUrl, token, "api/latest", null)) {
            is Raw.Err -> UpdateCheck.Failure(r.message)
            is Raw.Resp -> when (r.code) {
                200 -> try {
                    val info = updateJson.decodeFromString(UpdateInfo.serializer(), r.body)
                    if (isNewer(installedVersionCode, info.versionCode)) UpdateCheck.Available(info)
                    else UpdateCheck.UpToDate
                } catch (e: Exception) {
                    UpdateCheck.Failure("Unexpected response from update server")
                }
                401 -> UpdateCheck.Unauthorized
                404 -> if (errorCode(r.body) == "no_release") UpdateCheck.NoRelease
                else UpdateCheck.Failure("Update server returned HTTP 404")
                429 -> UpdateCheck.RateLimited
                503 -> if (errorCode(r.body) == "not_configured") UpdateCheck.NotConfigured
                else UpdateCheck.Failure("Update server returned HTTP 503")
                else -> UpdateCheck.Failure("Update server returned HTTP ${r.code}")
            }
        }
    }

    suspend fun resolveApkUrl(baseUrl: String, token: String, versionCode: Int): ApkUrlResult {
        return when (val r = get(baseUrl, token, "api/apk", versionCode)) {
            is Raw.Err -> ApkUrlResult.Failure(r.message)
            is Raw.Resp -> when (r.code) {
                200 -> try {
                    val url = updateJson.parseToJsonElement(r.body).jsonObject["url"]
                        ?.jsonPrimitive?.contentOrNull
                    if (url.isNullOrBlank()) ApkUrlResult.Failure("Unexpected response from update server")
                    else ApkUrlResult.Ok(url)
                } catch (e: Exception) {
                    ApkUrlResult.Failure("Unexpected response from update server")
                }
                401 -> ApkUrlResult.Unauthorized
                404 -> ApkUrlResult.NotFound
                429 -> ApkUrlResult.RateLimited
                503 -> ApkUrlResult.NotConfigured
                else -> ApkUrlResult.Failure("Update server returned HTTP ${r.code}")
            }
        }
    }

    /**
     * Streams [url] (no Authorization header) to `dest.part`, hashing as it goes. The file is
     * renamed to [dest] only if size and SHA-256 both match; otherwise the partial file is deleted.
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
                    val request = Request.Builder().url(url.toHttpUrl()).build()
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
        data class Resp(val code: Int, val body: String) : Raw
        data class Err(val message: String) : Raw
    }

    private suspend fun get(baseUrl: String, token: String, endpoint: String, versionCode: Int?): Raw =
        withContext(Dispatchers.IO) { coroutineScope {
            var call: Call? = null
            val watcher = launch { try { awaitCancellation() } finally { call?.cancel() } }
            try {
                val url = baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder()
                    .addPathSegments(endpoint)
                    .apply { if (versionCode != null) addQueryParameter("versionCode", versionCode.toString()) }
                    .build()
                val request = Request.Builder().url(url)
                    .header("Authorization", "Bearer " + token.trim()).build()
                val c = api.newCall(request)
                call = c
                c.execute().use { Raw.Resp(it.code, it.body?.string().orEmpty()) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: IllegalArgumentException) {
                Raw.Err("Invalid update server address")
            } catch (e: IOException) {
                Raw.Err("Can't reach the update server. Check your connection.")
            } catch (e: Exception) {
                Raw.Err(e.message ?: "Could not reach update server")
            } finally {
                watcher.cancel()
            }
        } }

    private fun errorCode(body: String): String? = try {
        updateJson.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
    } catch (e: Exception) {
        null
    }
}
