# EqDashboard

Run a home server from an Android phone and control it from an app.

The phone runs a small Node.js agent inside Termux. The app (Kotlin, Jetpack Compose) talks to that agent through your own Cloudflare Tunnel. Everything runs on hardware you own, under your own domain, with a token only you hold.

## What it does

| Module | What you get |
|---|---|
| Overview | CPU, memory, storage, battery and temperature of the phone |
| Files | A file cloud: browse, upload, download, rename, trash |
| Downloads | Direct links, torrents (aria2) and video sites (yt-dlp) |
| Sites | Static websites served from folders, one subdomain each |
| VPS | Small Linux environments (proot-distro) with SSH |
| My PC | Turn a computer on (Wake-on-LAN) and off (SSH) from the app |
| Lights | Optional. Opens the [EqRGB](https://github.com/EQQX0/EqRGB) phone remote through the phone |

You can use any subset. A module you skip stays empty.

## Start here

1. Follow [docs/SETUP.md](docs/SETUP.md). It takes about 30 minutes and ends with the app showing your phone's status.
2. Download `app.apk` from the [latest release](https://github.com/EQQX0/EqDashboard/releases/latest) and install it. On the sign-in screen, enter your own server address and token.
3. On Windows, download `S21-Control-<version>.exe` from the same page instead. It is a portable app: no install, same sign-in. It covers Overview, Files, Downloads, Sites, VPS and My PC (wake and shut down). Windows may show a SmartScreen warning because the file is unsigned; choose More info, then Run anyway.

## What you need

- An Android phone that stays plugged in at home, with Termux from F-Droid
- A domain on Cloudflare (the free plan works)
- Optional: a wired Windows PC for the My PC module

## Layout

- `agent/` the Node.js server, plus one `README-*.md` per module
- `app/` the Android app
- `desktop/` the Windows app (Electron). Build with `npm install && npm run dist` in that folder
- `termux/` setup, tunnel, boot and watchdog scripts for the phone
- `scripts/release.ps1` builds a signed APK and publishes a release

## Updates

The app and the agent each check one GitHub repository for new releases. The default is this one (`UPDATE_REPO` in `app/gradle.properties` and `repository` in `agent/package.json`). To ship your own builds, change both to your repository. The [fork steps](docs/SETUP.md#fork-it) cover the rest.

## Security

Every request needs the bearer token. Treat the token like a password, and put Cloudflare Access in front of the API hostname if you can. The app talks only to `https://` addresses.

## Licence

MIT. See [LICENSE](LICENSE).
