# Static-site hosting

The agent serves static sites from `FILES_ROOT/sites/<name>/`. A site named `blog` is public at `https://blog.<SITES_DOMAIN>`. The agent only manages folders and serves them. It never edits tunnel config or DNS.

Two servers run in the one process: the authenticated agent API (`PORT`, 8787) and the public site server on `127.0.0.1:SITES_PORT`. The site server has no auth and is rate limited to 600 requests per minute per IP. If it fails, the agent keeps running.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SITES_PORT` | `8790` | Local port of the public site server |
| `SITES_DOMAIN` | none | Your domain. Sites are served at `<name>.<SITES_DOMAIN>`. Sites stay off until you set it |
| `SITE_ZIP_MAX_BYTES` | `524288000` | Largest zip accepted by deploy |
| `DATA_DIR` | `agent/data` | Holds `sites.json` (metadata) and `tmp/` |

## Endpoints

All need `Authorization: Bearer <token>`. Errors are `{"error": "<code>"}`.

- `GET /sites/list` returns `{domain, sites: [{name, hostname, enabled, spa, files, bytes, modified, createdAt}]}`.
- `POST /sites/create` with `{"name","spa"?}` makes the folder with a starter `index.html`. Errors: `bad_name`, `reserved_name`, `exists` (409).
- `POST /sites/update` with `{"name","enabled"?,"spa"?}`.
- `DELETE /sites?name=` moves the folder to `.trash/<timestamp>-site-<name>` and removes the metadata.
- `POST /sites/deploy?name=` takes raw zip bytes as the body and replaces the site. The old copy goes to `.trash/<timestamp>-site-<name>-old`. A zip with one top-level folder and no root `index.html` is flattened. Errors: `too_large` (413), `bad_zip`, `unsafe_zip`, `not_found`.
- `GET /sites/check?name=` makes an HTTPS request to the public hostname and returns `{hostname, reachable, status, error}`.

The Files API refuses to rename or delete `sites` and `sites/<name>` (`bad_path`). Files inside a site can be edited and uploaded normally.

Site behaviour: directories serve `index.html`, `404.html` is used if present, and `"spa": true` serves `/index.html` for missing paths without a file extension. Dotfiles and anything outside the site folder return 404.

## One-time wildcard routing (run on the phone)

```sh
sed -i '/^  - service: http_status:404/i\  - hostname: "*.yourdomain.com"\n    service: http://127.0.0.1:8790' ~/.cloudflared/config.yml
cloudflared tunnel route dns samsung-server "*.yourdomain.com"   # the tunnel is named s21 on older setups
```

Then restart cloudflared:

```sh
pkill cloudflared; nohup cloudflared tunnel run >> ~/cloudflared.log 2>&1 &
```

Explicit DNS records (api, gym, downloader, files, www, apex) keep winning over the wildcard. The free Cloudflare certificate covers one label only: `blog.yourdomain.com` works, `a.b.yourdomain.com` does not.
