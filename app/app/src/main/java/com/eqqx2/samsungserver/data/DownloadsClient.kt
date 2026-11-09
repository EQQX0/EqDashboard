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
import kotlinx.serialization.json.longOrNull
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

/** One download. [status] is queued, active, paused, complete or error. */
@Serializable
data class DownloadItem(
    val id: String,
    val engine: String = "",
    val source: String = "",
    val name: String = "",
    val status: String = "queued",
    val totalBytes: Long = 0,
    val doneBytes: Long = 0,
    val speedBps: Long = 0,
    val etaSec: Long? = null,
    val error: String? = null,
    val path: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class DownloadEngines(val aria2: Boolean = false, val ytdlp: Boolean = false)

@Serializable
data class DownloadsListing(
    val dir: String = "downloads",
    val engines: DownloadEngines = DownloadEngines(),
    val freeBytes: Long? = null,
    val items: List<DownloadItem> = emptyList(),
)

@Serializable
data class DownloadEnvelope(val item: DownloadItem)

/** How the agent should fetch a link. [wire] is the value the API expects. */
enum class DownloadMode(val wire: String, val label: String) {
    Auto("auto", "Auto"),
    Video("video", "Video"),
    Audio("audio", "Audio"),
    File("direct", "File"),
}

sealed interface DownloadsResult<out T> {
    data class Ok<T>(val value: T) : DownloadsResult<T>
    data object Unauthorized : DownloadsResult<Nothing>
    data object RateLimited : DownloadsResult<Nothing>
    data object BadUrl : DownloadsResult<Nothing>
    data object Blocked : DownloadsResult<Nothing>
    data object NotFound : DownloadsResult<Nothing>
    data class EngineMissing(val engine: String) : DownloadsResult<Nothing>
    data class LowSpace(val freeBytes: Long?) : DownloadsResult<Nothing>
    data object EngineError : DownloadsResult<Nothing>
    data class Failure(val message: String) : DownloadsResult<Nothing>
}

private val dlJson = Json { ignoreUnknownKeys = true }
private val DL_JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

class DownloadsClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun list(baseUrl: String, token: String): DownloadsResult<DownloadsListing> =
        run(baseUrl, token, "downloads/list", {}, { it }) { resp ->
            DownloadsResult.Ok(dlJson.decodeFromString(DownloadsListing.serializer(), resp.body?.string().orEmpty()))
        }

    suspend fun add(baseUrl: String, token: String, url: String, mode: DownloadMode): DownloadsResult<DownloadItem> =
        run(
            baseUrl, token, "downloads/add", {},
            {
                it.post(
                    jsonBody(buildJsonObject {
                        put("url", JsonPrimitive(url))
                        put("mode", JsonPrimitive(mode.wire))
                    })
                )
            },
        ) { resp ->
            DownloadsResult.Ok(dlJson.decodeFromString(DownloadEnvelope.serializer(), resp.body?.string().orEmpty()).item)
        }

    suspend fun pause(baseUrl: String, token: String, id: String): DownloadsResult<Unit> =
        run(baseUrl, token, "downloads/pause", {}, { it.post(idBody(id)) }) { DownloadsResult.Ok(Unit) }

    suspend fun resume(baseUrl: String, token: String, id: String): DownloadsResult<Unit> =
        run(baseUrl, token, "downloads/resume", {}, { it.post(idBody(id)) }) { DownloadsResult.Ok(Unit) }

    /** Forgets the download. The agent deletes partial files and keeps finished ones. */
    suspend fun remove(baseUrl: String, token: String, id: String): DownloadsResult<Unit> =
        run(baseUrl, token, "downloads", { addQueryParameter("id", id) }, { it.delete() }) { DownloadsResult.Ok(Unit) }

    private fun idBody(id: String): RequestBody = jsonBody(buildJsonObject { put("id", JsonPrimitive(id)) })

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(DL_JSON_MEDIA)

    private suspend fun <T> run(
        baseUrl: String,
        token: String,
        endpoint: String,
        query: HttpUrl.Builder.() -> Unit,
        method: (Request.Builder) -> Request.Builder,
        onOk: (Response) -> DownloadsResult<T>,
    ): DownloadsResult<T> = withContext(Dispatchers.IO) { coroutineScope {
        var call: Call? = null
        val watcher = launch {
            try { awaitCancellation() } finally { call?.cancel() }
        }
        try {
            val url = baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder()
                .addPathSegments(endpoint).apply(query).build()
            val request = method(
                Request.Builder().url(url).header("Authorization", "Bearer " + token.trim())
            ).build()
            val c = api.newCall(request)
            call = c
            c.execute().use { resp ->
                when {
                    resp.code == 401 -> DownloadsResult.Unauthorized
                    resp.code == 429 -> DownloadsResult.RateLimited
                    resp.isSuccessful -> onOk(resp)
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            DownloadsResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            DownloadsResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            DownloadsResult.Failure(e.message ?: "Could not reach server")
        } finally {
            watcher.cancel()
        }
    } }

    private fun mapError(resp: Response): DownloadsResult<Nothing> {
        val obj = try {
            dlJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
        } catch (e: Exception) {
            null
        }
        val code = obj?.get("error")?.jsonPrimitive?.contentOrNull
        return when {
            code == "bad_url" -> DownloadsResult.BadUrl
            code == "blocked_url" -> DownloadsResult.Blocked
            code == "engine_missing" -> DownloadsResult.EngineMissing(obj["engine"]?.jsonPrimitive?.contentOrNull ?: "")
            code == "low_space" -> DownloadsResult.LowSpace(obj["freeBytes"]?.jsonPrimitive?.longOrNull)
            code == "engine_error" -> DownloadsResult.EngineError
            resp.code == 404 || code == "not_found" -> DownloadsResult.NotFound
            else -> DownloadsResult.Failure("Server returned HTTP ${resp.code}")
        }
    }
}
