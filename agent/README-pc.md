# Wake and shut down a PC

The Overview tab has a My PC section. Add a PC with its MAC address and home network address.

**Turn on** sends a Wake-on-LAN packet from the S21 to the network. The PC must be wired to the router, with Wake-on-LAN enabled in the BIOS and in the network adapter's power settings. Wi-Fi PCs usually can't wake this way.

**Turn off** makes the S21 sign in to the PC over SSH and run `shutdown`. Set it up once from the PC's "Set up shutdown" button: it shows one PowerShell command to run on the PC as administrator. The command installs OpenSSH Server and adds the S21's public key with a forced command, so that key can shut the PC down and do nothing else. Your Windows user must be an administrator.

The status chip comes from a quick connection test to ports 3389, 445, 135 and 22. A PC in sleep or off shows Off.

## API

All routes need the bearer token.

| Route | Purpose |
|---|---|
| `GET /pc/list` | PCs with online status, and the S21's public key |
| `POST /pc/add` | Body `{"name","mac","ip","sshUser","sshPort"}`. `ip` must be a home network address |
| `POST /pc/user` | Body `{"id","sshUser"}` |
| `POST /pc/wake` | Body `{"id"}` |
| `POST /pc/shutdown` | Body `{"id"}` |
| `POST /pc/key` | Creates the S21's SSH key if missing, returns the public half |
| `DELETE /pc?id=...` | Forget a PC |

Needs `pkg install openssh` in Termux (the setup script already installs it). The agent allows 8 PCs.
