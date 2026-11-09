package com.eqqx2.s21control.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

const val DEFAULT_BASE_URL = "https://api.eqqx2.com"

/**
 * The app may load plain http inside the lights popup (EqRGB on the home network), so the system no longer
 * blocks cleartext for the whole app. This check keeps the token and every agent call on https.
 */
fun isHttpsUrl(s: String): Boolean = s.trim().startsWith("https://", ignoreCase = true)

/**
 * Encrypted URL + token storage. If the encrypted prefs cannot be read (Keystore key invalidated,
 * corrupted file) the store is wiped and behaves as logged out instead of crashing.
 */
class TokenStore internal constructor(
    private val open: () -> SharedPreferences,
    private val wipe: () -> Unit,
) {
    constructor(context: Context) : this(
        open = {
            val app = context.applicationContext
            val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                app,
                PREFS_NAME,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        },
        wipe = {
            val app = context.applicationContext
            try { app.deleteSharedPreferences(PREFS_NAME) } catch (_: Exception) {}
            try {
                java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                    .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            } catch (_: Exception) {}
        },
    )

    private var prefs: SharedPreferences? = openOrReset()

    private fun openOrReset(): SharedPreferences? =
        try { open() } catch (_: Exception) {
            try { wipe() } catch (_: Exception) {}
            try { open() } catch (_: Exception) { null }
        }

    /** Runs [block] on the prefs; on failure wipes, reopens and returns [fallback]. */
    private fun <T> guarded(fallback: T, block: (SharedPreferences) -> T): T {
        val p = prefs ?: return fallback
        return try { block(p) } catch (_: Exception) {
            try { wipe() } catch (_: Exception) {}
            prefs = openOrReset()
            fallback
        }
    }

    var baseUrl: String
        get() = (guarded(DEFAULT_BASE_URL) { it.getString(KEY_URL, null) } ?: DEFAULT_BASE_URL)
            .takeIf { isHttpsUrl(it) } ?: DEFAULT_BASE_URL
        set(value) { if (isHttpsUrl(value)) guarded(Unit) { it.edit().putString(KEY_URL, value.trim()).apply() } }

    var token: String?
        get() = guarded<String?>(null) { it.getString(KEY_TOKEN, null) }
        set(value) {
            guarded(Unit) {
                it.edit().apply {
                    if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value.trim())
                }.apply()
            }
        }

    fun clearToken() { token = null }

    internal companion object {
        const val PREFS_NAME = "s21_secure_prefs"
        const val KEY_URL = "base_url"
        const val KEY_TOKEN = "token"
    }
}
