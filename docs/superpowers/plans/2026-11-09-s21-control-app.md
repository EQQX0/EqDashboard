# Samsung Server Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Android app that logs in to the Samsung server agent with a bearer token and shows live server status.

**Architecture:** Single-activity Compose app. `AgentClient` (OkHttp + kotlinx-serialization) calls `GET /status` on the saved base URL. `TokenStore` keeps URL and token in EncryptedSharedPreferences. A `StatusViewModel` polls every 5 s while the Overview screen is visible. Later modules (Downloads, Files, Sites, VPS) add routes and tabs; none are in this plan.

**Tech Stack:** Kotlin 2.0.21, AGP 8.7.3, Gradle 8.10.2, Compose BOM 2024.10.01 (Material 3), OkHttp 4.12.0, kotlinx-serialization-json 1.7.3, androidx.security:security-crypto 1.1.0-alpha06, JUnit 4.13.2, MockWebServer 4.12.0.

**Spec:** `C:\Users\Admin\.claude\plans\can-i-add-dashboard-robust-lemon.md` (approved plan) and the live `/status` response of `server.js`.

## Global Constraints

- Package `com.eqqx2.s21control`, app name `Samsung Server`, `minSdk 26`, `compileSdk 35`, `targetSdk 35`.
- Default base URL `https://api.eqqx2.com`; HTTPS only (`usesCleartextTraffic=false`).
- Auth header: `Authorization: Bearer <token>`.
- `/status` JSON: `time` (ISO string), `uptimeSec` (number), `load` ([3 numbers]), `cpuCores` (number), `memory{totalBytes,freeBytes}`, `storage{totalKb,usedKb,freeKb}` or `null`, `battery` (object with `percentage`, `temperature`, `status`, `plugged`) or `null`.
- Design tokens (dark only for now): background `#0F172A`, card `#1B2336`, border `#475569`, foreground `#F8FAFC`, muted `#94A3B8`, accent `#22C55E`, destructive `#EF4444`. Body 16sp, touch targets ≥ 48dp, numbers in monospace.
- No emoji as icons; every icon-only button has a content description.
- Token never logged and never shown after saving.

## Review Focus

- Wrong token (HTTP 401): show "Token rejected", return to login, keep the saved URL.
- Rate limited (HTTP 429): show "Too many requests, retrying", back off to 30 s.
- No network or timeout: keep last good data on screen, mark it stale with its age.
- `battery: null` or `storage: null`: show "n/a" with a hint, never crash or show 0%.
- Token pasted with surrounding whitespace or newline: trimmed before use.
- Leaving the Overview screen stops polling; rotating the phone does not restart it from zero.

---

### Task 1: Project scaffold and toolchain

**Files:**
- Create: `app/settings.gradle.kts`, `app/build.gradle.kts`, `app/gradle.properties`, `app/local.properties`, `app/app/build.gradle.kts`, `app/app/src/main/AndroidManifest.xml`, `app/app/src/main/java/com/eqqx2/s21control/MainActivity.kt`
- Install: Android SDK `platform-tools`, `platforms;android-35`, `build-tools;35.0.0` into `C:\Android\sdk` via `sdkmanager` (license acceptance needs the user's yes).

**Interfaces:**
- Produces: `MainActivity : ComponentActivity` that calls `setContent { S21App() }`; `S21App()` is defined in Task 4.

- [ ] **Step 1: Accept SDK licenses and install packages** with `C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat --sdk_root=C:\Android\sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"`. Expected: packages listed under `sdkmanager --list_installed`.
- [ ] **Step 2: Write Gradle files** with the versions in the header; `local.properties` holds `sdk.dir=C\:\\Android\\sdk`.
- [ ] **Step 3: Verify the empty app builds.** Run `C:\Android\gradle-8.10.2\bin\gradle.bat -p app :app:assembleDebug`. Expected: `BUILD SUCCESSFUL`, APK at `app/app/build/outputs/apk/debug/app-debug.apk`.

### Task 2: Status model and parsing

**Files:**
- Create: `.../data/Status.kt`, test `app/app/src/test/java/com/eqqx2/s21control/data/StatusTest.kt`

**Interfaces:**
- Produces: `@Serializable data class Status(val time: String, val uptimeSec: Long, val load: List<Double>, val cpuCores: Int, val memory: Memory, val storage: Storage?, val battery: Battery?)`, with `Memory(totalBytes: Long, freeBytes: Long)`, `Storage(totalKb: Long, usedKb: Long, freeKb: Long)`, `Battery(percentage: Int, temperature: Double, status: String, plugged: String)`; `fun parseStatus(json: String): Status` (ignores unknown keys).

- [ ] **Step 1: Write failing tests** `parsesFullResponse` (the real JSON captured from the phone, with battery null), `parsesBatteryObject`, `ignoresUnknownKeys`.
- [ ] **Step 2: Run** `gradle -p app :app:testDebugUnitTest --tests "*StatusTest"`. Expected: FAIL (class missing).
- [ ] **Step 3: Implement** the types above and `parseStatus` using `Json { ignoreUnknownKeys = true }`.
- [ ] **Step 4: Run again.** Expected: PASS.

### Task 3: Agent client and token store

**Files:**
- Create: `.../data/AgentClient.kt`, `.../data/TokenStore.kt`, test `.../data/AgentClientTest.kt`

**Interfaces:**
- Consumes: `Status`, `parseStatus` from Task 2.
- Produces: `sealed interface FetchResult { data class Ok(val status: Status); data object Unauthorized; data object RateLimited; data class Failure(val message: String) }`; `class AgentClient(private val http: OkHttpClient = OkHttpClient())` with `suspend fun fetchStatus(baseUrl: String, token: String): FetchResult` (token trimmed, 10 s timeout, never throws); `class TokenStore(context: Context)` with `var baseUrl: String` (default `https://api.eqqx2.com`), `var token: String?`, `fun clearToken()`.

- [ ] **Step 1: Write failing tests with MockWebServer:** `sendsBearerHeaderTrimmed` (token `" abc\n"` sends `Bearer abc`), `maps401ToUnauthorized`, `maps429ToRateLimited`, `mapsConnectionFailureToFailure`, `mapsMalformedJsonToFailure`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `AgentClient` on `Dispatchers.IO`; `TokenStore` on `EncryptedSharedPreferences` (`MasterKey.Builder(...).setKeyScheme(AES256_GCM)`).
- [ ] **Step 4: Run, expect PASS.**

### Task 4: Theme, login and Overview screens

**Files:**
- Create: `.../ui/Theme.kt`, `.../ui/LoginScreen.kt`, `.../ui/OverviewScreen.kt`, `.../ui/StatusViewModel.kt`, `.../ui/S21App.kt`, `.../ui/Format.kt`, test `.../ui/FormatTest.kt`

**Interfaces:**
- Consumes: `AgentClient`, `FetchResult`, `TokenStore`, `Status`.
- Produces: `fun formatBytes(bytes: Long): String` ("2.8 GB"), `fun formatUptime(sec: Long): String` ("3d 15h"), `fun formatAge(ms: Long): String` ("12 s ago"); `@Composable fun S21App()`; `class StatusViewModel(client, store)` exposing `StateFlow<OverviewState>` where `OverviewState(status: Status?, error: String?, stale: Boolean, lastOkMs: Long?)`, `fun startPolling()`, `fun stopPolling()`.

- [ ] **Step 1: Write failing tests** for `formatBytes` (0 → "0 B", 2_040_000_000 → "1.9 GB"), `formatUptime` (315205 → "3d 15h"), `formatAge`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the formatters, then the UI.** Login: URL field (prefilled), token field with visible label, show/hide toggle (content description), "Connect" button that calls `fetchStatus` once and only saves on `Ok`; errors under the field. Overview: cards for CPU load, memory, storage, battery, uptime; top bar shows "Updated N s ago" and a stale state; "Log out" clears the token. Polling every 5 s in `viewModelScope` while the screen is resumed (`repeatOnLifecycle(STARTED)`), 30 s after 429.
- [ ] **Step 4: Run unit tests, expect PASS.**

### Task 5: Build, install, verify on the Samsung server

**Files:** none new.

- [ ] **Step 1: Run** `gradle -p app :app:testDebugUnitTest :app:assembleDebug`. Expected: `BUILD SUCCESSFUL`, all tests pass.
- [ ] **Step 2: Deliver** `app-debug.apk` to the user (SendUserFile); user enables "install unknown apps" for their file manager and installs.
- [ ] **Step 3: Manual check on the phone** against each Review Focus line: wrong token shows "Token rejected"; airplane mode marks data stale; battery card shows "n/a" until Termux:API is installed; polling stops when the app is backgrounded.
