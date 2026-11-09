# EqDashboard

A dashboard app for running a home server on an Android phone.

- `agent/` is a small Node.js server that runs in Termux on the phone. It reports status and manages a file cloud. Every request needs a bearer token.
- `app/` is the Android app (Kotlin, Jetpack Compose) that talks to the agent.
- `termux/` has setup, boot and watchdog scripts for the phone.
- `scripts/release.ps1` builds a signed APK and publishes it as a GitHub release.

## Run the agent

```sh
cd agent
node server.js      # creates agent/.token on first run
node --test         # tests
```

The agent listens on 127.0.0.1:8787. Expose it with a Cloudflare Tunnel. Files live in `~/s21-cloud` (set `FILES_ROOT` to change it).

## Connect the app

Run `node pair.js` on the phone. It writes a small file that holds the server address and token. Open the app and choose **Import token file**. Delete the file afterwards.

## Updates

The app checks this repository's latest release, downloads `app.apk`, verifies its SHA-256 against `meta.json`, and asks you to confirm the install. Android only accepts the update if it is signed with the same key as the installed app.

## Build

```sh
gradle -p app :app:testDebugUnitTest :app:assembleDebug
```

Release builds need `app/keystore.properties` and a keystore. Neither is in this repository.
