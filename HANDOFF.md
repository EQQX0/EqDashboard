# Handoff

Date: 2026-11-11 00:10 AST
Session summary: Every client got HTTP 530 (Cloudflare error 1033) at `https://api.eqqx2.com`. We shipped 0.13.5 (tunnel doctor, installer repair, clear 530 message in both apps, Android pairing-file card) and found the root cause, then the user fixed it: the phone's Cloudflare login was for the wrong account, and redoing the login through PC Chrome (signed in as Beboreport1) resolved it. `https://api.eqqx2.com/status` now returns 401 without a token.

## Start here
1. Read README.md for the project map. Older handoffs are in `docs/handoffs/`.
2. First action: sign in from the Android and Windows apps with a fresh pairing file, then work through "Unfinished".
3. Verify with: `curl -s -o /dev/null -w "%{http_code}\n" https://api.eqqx2.com/status` (expect 401, not 530), then `node ~/samsung-server/agent/tunnel-doctor.js --probe` in Termux.

## Reaching the phone (SSH from this PC)
You can run Termux commands from this PC. Command, key, limits and rules are in README.md under "Running commands on the phone from the PC". Short form: `ssh -i "$env:USERPROFILE\.ssh\samsung-restore" -p 8022 -o BatchMode=yes u0_a338@192.168.0.226 "<command>"`. Ask the user before changing anything on the phone. The key is still authorized; remove it when the work is done.

## State on 2026-11-11 (after the restore)
Working: `https://api.eqqx2.com` (401 without token), `gym.eqqx2.com` (200), `downloader.eqqx2.com` (200), wildcard `*.eqqx2.com` reaches the sites server (404 for a site that does not exist). The gym and downloader were restored from the old bundle (Nov 6 code, gym data from the 2026-11-09 backup) with `Desktop\Samsung Server\restore\restore-gym-eq.sh`; start lines were added to the phone's `~/.termux/boot/start-all.sh`. A backup of the previous boot script is at `~/start-all.sh.bak-restore` on the phone (never keep a copy in `~/.termux/boot/`: Termux:Boot runs every file there). Secrets copied to the phone were deleted afterwards. Not verified: a full phone reboot, a real login in the apps, a deployed test site.

Update 2026-11-11: `downloader.eqqx2.com` is now API-only. Phone nginx (8081) serves no static files: `/api/` is proxied to uvicorn, everything else is 404, and a request with an Origin header other than `https://download.eqqx2.com` gets 403 (no Origin is allowed, for plain download links). The phone now runs the repo `eq_server.py` (CORS). Backups: `~/nginx.conf.bak-apionly` and `~/eq_server.py.bak-apionly`.

## Where we stopped
Resolved on 2026-11-11: the user redid the login through PC Chrome and the public address answers 401. The exact commands the user ran are not recorded; if the 530 returns, the steps below are the recovery. Root cause, confirmed two ways:
- Dashboard check (Chrome, read-only): the account `Beboreport1@gmail.com` holds the live zone `eqqx2.com`. Its DNS records `api`, `files`, `downloader`, `gym` and `*` are type Tunnel pointing at tunnel `samsung-server` `dc6bab54-ff43-4575-a96a-bc78844e5a3e`, which is Down with 0 connections (made in the dashboard, never connected). `cbd9cda3-…` does not exist in this account.
- Doctor output on the phone: the phone's `cert.pem` belongs to a different Cloudflare account whose `eqqx2.com` zone is **pending** (nameservers `heidi`/`pete`). The public nameservers are `mia`/`ivan`. The phone's tunnel `cbd9cda3-287b-47b8-a80e-2aee13b537b4` (4 live connections) lives in that other account, so the live domain never sees it.
- The user re-ran `cloudflared tunnel login` on the phone. The phone browser is signed into the other account, so it picked the pending zone again.

Next steps, all in Termux except the browser step:
1. `mv ~/.cloudflared/cert.pem ~/.cloudflared/cert.pem.old2; mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.old2`
2. `cloudflared tunnel login`, then open the printed link in **PC Chrome signed in as Beboreport1** and pick `eqqx2.com`.
3. `cloudflared tunnel list` must show `samsung-server` as `dc6bab54-…`, not `cbd9cda3`. If not, the login went to the wrong account.
4. `bash ~/samsung-server/termux/tunnel-setup.sh eqqx2.com` (it deletes the empty dashboard tunnel and creates one with a key on the phone), then `sh ~/.termux/boot/start-all.sh`, then the curl above.

Fallback: skip `cert.pem`. Copy the install token of `samsung-server` from the dashboard (Networking > Tunnels) and run `cloudflared tunnel run --token <token>` on the phone. The `api.eqqx2.com` route to `127.0.0.1:8787` already exists there. The boot script would need a change to survive reboots. Never paste the token into chat or docs.

## Changes this session
- `agent/tunnel-doctor.js` and `agent/test/tunnel-doctor.test.js` (new): config, credentials, cert and zone checks; `--fix-ingress`, `--route`, `--probe`. Last commit `835a8ef` fixed its advice for a pending zone (it used to say to change registrar nameservers, which would move a live domain to the unused copy).
- `termux/install.sh`, `termux/tunnel-setup.sh`: repair an existing tunnel, probe the public address, never abort on doctor failure, pairing file to `Downloads/SamsungServer/`, login only when `cert.pem` is missing.
- `termux/start-all.example.sh`, `termux/watchdog.sh`: explicit `cloudflared tunnel --config "$CFG" run $TID`.
- `agent/pair.js`: default output `~/storage/downloads/SamsungServer/samsung-server.pair`.
- Android (`HttpErrors.kt`, `PairScan.kt`, `PairFolder.kt`, `FoundPairCard.kt`, `LoginScreen.kt`, `SamsungApp.kt`) and Windows app (`desktop/api.js`, `desktop/main.js`): 530 shows "Server unreachable (tunnel offline)"; Android finds the pairing file after a one-time folder grant, sign-in only on a tap.
- `docs/SETUP.md`, `README.md` (naming rule: never "s21", use "samsung"), version 0.13.5 (code 32).
- Outside the repo: old files moved to `C:\Users\Admin\Desktop\Samsung Server\` (own README), s21 names renamed to samsung, stale pair file deleted.

## Features added or updated
- Tunnel doctor: `node ~/samsung-server/agent/tunnel-doctor.js --domain eqqx2.com --probe`.
- Android "Pairing file found" card: grant `Download/SamsungServer` once via "Find pairing files automatically".

## Decisions and why
- The doctor only suggests `cloudflared tunnel delete`, never runs it: deletion is irreversible.
- Pairing file in `Downloads/SamsungServer/`: Android 11+ blocks granting the Download root.
- No `files.<domain>` ingress in the installer: the agent does not use it.
- Cloudflare dashboard checks run read-only through Claude in Chrome. Nothing was changed in the account.

## Unfinished (kept on purpose)
- Confirm a client signs in end to end (Android and Windows app) with a fresh `samsung-server.pair`. Only the 401 was verified.
- DNS records `files`, `downloader`, `gym` and `*` point at the dead dashboard tunnel. After the fix they still need `cloudflared tunnel route dns --overwrite-dns samsung-server <host>` and a matching ingress entry in `~/.cloudflared/config.yml` for each service the user wants. Ports unknown, ask the user.
- Delete the pending `eqqx2.com` copy in the other Cloudflare account, and the orphan tunnel `cbd9cda3` and old tunnel `s21` (`1895dcc4-3321-47aa-b926-554498c98d33`) there, once the new tunnel works.
- `Desktop\s21 server\` is locked by the running opengym MCP server (its data path is in `~/.claude.json` and Claude Desktop's config). Steps are in `Desktop\Samsung Server\README.md`.
- Not tested on a device: the Android card, the installer's tunnel and probe paths against real Cloudflare, the Windows app UI. No 0.13.5 release build was made (`scripts/release.ps1`).
- Skipped tests are platform-conditional symlink tests (`agent/test/resolveSafe.test.js`, `sites.test.js`). `agent/data/aria2.log` is a gitignored runtime log.

## Cleaned up this session
- Dropped: `PLAN.md`, stash `stale-s21-530-message-edits`, stale `samsung-server.pair` in Downloads.
- Finished: pushed all commits to `origin/main`.

## Open questions and blockers
- None blocking.
- Which local ports do `files`, `downloader` and `gym` use?

## Git state
Branch `main`, in sync with `origin/main`, last commit `835a8ef`. This handoff and the README stamp are uncommitted. No stashes.
