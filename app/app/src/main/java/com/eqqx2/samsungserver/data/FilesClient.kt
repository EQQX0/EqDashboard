package com.eqqx2.samsungserver.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.TimeUnit

@Serializable
data class FileEntry(
    val name: String,
    val type: String,
    val size: Long = 0,
    val modified: String = "",
) {
    val isDir: Boolean get() = type == "dir"
}

@Serializable
data class FileListing(val path: String = "", val entries: List<FileEntry> = emptyList())

data class UploadReceipt(val name: String, val size: Long)

sealed interface FilesResult<out T> {
    data class Ok<T>(val value: T) : FilesResult<T>
    data object Unauthorized : FilesResult<Nothing>
    data object RateLimited : FilesResult<Nothing>
    data object Conflict : FilesResult<Nothing>
    data object TooLarge : FilesResult<Nothing>
    data object NotFound : FilesResult<Nothing>
    data class Failure(val message: String) : FilesResult<Nothing>
}

private val filesJson = Json { ignoreUnknownKeys = true }
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
private val BINARY_MEDIA = "application/octet-stream".toMediaType()
private const val CHUNK = 64 * 1024

class FilesClient(http: OkHttpClient = OkHttpClient()) {
    /** Short calls: list, mkdir, rename, delete. */
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Transfers: no read/write/call caps (the user can cancel). */
    private val transfer: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    suspend fun list(baseUrl: String, token: String, path: String): FilesResult<FileListing> =
        run(api, baseUrl, token, "files/list", { addQueryParameter("path", path) }, { it }) { resp ->
            FilesResult.Ok(filesJson.decodeFromString(FileListing.serializer(), resp.body?.string().orEmpty()))
        }

    suspend fun mkdir(baseUrl: String, token: String, path: String): FilesResult<Unit> =
        run(
            api, baseUrl, token, "files/mkdir", {},
            { it.post(jsonBody(buildJsonObject { put("path", JsonPrimitive(path)) })) },
        ) { FilesResult.Ok(Unit) }

    suspend fun rename(baseUrl: String, token: String, from: String, to: String): FilesResult<Unit> =
        run(
            api, baseUrl, token, "files/rename", {},
            {
                it.post(
                    jsonBody(buildJsonObject {
                        put("from", JsonPrimitive(from))
                        put("to", JsonPrimitive(to))
                    })
                )
            },
        ) { FilesResult.Ok(Unit) }

    suspend fun delete(baseUrl: String, token: String, path: String): FilesResult<Unit> =
        run(api, baseUrl, token, "files", { addQueryParameter("path", path) }, { it.delete() }) {
            FilesResult.Ok(Unit)
        }

    /** Streams [source] as the raw request body; [length] null means unknown (chunked). */
    suspend fun upload(
        baseUrl: String,
        token: String,
        dir: String,
        name: String,
        overwrite: Boolean,
        source: () -> InputStream,
        length: Long?,
        onProgress: (Long) -> Unit,
    ): FilesResult<UploadReceipt> {
        val body = object : RequestBody() {
            override fun contentType() = BINARY_MEDIA
            override fun contentLength(): Long = length ?: -1L
            override fun isOneShot(): Boolean = true
            override fun writeTo(sink: BufferedSink) {
                source().use { input ->
                    val buf = ByteArray(CHUNK)
                    var sent = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        sink.write(buf, 0, n)
                        sent += n
                        onProgress(sent)
                    }
                }
            }
        }
        return run(
            transfer, baseUrl, token, "files/upload",
            {
                addQueryParameter("path", dir)
                addQueryParameter("name", name)
                if (overwrite) addQueryParameter("overwrite", "1")
            },
            { it.put(body) },
        ) { resp ->
            val obj = filesJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
            val size = obj["size"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: length ?: 0L
            FilesResult.Ok(UploadReceipt(obj["name"]?.jsonPrimitive?.contentOrNull ?: name, size))
        }
    }

    /** Streams the response body into [sink] (not closed here); returns bytes written. */
    suspend fun download(
        baseUrl: String,
        token: String,
        path: String,
        sink: OutputStream,
        onProgress: (Long) -> Unit,
    ): FilesResult<Long> =
        run(transfer, baseUrl, token, "files/download", { addQueryParameter("path", path) }, { it }) { resp ->
            val body = resp.body ?: return@run FilesResult.Failure("Empty response from server")
            var total = 0L
            body.byteStream().use { input ->
                val buf = ByteArray(CHUNK)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    sink.write(buf, 0, n)
                    total += n
                    onProgress(total)
                }
            }
            sink.flush()
            FilesResult.Ok(total)
        }

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(JSON_MEDIA)

    private suspend fun <T> run(
        http: OkHttpClient,
        baseUrl: String,
        token: String,
        endpoint: String,
        query: HttpUrl.Builder.() -> Unit,
        method: (Request.Builder) -> Request.Builder,
        onOk: (Response) -> FilesResult<T>,
    ): FilesResult<T> = withContext(Dispatchers.IO) { coroutineScope {
        var call: Call? = null
        // Cancelling the coroutine cancels the in-flight OkHttp call, unblocking execute()/reads.
        val watcher = launch {
            try { awaitCancellation() } finally { call?.cancel() }
        }
        try {
            val url = baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder()
                .addPathSegments(endpoint).apply(query).build()
            val request = method(
                Request.Builder().url(url).header("Authorization", "Bearer " + token.trim())
            ).build()
            val c = http.newCall(request)
            call = c
            c.execute().use { resp ->
                when {
                    resp.code == 401 -> FilesResult.Unauthorized
                    resp.code == 429 -> FilesResult.RateLimited
                    resp.isSuccessful -> onOk(resp)
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            FilesResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            FilesResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            FilesResult.Failure(e.message ?: "Could not reach server")
        } finally {
            watcher.cancel()
        }
    } }

    private fun mapError(resp: Response): FilesResult<Nothing> {
        val code = try {
            filesJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject["error"]
                ?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
        return when {
            resp.code == 409 || code == "exists" -> FilesResult.Conflict
            resp.code == 413 || code == "too_large" -> FilesResult.TooLarge
            resp.code == 404 || code == "not_found" -> FilesResult.NotFound
            else -> FilesResult.Failure(
                when (code) {
                    "bad_path" -> "That path is not valid"
                    "not_a_directory" -> "That is not a folder"
                    "is_a_directory" -> "That is a folder"
                    else -> "Server returned HTTP ${resp.code}"
                }
            )
        }
    }
}
