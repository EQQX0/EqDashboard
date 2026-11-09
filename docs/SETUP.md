# Set up your own server

This guide takes a spare Android phone from zero to the app showing its status. Replace `yourdomain.com` with your domain throughout.

## 1. What you need

- An Android phone that stays on a charger at home
- [Termux](https://f-droid.org/packages/com.termux/) from F-Droid. The Play Store version is old and breaks package installs.
- [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) to start everything after a reboot. [Termux:API](https://f-droid.org/packages/com.termux.api/) for battery and temperature on Overview (open it once after installing; the installer checks and tells you if it is missing).
- A domain managed by Cloudflare
- An Android phone to run the app. It can be the same one.

## Quick install (one command)

Open Termux and paste this, with your own domain at the end:

```sh
curl -fsSL https://raw.githubusercontent.com/EQQX0/EqDashboard/main/termux/install.sh | bash -s -- yourdomain.com
```

It installs everything, links your domain (it prints a link to approve in a browser), sets the agent to start on boot, starts it, and prints your token and server address. It also saves a pairing file (`s21-control.s21`) in the phone's Downloads folder: pick it with Import token file in the phone app, drop it in Downloads on a PC running the Windows app, or send it to another device with `termux-share`. Then do the two phone settings it lists and jump to [step 5](#5-install-the-app-and-sign-in). Leave the domain off to skip the Cloudflare part. Run it again any time to update. Steps 2 to 4 below are the same thing by hand.

## 2. Put the agent on the phone

Open Termux and run:

```sh
pkg install -y git
git clone https://github.com/EQQX0/EqDashboard ~/s21-server
bash ~/s21-server/termux/setup.sh
```

The setup script installs Node.js, cloudflared, aria2, ffmpeg, yt-dlp, Caddy, proot-distro and OpenSSH. It takes a few minutes.

The agent lives in `~/s21-server/agent`. Start it once to create your token:

```sh
cd ~/s21-server/agent
node server.js
```

It prints that it is listening on `127.0.0.1:8787` and writes the token to `agent/.token`. Press Ctrl+C. Keep that file private.

## 3. Connect a domain with Cloudflare Tunnel

```sh
bash ~/s21-server/termux/tunnel-setup.sh yourdomain.com
```

A browser link appears. Open it, pick your domain and approve. The script creates a tunnel named `s21` and points `api.yourdomain.com` at the agent.

Start the agent and the tunnel, then test from another network (mobile data works):

```sh
cd ~/s21-server/agent && nohup node server.js >> ~/s21-server/agent.log 2>&1 &
nohup cloudflared tunnel run s21 >> ~/cloudflared.log 2>&1 &
curl -H "Authorization: Bearer $(cat ~/s21-server/agent/.token)" https://api.yourdomain.com/status
```

You should see JSON with CPU, memory and storage. Without the token the answer is 401.

If a tunnel named `s21` already exists, skip the script. Add a hostname to `~/.cloudflared/config.yml` and run `cloudflared tunnel route dns s21 api.yourdomain.com`.

## 4. Keep it running

- In Android settings, set Termux battery use to **Unrestricted**.
- Open Termux:Boot once so it can run at boot.
- Copy the boot script and make it executable:

```sh
mkdir -p ~/.termux/boot
cp ~/s21-server/termux/start-all.example.sh ~/.termux/boot/start-all.sh
chmod +x ~/.termux/boot/start-all.sh
```

- Optional: restart a crashed agent or tunnel every minute with the watchdog. Install cron (`pkg install cronie`), run `crontab -e` and add `* * * * * sh $HOME/s21-server/termux/watchdog.sh`.

Use only one boot script. Two scripts that both start Node or cloudflared fight each other.

## 5. Install the app and sign in

1. On the phone that will run the app, download `app.apk` from the [latest release](https://github.com/EQQX0/EqDashboard/releases/latest) and install it. Android asks you to allow installs from your browser.
2. Enter `https://api.yourdomain.com` as the server URL and paste your token. Read it in Termux with `cat ~/s21-server/agent/.token`.

To skip typing the token, run this in Termux and import the file from the sign-in screen:

```sh
cd ~/s21-server/agent
node pair.js --url https://api.yourdomain.com
```

Delete the file afterwards. Anyone who reads it controls your server. Details are in [agent/README-pair.md](../agent/README-pair.md).

The Overview screen now shows your phone.

## 6. Optional modules

| Module | What to do |
|---|---|
| Files | Works at once. Files live in `~/s21-cloud`. Set `FILES_ROOT` to move them. See [README-files](../agent/README-files.md). |
| Downloads | Works once `setup.sh` has finished. See [README-downloads](../agent/README-downloads.md). |
| Sites | Set `SITES_DOMAIN=yourdomain.com` before starting the agent, then add a wildcard hostname to the tunnel. Sites stay off until you set the domain. See [README-sites](../agent/README-sites.md). |
| VPS | Works at once. Each slice gets an SSH port from 2201. See [README-vps](../agent/README-vps.md). |
| My PC | Add the PC's MAC and home network address in the app, then tap **Set up** for shutdown. The PC must be wired, with Wake-on-LAN on in its BIOS and network adapter. See [README-pc](../agent/README-pc.md). |
| Lights | Needs the Windows app [EqRGB](https://github.com/EQQX0/EqRGB). Tap **Set up** on the PC card, choose **Also add EqRGB lights** and paste EqRGB's phone link. |

Set environment variables in the line that starts the agent, for example `SITES_DOMAIN=yourdomain.com nohup node server.js ...` in the boot script.

## 7. Updates

The app shows a card when a new version exists. It downloads the file, checks its SHA-256 and asks before installing. The agent has its own update card: it downloads the agent files, checks them, keeps your token and data, and restarts itself. A backup of the old agent stays in `~/s21-server/agent-backup`.

Both look at the repository named in `UPDATE_REPO` (app) and `repository` in `agent/package.json` (agent). That is `EQQX0/EqDashboard` until you change it.

## Fork it

To ship your own builds:

1. Fork the repository.
2. Set `UPDATE_REPO=you/your-repo` in `app/gradle.properties` and `"repository": "you/your-repo"` in `agent/package.json`.
3. Change `applicationId` and `namespace` in `app/app/build.gradle.kts` if you want your app to install next to the original.
4. Make a signing key and keep it safe. Android accepts an update only when it carries the same key as the installed app.

```sh
keytool -genkeypair -v -keystore my-release.jks -alias release -keyalg RSA -keysize 4096 -validity 10000
```

5. Create `app/keystore.properties`. Git ignores it.

```
storeFile=../my-release.jks
storePassword=...
keyAlias=release
keyPassword=...
```

6. Build and publish:

```
scripts/release.ps1 -VersionName 1.0.0 -VersionCode 1 -Notes "First release" -Publish
```

The script builds, runs the tests, signs the APK and creates the GitHub release in the repository named by `UPDATE_REPO`. Attach an `samsung-agent-<version>.zip` (holding `agent/*.js`, `agent/package.json`, `agent/README-*.md` and `termux/*.sh`) if you want the agent to update itself.

The script needs Gradle and the Android SDK. Edit the `$Gradle` path at the top of the script to match your machine.

## If something fails

- **`CANNOT LINK EXECUTABLE "curl"` or git fails to start in Termux:** Termux is half-updated. Run `apt update && apt full-upgrade -y`, then run the installer again. The installer does this upgrade itself, but it can't run if `curl` is already broken and can't download it.
- **401 from the tunnel:** the token is wrong or missing. Read `agent/.token` again.
- **502 or 1033 from Cloudflare:** the agent or `cloudflared` is not running. Check `~/s21-server/agent.log` and `~/cloudflared.log`.
- **The app says the server address must be https:** use the `https://` hostname from your tunnel. Plain `http://` is refused.
- **The agent stops when the screen is off:** Termux battery use is not Unrestricted, or `termux-wake-lock` did not run.
