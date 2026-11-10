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
import java.util.concurrent.TimeUnit

@Serializable
data class SiteInfo(
    val name: String,
    val hostname: String = "",
    val enabled: Boolean = true,
    val spa: Boolean = false,
    val files: Int = 0,
    val bytes: Long = 0,
    val modified: String? = null,
    val createdAt: String = "",
)

@Serializable
data class SitesListing(val domain: String = "", val sites: List<SiteInfo> = emptyList())

@Serializable
data class SiteEnvelope(val site: SiteInfo)

@Serializable
data class DeployReceipt(val files: Int = 0, val bytes: Long = 0)

@Serializable
data class CheckResult(
    val hostname: String = "",
    val reachable: Boolean = false,
    val status: Int? = null,
    val error: String? = null,
)

/** One hostname routed by the Cloudflare tunnel. [kind] is "app", "sites" (this tool's wildcard) or "agent". */
@Serializable
data class TunnelRoute(
    val hostname: String,
    val service: String = "",
    val port: Int? = null,
    val kind: String = "app",
    val up: Boolean? = null,
)

@Serializable
data class TunnelListing(
    val found: Boolean = false,
    val error: String? = null,
    val routes: List<TunnelRoute> = emptyList(),
)

sealed interface SitesResult<out T> {
    data class Ok<T>(val value: T) : SitesResult<T>
    data object Unauthorized : SitesResult<Nothing>
    data object RateLimited : SitesResult<Nothing>
    data object Conflict : SitesResult<Nothing>
    data object BadName : SitesResult<Nothing>
    data object Reserved : SitesResult<Nothing>
    data object NotFound : SitesResult<Nothing>
    data object TooLarge : SitesResult<Nothing>
    data object BadZip : SitesResult<Nothing>
    data object UnsafeZip : SitesResult<Nothing>
    data object Busy : SitesResult<Nothing>
    data class Failure(val message: String) : SitesResult<Nothing>
}

val RESERVED_SITE_NAMES: Set<String> = setOf(
    "api", "files", "gym", "downloader", "www", "mail", "smtp", "ftp", "ssh", "admin", "root",
    "app", "dashboard", "cloud", "sites", "static", "assets", "eq", "vercel", "cdn", "ns1", "ns2",
)

private val SITE_NAME_RE = Regex("^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$")

/** Lowercase DNS label, 1-32 chars, no leading/trailing hyphen, not a reserved name. */
fun isValidSiteName(name: String): Boolean = SITE_NAME_RE.matches(name) && name !in RESERVED_SITE_NAMES

/** True when the name has a valid shape but is on the reserved list. */
fun isReservedSiteName(name: String): Boolean = SITE_NAME_RE.matches(name) && name in RESERVED_SITE_NAMES

private val sitesJson = Json { ignoreUnknownKeys = true }
private val SITES_JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
private val ZIP_MEDIA = "application/zip".toMediaType()
private const val SITES_CHUNK = 64 * 1024

class SitesClient(http: OkHttpClient = OkHttpClient()) {
    private val api: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Check makes the server fetch the public hostname, so it may take a bit longer. */
    private val slow: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    /** Deploys: long write/read windows, no overall cap (the user can cancel). */
    private val transfer: OkHttpClient = http.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.MINUTES)
        .writeTimeout(10, TimeUnit.MINUTES)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    suspend fun list(baseUrl: String, token: String): SitesResult<SitesListing> =
        run(api, baseUrl, token, "sites/list", {}, { it }) { resp ->
            SitesResult.Ok(sitesJson.decodeFromString(SitesListing.serializer(), resp.body?.string().orEmpty()))
        }

    suspend fun create(baseUrl: String, token: String, name: String, spa: Boolean): SitesResult<SiteInfo> =
        run(
            api, baseUrl, token, "sites/create", {},
            {
                it.post(
                    jsonBody(buildJsonObject {
                        put("name", JsonPrimitive(name))
                        put("spa", JsonPrimitive(spa))
                    })
                )
            },
        ) { resp -> SitesResult.Ok(parseSite(resp)) }

    suspend fun update(
        baseUrl: String,
        token: String,
        name: String,
        enabled: Boolean? = null,
        spa: Boolean? = null,
    ): SitesResult<SiteInfo> =
        run(
            api, baseUrl, token, "sites/update", {},
            {
                it.post(
                    jsonBody(buildJsonObject {
                        put("name", JsonPrimitive(name))
                        if (enabled != null) put("enabled", JsonPrimitive(enabled))
                        if (spa != null) put("spa", JsonPrimitive(spa))
                    })
                )
            },
        ) { resp -> SitesResult.Ok(parseSite(resp)) }

    suspend fun delete(baseUrl: String, token: String, name: String): SitesResult<Unit> =
        run(api, baseUrl, token, "sites", { addQueryParameter("name", name) }, { it.delete() }) {
            SitesResult.Ok(Unit)
        }

    /** Streams [source] as the raw zip body (never buffered whole); [length] null means chunked. */
    suspend fun deploy(
        baseUrl: String,
        token: String,
        name: String,
        source: () -> InputStream,
        length: Long?,
        onProgress: (Long) -> Unit,
    ): SitesResult<DeployReceipt> {
        val body = object : RequestBody() {
            override fun contentType() = ZIP_MEDIA
            override fun contentLength(): Long = length ?: -1L
            override fun isOneShot(): Boolean = true
            override fun writeTo(sink: BufferedSink) {
                source().use { input ->
                    val buf = ByteArray(SITES_CHUNK)
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
            transfer, baseUrl, token, "sites/deploy", { addQueryParameter("name", name) },
            { it.post(body) },
        ) { resp ->
            SitesResult.Ok(sitesJson.decodeFromString(DeployReceipt.serializer(), resp.body?.string().orEmpty()))
        }
    }

    suspend fun check(baseUrl: String, token: String, name: String): SitesResult<CheckResult> =
        run(slow, baseUrl, token, "sites/check", { addQueryParameter("name", name) }, { it }) { resp ->
            SitesResult.Ok(sitesJson.decodeFromString(CheckResult.serializer(), resp.body?.string().orEmpty()))
        }

    /** Read-only list of tunnel hostnames with a local up/down check. Older agents answer 404. */
    suspend fun tunnel(baseUrl: String, token: String): SitesResult<TunnelListing> =
        run(api, baseUrl, token, "tunnel/routes", {}, { it }) { resp ->
            SitesResult.Ok(sitesJson.decodeFromString(TunnelListing.serializer(), resp.body?.string().orEmpty()))
        }

    private fun parseSite(resp: Response): SiteInfo =
        sitesJson.decodeFromString(SiteEnvelope.serializer(), resp.body?.string().orEmpty()).site

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(SITES_JSON_MEDIA)

    private suspend fun <T> run(
        http: OkHttpClient,
        baseUrl: String,
        token: String,
        endpoint: String,
        query: HttpUrl.Builder.() -> Unit,
        method: (Request.Builder) -> Request.Builder,
        onOk: (Response) -> SitesResult<T>,
    ): SitesResult<T> = withContext(Dispatchers.IO) { coroutineScope {
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
            val c = http.newCall(request)
            call = c
            c.execute().use { resp ->
                when {
                    resp.code == 401 -> SitesResult.Unauthorized
                    resp.code == 429 -> SitesResult.RateLimited
                    resp.isSuccessful -> onOk(resp)
                    else -> mapError(resp)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            SitesResult.Failure("Invalid server address")
        } catch (e: SerializationException) {
            SitesResult.Failure("Unexpected response from server")
        } catch (e: Exception) {
            SitesResult.Failure(e.message ?: "Could not reach server")
        } finally {
            watcher.cancel()
        }
    } }

    private fun mapError(resp: Response): SitesResult<Nothing> {
        val code = try {
            sitesJson.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject["error"]
                ?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
        return when {
            code == "busy" -> SitesResult.Busy
            resp.code == 409 || code == "exists" -> SitesResult.Conflict
            resp.code == 413 || code == "too_large" -> SitesResult.TooLarge
            resp.code == 404 || code == "not_found" -> SitesResult.NotFound
            code == "bad_name" -> SitesResult.BadName
            code == "reserved_name" -> SitesResult.Reserved
            code == "bad_zip" -> SitesResult.BadZip
            code == "unsafe_zip" -> SitesResult.UnsafeZip
            else -> SitesResult.Failure(httpFailureText(resp.code, if (resp.code == 530) resp.peekBody(512).string() else null))
        }
    }
}
