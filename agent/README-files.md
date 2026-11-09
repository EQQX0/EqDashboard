# File cloud API

Served by `server.js` next to `/status`. Every route needs `Authorization: Bearer <token>`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `FILES_ROOT` | `~/s21-cloud` | Storage root. Created on startup. |
| `MAX_UPLOAD_BYTES` | `5368709120` | Largest accepted upload body (5 GiB). |

## Endpoints

All `path` values are relative to `FILES_ROOT`, use `/`, and `""` or `/` means the root.

- `GET /files/list?path=` lists a folder: folders first, then files, each A-Z ignoring case. `.trash` and `*.part` are hidden.
- `GET /files/download?path=` returns the file bytes. Supports one `Range: bytes=a-b` (206, suffix ranges too, 416 when out of range).
- `PUT /files/upload?path=<dir>&name=<file>[&overwrite=1]` takes the raw body. It streams to `<name>.part`, then renames. Returns 409 if the file exists and `overwrite` is not 1, and 413 over the size limit.
- `POST /files/mkdir` with `{"path":"photos/new"}`.
- `POST /files/rename` with `{"from":"a/b.txt","to":"a/c.txt"}`.
- `DELETE /files?path=` moves the item to `.trash`.

Errors are `{"error":"<code>"}`: `bad_path` 400, `not_found` 404, `exists` 409, `too_large` 413, `not_a_directory` 400, `is_a_directory` 400, `internal` 500. A 416 carries `range_not_satisfiable`.

## Deleting

Delete never removes data. The item moves to `FILES_ROOT/.trash/<timestamp>-<name>`. Empty the trash by hand.

## Cloudflare limit

Through a Cloudflare tunnel on the free plan, a single request body is capped at 100 MB. Larger uploads fail before they reach the agent. The client has to split big files or use a connection that skips Cloudflare.

## Tests

`npm test` (Node 18+, no dependencies).
