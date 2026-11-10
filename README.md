# EqDashboard

Last updated: 2026-11-10 23:58 AST

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

1. In Termux on the phone, run `curl -fsSL https://raw.githubusercontent.com/EQQX0/EqDashboard/main/termux/install.sh | bash -s -- yourdomain.com`. [docs/SETUP.md](docs/SETUP.md) explains each step and the manual route.
2. Download `app.apk` from the [latest release](https://github.com/EQQX0/EqDashboard/releases/latest) and install it. On the sign-in screen, enter your own server address and token, or tap "Import token file". The installer writes `samsung-server.pair` to `Downloads/SamsungServer/`. Grant that folder once with "Find pairing files automatically" and the app shows a "Pairing file found" card on later sign-ins. Nothing signs in until you tap "Use it".
3. On Windows, download `Samsung-Server-Setup-<version>.exe` from the same page and run it. It installs for your user only (no admin), asks whether to add a desktop shortcut, and has a normal uninstaller in Windows Settings > Apps. The first time it opens, it looks in Downloads, Downloads/SamsungServer, Desktop and Documents for a pairing file and signs you in by itself; you can also type the address and token. It does everything the Android app does (Overview, Files with upload and rename, Downloads, Sites with zip deploy, VPS, My PC) and checks GitHub for a newer Windows version on the Overview screen. Windows may show a SmartScreen warning because the file is unsigned; choose More info, then Run anyway.

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
- Windows releases: build with `npm run dist` in `desktop/`, then attach `Samsung-Server-Setup-<version>.exe` to the GitHub release (`gh release create vX.Y.Z <exe> --latest=false` when there is no APK). The Windows app updater reads the release list for the newest release that has that file.

## Troubleshooting

A 530 or `error code: 1033` from the API address means Cloudflare has no live tunnel connection for that hostname, even when `cloudflared` runs on the phone. In Termux, run `node ~/samsung-server/agent/tunnel-doctor.js --probe`. It names the cause and prints the fix commands. [docs/SETUP.md](docs/SETUP.md) lists the dashboard checks.

## Naming rule

Never use "s21" in a name: code, files, folders, tunnels, DNS records, docs or release assets. Use "samsung" or "Samsung Server" (`samsung-server`, `samsungserver`). The project was renamed from s21 in 0.13.0. The Cloudflare tunnel `samsung-server` replaces the old `s21` tunnel.

## Running commands on the phone from the PC

An AI session can run Termux commands over SSH from the PC. Set up on 2026-11-11. It works only while the PC and phone share a Wi-Fi network, the phone is awake and `sshd` runs in Termux.

- Phone: Termux user `u0_a338`, address `192.168.0.226` (can change after a reboot or router reset), port **8022**.
- Key: `C:\Users\Admin\.ssh\samsung-restore` on the PC. The public half is in the phone's `~/.ssh/authorized_keys` (comment `pc-to-phone-restore`).
- Run a command (PowerShell):

```powershell
ssh -i "$env:USERPROFILE\.ssh\samsung-restore" -p 8022 -o BatchMode=yes u0_a338@192.168.0.226 "<command>"
```

- Copy files with `scp -i <key> -P 8022 <files> u0_a338@192.168.0.226:<folder>/` (capital `-P`). Compare SHA-256 afterwards.
- Long jobs: start with `(nohup sh script.sh > run.log 2>&1 &)` and read `run.log` later.
- If SSH answers "REMOTE HOST IDENTIFICATION HAS CHANGED", do not override it. Ask the user to run `ssh-keygen -lf $PREFIX/etc/ssh/ssh_host_ed25519_key.pub` in Termux and compare the fingerprint. Only on a match, run `ssh-keygen -R "[192.168.0.226]:8022"`.
- If it cannot connect: ask the user to open Termux and run `sshd`, and to confirm the IP with `ifconfig`.
- Ask the user before changing anything on the phone (installing packages, editing boot scripts or tunnel config). Reading logs and status needs no approval. Never print tokens or `.env` contents.
- Browser steps such as `cloudflared tunnel login` still need the user.
- When the work is done, remove the key: `sed -i '/pc-to-phone-restore/d' ~/.ssh/authorized_keys` on the phone and delete the two `samsung-restore*` files in `C:\Users\Admin\.ssh\`.

## Updates

The app and the agent each check one GitHub repository for new releases. The default is this one (`UPDATE_REPO` in `app/gradle.properties` and `repository` in `agent/package.json`). To ship your own builds, change both to your repository. The [fork steps](docs/SETUP.md#fork-it) cover the rest.

## Security

Every request needs the bearer token. Treat the token like a password, and put Cloudflare Access in front of the API hostname if you can. The app talks only to `https://` addresses.

## Licence

MIT. See [LICENSE](LICENSE).

## For AI sessions

Read [HANDOFF.md](HANDOFF.md) first for the latest status. Older handoffs live in `docs/handoffs/`.
