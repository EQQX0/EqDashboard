# Pairing the app

`node pair.js` writes a small file that the Samsung Server app can import, so you do not type the token on a phone.

```
node pair.js --url https://api.example.com [--out <path>] [--force]
```

- The token comes from `AGENT_TOKEN`, else `TOKEN_FILE`, else `agent/.token`. With none of them, the command stops.
- The file holds `{"v":1,"url":"...","token":"..."}` and is created with mode 0600.
- The default path is `~/storage/downloads/samsung-server.pair`, or `./samsung-server.pair` when that folder is missing.
- An existing file is never overwritten unless you pass `--force`.
- The command prints the path and never the token.

In the app, tap "Import token file" on the sign-in screen and pick the file. Then delete it (`rm <path>`), because anyone who reads it can control the server.
