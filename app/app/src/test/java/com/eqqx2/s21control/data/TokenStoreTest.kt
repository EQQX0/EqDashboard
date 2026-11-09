package com.eqqx2.s21control.data

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** In-memory SharedPreferences; [failReads] simulates an invalidated Keystore key. */
private class FakePrefs(var failReads: Boolean = false) : SharedPreferences {
    val map = mutableMapOf<String, String>()
    override fun getString(key: String?, defValue: String?): String? {
        if (failReads) throw java.security.GeneralSecurityException("keystore")
        return map[key] ?: defValue
    }
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        override fun putString(key: String?, value: String?) = apply { map[key!!] = value!! }
        override fun remove(key: String?) = apply { map.remove(key) }
        override fun clear() = apply { map.clear() }
        override fun apply() {}
        override fun commit() = true
        override fun putStringSet(key: String?, values: MutableSet<String>?) = this
        override fun putInt(key: String?, value: Int) = this
        override fun putLong(key: String?, value: Long) = this
        override fun putFloat(key: String?, value: Float) = this
        override fun putBoolean(key: String?, value: Boolean) = this
    }
    override fun getAll(): MutableMap<String, *> = map
    override fun getStringSet(key: String?, defValues: MutableSet<String>?) = defValues
    override fun getInt(key: String?, defValue: Int) = defValue
    override fun getLong(key: String?, defValue: Long) = defValue
    override fun getFloat(key: String?, defValue: Float) = defValue
    override fun getBoolean(key: String?, defValue: Boolean) = defValue
    override fun contains(key: String?) = map.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
}

class TokenStoreTest {
    @Test fun roundTrip() {
        val store = TokenStore({ FakePrefs() }, {})
        store.token = " t "
        store.baseUrl = "https://x.example.com"
        assertEquals("t", store.token)
        assertEquals("https://x.example.com", store.baseUrl)
    }

    @Test fun plainHttpServerAddressIsNeverStoredOrUsed() {
        val prefs = FakePrefs()
        val store = TokenStore({ prefs }, {})
        store.baseUrl = "http://192.168.0.5:8787"
        assertEquals(DEFAULT_BASE_URL, store.baseUrl)
        assertEquals(false, prefs.map.containsKey(TokenStore.KEY_URL))
        prefs.map[TokenStore.KEY_URL] = "http://evil.example.com" // a value that got into storage another way
        assertEquals(DEFAULT_BASE_URL, store.baseUrl)
    }

    @Test fun httpsCheck() {
        assertEquals(true, isHttpsUrl("https://api.eqqx2.com"))
        assertEquals(true, isHttpsUrl("  HTTPS://x.y  "))
        assertEquals(false, isHttpsUrl("http://x.y"))
        assertEquals(false, isHttpsUrl("api.eqqx2.com"))
        assertEquals(false, isHttpsUrl(""))
    }

    @Test fun openFailureWipesAndActsLoggedOut() {
        var opens = 0
        var wipes = 0
        val store = TokenStore({ if (opens++ == 0) throw IllegalStateException("corrupt") else FakePrefs() }, { wipes++ })
        assertEquals(1, wipes)
        assertNull(store.token)
        assertEquals(DEFAULT_BASE_URL, store.baseUrl)
    }

    @Test fun readFailureWipesAndActsLoggedOut() {
        val bad = FakePrefs()
        bad.map["token"] = "x"
        bad.failReads = true
        var wipes = 0
        val store = TokenStore({ if (wipes == 0) bad else FakePrefs() }, { wipes++ })
        assertNull(store.token)
        assertEquals(1, wipes)
        assertNull(store.token)
    }
}
