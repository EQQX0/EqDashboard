# VPS slices

A slice is a small Linux (Debian, Ubuntu or Alpine) that runs inside Termux through proot-distro. Each slice has its own SSH server on its own port. You can log in, install packages with apt or apk, and run programs.

Install proot-distro once in Termux (the setup script already does this):

```sh
pkg install -y proot-distro
```

Create a slice from the VPS tab. The agent downloads the image, installs openssh, sets a random root password and starts SSH. The password shows once. Copy it then, or use "New password" later.

Log in from a computer on the same Wi-Fi:

```sh
ssh -p 2201 root@<phone-ip>
```

Slices get ports 2201, 2202 and so on. The VPS tab shows the exact command for each slice.

## API

All routes need the bearer token.

| Route | Purpose |
|---|---|
| `GET /vps/list` | Slices, available distros, phone address, free space |
| `POST /vps/create` | Body `{"name": "web", "distro": "debian", "sshKey": "ssh-ed25519 ..."}`. `sshKey` is optional; with a key, password login is off |
| `POST /vps/start` | Body `{"id": "web"}` |
| `POST /vps/stop` | Body `{"id": "web"}` |
| `POST /vps/password` | Body `{"id": "web"}`. Returns a new root password |
| `DELETE /vps?id=web` | Stops the slice and deletes its files |

Creating takes a few minutes on a first download. The list shows the current step while it runs.

## Updating the agent

The app checks once per run. When a newer `samsung-agent-X.Y.Z.zip` is attached to the latest GitHub release, Overview shows an "Update agent" card. The agent downloads the zip from GitHub only, checks the SHA-256 when GitHub supplies one, checks that every script parses, backs up the old files to `~/samsung-server/agent-backup`, copies the new ones over and restarts. `.token` and `data` are never touched. `GET /agent/update` checks and `POST /agent/update` applies.

## Limits

- No root means no systemd, no Docker and no kernel features. Services start by hand or from a script you run over SSH.
- SSH listens on the Wi-Fi address only. Cloudflare Tunnel does not carry it, so you cannot reach a slice from outside your network.
- The phone can kill background processes. Keep Termux unrestricted in battery settings and acquire a wake lock.
- Slices stop when the agent stops. After a reboot, start them again from the app.
- Names are lowercase letters, digits and dashes, up to 23 characters. The agent allows four slices; change it with `VPS_MAX`.
- Creating a slice fails with `low_space` when less than 1.5 GB is free. Set `VPS_MIN_FREE_BYTES` to change that.
- Set `VPS_BIND` to a phone address to limit SSH to one interface.
