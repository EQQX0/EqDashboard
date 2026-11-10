package com.eqqx2.samsungserver.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

/** What the agent says about its own version. [latest] is null when the release has no agent zip. */
@Serializable
data class AgentVersionInfo(
    val current: String = "",
    val latest: String? = null,
    val available: Boolean = false,
    val notes: String = "",
)

@Serializable
data class AgentApplyResult(
    val updated: Boolean = false,
    val from: String? = null,
    val to: String? = null,
)

sealed interface AgentUpdateResult<out T> {
    data class Ok<T>(val value: T) : AgentUpdateResult<T>
    data object Unauthorized : AgentUpdateResult<Nothing>
    data object RateLimited : AgentUpdateResult<Nothing>
    data object Busy : AgentUpdateResult<Nothing>
    /** The agent could not get or verify the release. [code] is the agent's own error word. */
    data class Refused(val code: String) : AgentUpdateResult<Nothing>
    /** An agent from before 0.7.0 has no update route. */
    data object Unsupported : AgentUpdateResult<Nothing>
    data class Failure(val message: String) : AgentUpdateResult<Nothing>
}

private val auJson = Json { ignoreUnknownKeys = true }

class AgentUpdateClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS) // the agent downloads and checks the release before it answers
        .callTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend fun check(baseUrl: String, token: String): AgentUpdateResult<AgentVersionInfo> =
        call(baseUrl, token, post = false) { AgentUpdateResult.Ok(auJson.decodeFromString(AgentVersionInfo.serializer(), it)) }

    suspend fun apply(baseUrl: String, token: String): AgentUpdateResult<AgentApplyResult> =
        call(baseUrl, token, post = true) { AgentUpdateResult.Ok(auJson.decodeFromString(AgentApplyResult.serializer(), it)) }

    private suspend fun <T> call(
        baseUrl: String, token: String, post: Boolean, parse: (String) -> AgentUpdateResult<T>,
    ): AgentUpdateResult<T> = withContext(Dispatchers.IO) {
        try {
            val url = baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder().addPathSegments("agent/update").build()
            val b = Request.Builder().url(url).header("Authorization", "Bearer " + token.trim())
            val req = if (post) b.post("{}".toRequestBody()).build() else b.build()
            api.newCall(req).execute().use { resp ->
                when {
                    resp.code == 401 -> AgentUpdateResult.Unauthorized
                    resp.code == 429 -> AgentUpdateResult.RateLimited
                    resp.isSuccessful -> parse(resp.body?.string().orEmpty())
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            AgentUpdateResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            AgentUpdateResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            AgentUpdateResult.Failure(e.message ?: "Could not reach server")
        }
    }

    private fun mapError(resp: Response): AgentUpdateResult<Nothing> {
        val code = try {
            auJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
        return when {
            code == "not_found" -> AgentUpdateResult.Unsupported
            code == "busy" -> AgentUpdateResult.Busy
            code != null -> AgentUpdateResult.Refused(code)
            else -> AgentUpdateResult.Failure(httpFailureText(resp.code, if (resp.code == 530) resp.peekBody(512).string() else null))
        }
    }
}
