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

/** One slice. [status] is creating, running, stopped or error. [step] names the current stage while creating. */
@Serializable
data class VpsSlice(
    val id: String,
    val name: String = "",
    val distro: String = "",
    val distroLabel: String = "",
    val port: Int = 0,
    val authMode: String = "password",
    val status: String = "stopped",
    val step: String? = null,
    val error: String? = null,
    val createdAt: String? = null,
    val startedAt: String? = null,
)

@Serializable
data class VpsDistro(val id: String, val label: String = "")

@Serializable
data class VpsListing(
    val engine: Boolean = false,
    val distros: List<VpsDistro> = emptyList(),
    val host: String? = null,
    val maxSlices: Int = 4,
    val freeBytes: Long? = null,
    val items: List<VpsSlice> = emptyList(),
)

/** The password is shown once. It is null for key-only slices. */
@Serializable
data class VpsCreated(val item: VpsSlice, val password: String? = null)

@Serializable
data class VpsPassword(val password: String)

sealed interface VpsResult<out T> {
    data class Ok<T>(val value: T) : VpsResult<T>
    data object Unauthorized : VpsResult<Nothing>
    data object RateLimited : VpsResult<Nothing>
    data object BadName : VpsResult<Nothing>
    data object BadKey : VpsResult<Nothing>
    data object Exists : VpsResult<Nothing>
    data class TooMany(val max: Int?) : VpsResult<Nothing>
    data object NotFound : VpsResult<Nothing>
    data object Busy : VpsResult<Nothing>
    data object WrongState : VpsResult<Nothing>
    data object KeyOnly : VpsResult<Nothing>
    data object EngineMissing : VpsResult<Nothing>
    data class LowSpace(val freeBytes: Long?) : VpsResult<Nothing>
    data class Failure(val message: String) : VpsResult<Nothing>
}

private val vpsJson = Json { ignoreUnknownKeys = true }
private val VPS_JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

class VpsClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS) // start and delete wait for the Linux to react
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend fun list(baseUrl: String, token: String): VpsResult<VpsListing> =
        run(baseUrl, token, "vps/list", {}, { it }) { resp ->
            VpsResult.Ok(vpsJson.decodeFromString(VpsListing.serializer(), resp.body?.string().orEmpty()))
        }

    /** [sshKey] may be blank. With a key the slice only accepts key logins. */
    suspend fun create(baseUrl: String, token: String, name: String, distro: String, sshKey: String): VpsResult<VpsCreated> =
        run(
            baseUrl, token, "vps/create", {},
            {
                it.post(
                    jsonBody(buildJsonObject {
                        put("name", JsonPrimitive(name))
                        put("distro", JsonPrimitive(distro))
                        if (sshKey.isNotBlank()) put("sshKey", JsonPrimitive(sshKey.trim()))
                    })
                )
            },
        ) { resp ->
            VpsResult.Ok(vpsJson.decodeFromString(VpsCreated.serializer(), resp.body?.string().orEmpty()))
        }

    suspend fun start(baseUrl: String, token: String, id: String): VpsResult<Unit> =
        run(baseUrl, token, "vps/start", {}, { it.post(idBody(id)) }) { VpsResult.Ok(Unit) }

    suspend fun stop(baseUrl: String, token: String, id: String): VpsResult<Unit> =
        run(baseUrl, token, "vps/stop", {}, { it.post(idBody(id)) }) { VpsResult.Ok(Unit) }

    suspend fun resetPassword(baseUrl: String, token: String, id: String): VpsResult<String> =
        run(baseUrl, token, "vps/password", {}, { it.post(idBody(id)) }) { resp ->
            VpsResult.Ok(vpsJson.decodeFromString(VpsPassword.serializer(), resp.body?.string().orEmpty()).password)
        }

    suspend fun delete(baseUrl: String, token: String, id: String): VpsResult<Unit> =
        run(baseUrl, token, "vps", { addQueryParameter("id", id) }, { it.delete() }) { VpsResult.Ok(Unit) }

    private fun idBody(id: String): RequestBody = jsonBody(buildJsonObject { put("id", JsonPrimitive(id)) })

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(VPS_JSON_MEDIA)

    private suspend fun <T> run(
        baseUrl: String,
        token: String,
        endpoint: String,
        query: HttpUrl.Builder.() -> Unit,
        method: (Request.Builder) -> Request.Builder,
        onOk: (Response) -> VpsResult<T>,
    ): VpsResult<T> = withContext(Dispatchers.IO) { coroutineScope {
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
                    resp.code == 401 -> VpsResult.Unauthorized
                    resp.code == 429 -> VpsResult.RateLimited
                    resp.isSuccessful -> onOk(resp)
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            VpsResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            VpsResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            VpsResult.Failure(e.message ?: "Could not reach server")
        } finally {
            watcher.cancel()
        }
    } }

    private fun mapError(resp: Response): VpsResult<Nothing> {
        val obj = try {
            vpsJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
        } catch (e: Exception) {
            null
        }
        val code = obj?.get("error")?.jsonPrimitive?.contentOrNull
        return when (code) {
            "bad_name", "bad_distro" -> VpsResult.BadName
            "bad_key" -> VpsResult.BadKey
            "exists" -> VpsResult.Exists
            "too_many" -> VpsResult.TooMany(obj["max"]?.jsonPrimitive?.longOrNull?.toInt())
            "not_found" -> VpsResult.NotFound
            "busy" -> VpsResult.Busy
            "wrong_state" -> VpsResult.WrongState
            "key_only" -> VpsResult.KeyOnly
            "engine_missing" -> VpsResult.EngineMissing
            "low_space" -> VpsResult.LowSpace(obj["freeBytes"]?.jsonPrimitive?.longOrNull)
            else -> if (resp.code == 404) VpsResult.NotFound else VpsResult.Failure(httpFailureText(resp.code, if (resp.code == 530) resp.peekBody(512).string() else null))
        }
    }
}
