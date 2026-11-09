package com.eqqx2.s21control.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

sealed interface FetchResult {
    data class Ok(val status: Status) : FetchResult
    data object Unauthorized : FetchResult
    data object RateLimited : FetchResult
    data class Failure(val message: String) : FetchResult
}

class AgentClient(private val http: OkHttpClient = OkHttpClient()) {
    private val client: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    suspend fun fetchStatus(baseUrl: String, token: String): FetchResult =
        withContext(Dispatchers.IO) {
            try {
                val url = baseUrl.trim().trimEnd('/') + "/status"
                val request = Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer " + token.trim())
                    .build()
                client.newCall(request).execute().use { resp ->
                    when {
                        resp.code == 401 -> FetchResult.Unauthorized
                        resp.code == 429 -> FetchResult.RateLimited
                        !resp.isSuccessful -> FetchResult.Failure("Server returned HTTP ${resp.code}")
                        else -> FetchResult.Ok(parseStatus(resp.body?.string().orEmpty()))
                    }
                }
            } catch (e: IllegalArgumentException) {
                FetchResult.Failure("Invalid server address")
            } catch (e: kotlinx.serialization.SerializationException) {
                FetchResult.Failure("Unexpected response from server")
            } catch (e: Exception) {
                FetchResult.Failure(e.message ?: "Could not reach server")
            }
        }
}
