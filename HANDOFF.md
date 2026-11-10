# Handoff

Date: 2026-11-10 23:38 AST
Session summary: Login failed on every client with HTTP 530 (Cloudflare error 1033). We built a tunnel diagnosis tool, hardened the installer, made both apps show a clear 530 message, and added pairing-file auto-detect to the Android app. Released as 0.13.5. The 530 itself is not fixed.

## Start here
1. Read README.md for the project map.
2. First action: check the Cloudflare dashboard (the code cannot see it). On the phone, after `git pull` in `~/samsung-server`, run `node ~/samsung-server/agent/tunnel-doctor.js --probe` and read its `PROBLEM:` and `FIX:` lines.
3. Verify with: `curl -s -o /dev/null -w "%{http_code}\n" https://api.eqqx2.com/status` (expect 401, not 530).

## Where we stopped
The tunnel `samsung-server` (`cbd9cda3-287b-47b8-a80e-2aee13b537b4`) shows 4 live connections and the local agent answers 401 on `127.0.0.1:8787`. `cloudflared tunnel route dns` replies "already configured to route to your tunnel". The public address still answers 530 / 1033. So the record Cloudflare serves for `api.eqqx2.com` does not match the tunnel that is running. Next: the dashboard checks below, which only the user can do.

## Changes this session
- `agent/tunnel-doctor.js` (new): config, credentials and cert checks, `--fix-ingress`, `--route`, `--probe`. Never deletes tunnels, never prints tokens.
- `agent/test/tunnel-doctor.test.js` (new): 10 tests.
- `termux/install.sh`: repairs an existing tunnel, probes the public address, warns about old boot scripts, writes the pairing file to `Downloads/SamsungServer/`, never aborts when the doctor or tunnel setup fails.
- `termux/tunnel-setup.sh`: logs in only when `cert.pem` is missing, reuses an existing tunnel, writes `config.yml` only if absent.
- `termux/start-all.example.sh`, `termux/watchdog.sh`, `agent/README-sites.md`: explicit `cloudflared tunnel --config "$CFG" run $TID`.
- `agent/pair.js`: default output is `~/storage/downloads/SamsungServer/samsung-server.pair`.
- `app/.../data/HttpErrors.kt` (new) and the 7 clients: 530 shows "Server unreachable (tunnel offline)...".
- `app/.../data/PairScan.kt`, `PairFolder.kt`, `ui/FoundPairCard.kt` (new), `LoginScreen.kt`, `SamsungApp.kt`: Android finds the pairing file after a one-time folder grant.
- `desktop/api.js`, `desktop/main.js`: same 530 message, scans `Downloads/SamsungServer`.
- `docs/SETUP.md`: separate 502, 404 and 530/1033 entries.
- Version 0.13.5 (code 32) in `app/gradle.properties`, `agent/package.json`, `desktop/package.json`.
- `README.md`: troubleshooting, naming rule, pairing folder, AI-session pointer.

## Features added or updated
- Tunnel doctor: `node ~/samsung-server/agent/tunnel-doctor.js --domain eqqx2.com --probe`.
- Android "Pairing file found" card: grant `Download/SamsungServer` once via "Find pairing files automatically"; tapping "Use it" runs the normal import. No broad storage permission.

## Decisions and why
- Pairing file moved to `Downloads/SamsungServer/`: Android 11+ blocks granting the Download root, and MediaStore cannot see files Termux wrote. A one-time folder grant is the only permission-free route.
- Doctor only suggests `cloudflared tunnel delete <name>`: deletion is irreversible; the user decides.
- No `files.<domain>` ingress: nothing in the agent, apps or docs uses it.
- Never use "s21" in names (user rule, recorded in README). The Cloudflare tunnel named `s21` still exists on the account (0 connections); it is external and was not renamed.

## Unfinished (kept on purpose)
- The 530: unresolved. Dashboard checks for the user: (a) DNS `api` must be one proxied CNAME to `cbd9cda3-287b-47b8-a80e-2aee13b537b4.cfargotunnel.com`; (b) `eqqx2.com` must exist in one Cloudflare account and be Active (no Pending copy); (c) the old `s21` tunnel must not hold an `api` public hostname; (d) no Load Balancer or Worker route on `api`. If `cert.pem` belongs to another zone: `mv ~/.cloudflared/cert.pem ~/.cloudflared/cert.pem.old && cloudflared tunnel login`.
- Old tunnel `s21` (`1895dcc4-3321-47aa-b926-554498c98d33`): delete with `cloudflared tunnel delete s21` after checking it holds no records.
- The user's existing boot script may still run a bare `cloudflared tunnel run`; the installer only prints a notice.
- Not tested on a device: the Android card, the installer's tunnel and probe paths against real Cloudflare, the Windows app UI.

## Cleaned up this session
- Dropped: `PLAN.md` (working note), stash `stale-s21-530-message-edits`.
- Finished: pushed commit `146bf38` to `origin/main`.

## Open questions and blockers
- Which of the dashboard checks matches? Needs the user.
- Release build: 0.13.5 is committed and pushed but no release or APK/installer was built (`scripts/release.ps1`).

## Git state
Branch `main`, clean working tree, in sync with `origin/main`. Last commit `146bf38` "Diagnose 530/1033 tunnel failures, harden installer, find pairing file on Android; release 0.13.5". No stashes. This handoff and the README edits are uncommitted.
