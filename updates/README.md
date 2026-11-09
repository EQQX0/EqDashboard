# S21 updates gate

Private gate that lets the S21 Control app find and download APKs from releases of a private GitHub repo. The app never holds a GitHub token.

## Env vars (Vercel)

- `TOKEN_SHA256`: hex SHA-256 of the bearer token the app sends.
- `GITHUB_TOKEN`: read-only fine-grained token.
- `GITHUB_REPO`: optional, default `EQQX0/EqDashboard`.

If `TOKEN_SHA256` or `GITHUB_TOKEN` is missing, every route returns 503.

## GitHub token

Settings -> Developer settings -> Fine-grained tokens -> Generate. Select only the repo `EQQX0/EqDashboard`. Repository permissions: Contents Read-only. Nothing else.

## TOKEN_SHA256

    printf %s "$TOKEN" | sha256sum

PowerShell:

    $b = [Text.Encoding]::UTF8.GetBytes($env:TOKEN)
    -join ([Security.Cryptography.SHA256]::Create().ComputeHash($b) | ForEach-Object { $_.ToString('x2') })

## Endpoints

Both need `Authorization: Bearer <token>`.

- `GET /api/latest` returns `{versionCode, versionName, sha256, size, notes, publishedAt}` from the latest release's `meta.json`. The release also needs an `app.apk` asset.
- `GET /api/apk?versionCode=N` returns `{url, expiresInSec}`: a short-lived signed download URL for `app.apk`, only if N matches the latest release.

Errors are `{"error": code}`: `unauthorized` 401, `too_many_failures` or `too_many_requests` 429, `not_configured` 503, `no_release` or `no_such_version` 404, `upstream` 502, 405 for non-GET.
Rate limits are in memory per instance: 5 failed auths/min and 60 requests/min per IP.
