package com.eqqx2.samsungserver.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

@Serializable
data class PcItem(
    val id: String,
    val name: String = "",
    val mac: String = "",
    val ip: String = "",
    val sshUser: String = "",
    val sshPort: Int = 22,
    val hasLights: Boolean = false,
    val online: Boolean = false,
)

/** [key] is the Samsung server's public SSH key, or null before the first shutdown setup. */
@Serializable
data class PcListing(val items: List<PcItem> = emptyList(), val maxPcs: Int = 8, val key: String? = null)

@Serializable
data class PcEnvelope(val item: PcItem)

@Serializable
data class PcKey(val key: String? = null)

@Serializable
data class PcLightsLink(val url: String? = null)

@Serializable
data class PcLightsSession(val path: String? = null)

sealed interface PcResult<out T> {
    data class Ok<T>(val value: T) : PcResult<T>
    data object Unauthorized : PcResult<Nothing>
    data object RateLimited : PcResult<Nothing>
    data object BadName : PcResult<Nothing>
    data object BadMac : PcResult<Nothing>
    data object BadIp : PcResult<Nothing>
    data object BadUser : PcResult<Nothing>
    data object BadPort : PcResult<Nothing>
    data object Exists : PcResult<Nothing>
    data class TooMany(val max: Int?) : PcResult<Nothing>
    data object NotFound : PcResult<Nothing>
    data object TooFast : PcResult<Nothing>
    data object NoSshUser : PcResult<Nothing>
    data object BadLink : PcResult<Nothing>
    data object NoLights : PcResult<Nothing>
    data object AuthFailed : PcResult<Nothing>
    data object Unreachable : PcResult<Nothing>
    data object SshMissing : PcResult<Nothing>
    data object SendFailed : PcResult<Nothing>
    data class Failure(val message: String) : PcResult<Nothing>
}

private val pcJson = Json { ignoreUnknownKeys = true }
private val PC_JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

class PcClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS) // shutdown waits for ssh
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun list(baseUrl: String, token: String): PcResult<PcListing> =
        call(baseUrl, token, "pc/list", { it }) { PcResult.Ok(pcJson.decodeFromString(PcListing.serializer(), it)) }

    suspend fun add(baseUrl: String, token: String, name: String, mac: String, ip: String, sshUser: String, sshPort: Int): PcResult<PcItem> =
        call(
            baseUrl, token, "pc/add",
            {
                it.post(jsonBody(buildJsonObject {
                    put("name", JsonPrimitive(name))
                    put("mac", JsonPrimitive(mac))
                    put("ip", JsonPrimitive(ip))
                    put("sshUser", JsonPrimitive(sshUser))
                    put("sshPort", JsonPrimitive(sshPort))
                }))
            },
        ) { PcResult.Ok(pcJson.decodeFromString(PcEnvelope.serializer(), it).item) }

    suspend fun setUser(baseUrl: String, token: String, id: String, sshUser: String): PcResult<PcItem> =
        call(
            baseUrl, token, "pc/user",
            {
                it.post(jsonBody(buildJsonObject {
                    put("id", JsonPrimitive(id))
                    put("sshUser", JsonPrimitive(sshUser))
                }))
            },
        ) { PcResult.Ok(pcJson.decodeFromString(PcEnvelope.serializer(), it).item) }

    /** Saves the EqRGB phone-remote link for a PC. A blank [url] removes it. */
    suspend fun setLights(baseUrl: String, token: String, id: String, url: String): PcResult<PcItem> =
        call(
            baseUrl, token, "pc/lights",
            {
                it.post(jsonBody(buildJsonObject {
                    put("id", JsonPrimitive(id))
                    put("url", JsonPrimitive(url))
                }))
            },
        ) { PcResult.Ok(pcJson.decodeFromString(PcEnvelope.serializer(), it).item) }

    /** The saved link, fetched only when the user taps Lights. */
    suspend fun lightsLink(baseUrl: String, token: String, id: String): PcResult<String> =
        call(baseUrl, token, "pc/lights/link", { it.post(idBody(id)) }) {
            val u = pcJson.decodeFromString(PcLightsLink.serializer(), it).url
            if (u.isNullOrBlank()) PcResult.NoLights else PcResult.Ok(u)
        }

    /** Asks the Samsung server to relay the EqRGB remote. Returns a path like /pc/lights/r/<session>/ on the Samsung server's own address. */
    suspend fun lightsSession(baseUrl: String, token: String, id: String): PcResult<String> =
        call(baseUrl, token, "pc/lights/session", { it.post(idBody(id)) }) {
            val p = pcJson.decodeFromString(PcLightsSession.serializer(), it).path
            if (p.isNullOrBlank() || !p.startsWith("/pc/lights/r/")) PcResult.Failure("The Samsung server sent a lights address the app doesn't recognise") else PcResult.Ok(p)
        }

    suspend fun wake(baseUrl: String, token: String, id: String): PcResult<Unit> =
        call(baseUrl, token, "pc/wake", { it.post(idBody(id)) }) { PcResult.Ok(Unit) }

    suspend fun shutdown(baseUrl: String, token: String, id: String): PcResult<Unit> =
        call(baseUrl, token, "pc/shutdown", { it.post(idBody(id)) }) { PcResult.Ok(Unit) }

    /** Makes the Samsung server's SSH key if it doesn't exist and returns the public half. */
    suspend fun key(baseUrl: String, token: String): PcResult<String> =
        call(baseUrl, token, "pc/key", { it.post(jsonBody(buildJsonObject {})) }) {
            val k = pcJson.decodeFromString(PcKey.serializer(), it).key
            if (k.isNullOrBlank()) PcResult.Failure("The Samsung server could not make an SSH key") else PcResult.Ok(k)
        }

    suspend fun delete(baseUrl: String, token: String, id: String): PcResult<Unit> =
        call(baseUrl, token, "pc", { it.delete() }, query = { addQueryParameter("id", id) }) { PcResult.Ok(Unit) }

    private fun idBody(id: String): RequestBody = jsonBody(buildJsonObject { put("id", JsonPrimitive(id)) })

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(PC_JSON_MEDIA)

    private suspend fun <T> call(
        baseUrl: String,
        token: String,
        endpoint: String,
        method: (Request.Builder) -> Request.Builder,
        query: okhttp3.HttpUrl.Builder.() -> Unit = {},
        onOk: (String) -> PcResult<T>,
    ): PcResult<T> = withContext(Dispatchers.IO) {
        try {
            val url = baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder().addPathSegments(endpoint).apply(query).build()
            val req = method(Request.Builder().url(url).header("Authorization", "Bearer " + token.trim())).build()
            api.newCall(req).execute().use { resp ->
                when {
                    resp.code == 401 -> PcResult.Unauthorized
                    resp.code == 429 && !isTooFast(resp) -> PcResult.RateLimited
                    resp.code == 429 -> PcResult.TooFast
                    resp.isSuccessful -> onOk(resp.body?.string().orEmpty())
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            PcResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            PcResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            PcResult.Failure(e.message ?: "Could not reach server")
        }
    }

    // The agent's own limiter answers 429 rate_limited; the per-PC cooldown answers 429 too_fast.
    private fun isTooFast(resp: Response): Boolean = errorCode(resp.peekBody(2048).string()) == "too_fast"

    private fun errorCode(body: String): String? = try {
        pcJson.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
    } catch (e: Exception) {
        null
    }

    private fun mapError(resp: Response): PcResult<Nothing> {
        val body = resp.body?.string().orEmpty()
        val max = try {
            pcJson.parseToJsonElement(body).jsonObject["max"]?.jsonPrimitive?.contentOrNull?.toIntOrNull()
        } catch (e: Exception) {
            null
        }
        return when (errorCode(body)) {
            "bad_name" -> PcResult.BadName
            "bad_mac" -> PcResult.BadMac
            "bad_ip" -> PcResult.BadIp
            "bad_user" -> PcResult.BadUser
            "bad_port" -> PcResult.BadPort
            "exists" -> PcResult.Exists
            "too_many" -> PcResult.TooMany(max)
            "not_found" -> PcResult.NotFound
            "no_ssh_user" -> PcResult.NoSshUser
            "bad_link" -> PcResult.BadLink
            "no_lights" -> PcResult.NoLights
            "auth_failed" -> PcResult.AuthFailed
            "unreachable" -> PcResult.Unreachable
            "ssh_missing" -> PcResult.SshMissing
            "send_failed" -> PcResult.SendFailed
            else -> if (resp.code == 404) PcResult.NotFound else PcResult.Failure("Server returned HTTP ${resp.code}")
        }
    }
}
