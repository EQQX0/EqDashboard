package com.eqqx2.s21control.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

const val DEFAULT_BASE_URL = "https://api.eqqx2.com"

class TokenStore(context: Context) {
    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            "s21_secure_prefs",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var baseUrl: String
        get() = prefs.getString(KEY_URL, null) ?: DEFAULT_BASE_URL
        set(value) { prefs.edit().putString(KEY_URL, value.trim()).apply() }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit().apply {
                if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value.trim())
            }.apply()
        }

    fun clearToken() { token = null }

    private companion object {
        const val KEY_URL = "base_url"
        const val KEY_TOKEN = "token"
    }
}
