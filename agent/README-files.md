# File cloud API

Served by `server.js` next to `/status`. Every route needs `Authorization: Bearer <token>`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `FILES_ROOT` | `~/samsung-cloud` | Storage root. Created on startup. |
| `MAX_UPLOAD_BYTES` | `5368709120` | Largest accepted upload body (5 GiB). |

## Endpoints

All `path` values are relative to `FILES_ROOT`, use `/`, and `""` or `/` means the root.

- `GET /files/list?path=` lists a folder: folders first, then files, each A-Z ignoring case. `.trash` and `*.part` are hidden.
- `GET /files/download?path=` returns the file bytes. Supports one `Range: bytes=a-b` (206, suffix ranges too, 416 when out of range).
- `PUT /files/upload?path=<dir>&name=<file>[&overwrite=1]` takes the raw body. It streams to `<name>.part`, then renames. Returns 409 if the file exists and `overwrite` is not 1, and 413 over the size limit.
- `POST /files/mkdir` with `{"path":"photos/new"}`.
- `POST /files/rename` with `{"from":"a/b.txt","to":"a/c.txt"}`.
- `DELETE /files?path=` moves the item to `.trash`.

Errors are `{"error":"<code>"}`: `bad_path` 400, `not_found` 404, `exists` 409, `busy` 409, `too_large` 413, `not_a_directory` 400, `is_a_directory` 400, `internal` 500. A 416 carries `range_not_satisfiable`.

## Deleting

Delete moves the item to `FILES_ROOT/.trash/<timestamp>-<name>` and records its original path in `.trash/.meta/<entry>.json`. Entries older than `TRASH_DAYS` (default 30) are purged at startup and every 6 hours, sidecars with them. Sidecars younger than 60 seconds are never swept.

## Recycle bin

Entries are addressed by `id` (the entry name in `.trash`), never by a path. Ids with separators, `..` or a leading dot give `bad_path`.

- `GET /files/trash` returns `{"days":30,"items":[{"id","name","isDir","size","deletedAt","expiresAt","originalPath"}]}`, newest first. Times are epoch ms. `originalPath` is missing for entries deleted before the bin existed.
- `POST /files/trash/restore` with `{"id":"...","overwrite":false,"replaceType":false}` moves the entry back and returns `{"ok":true,"path":"<restored path>"}`. Missing parent folders are recreated. A taken target gives `exists` (409) unless `overwrite` is true. With `overwrite` the existing target is not deleted: it moves into `.trash` as a new entry with its own sidecar, so it can be restored in turn, and it goes back if the restore fails. If one side is a folder and the other a file, `exists` is returned even with `overwrite` unless `replaceType` is also true. A restore of an id that is already being restored gives `busy` (409). Moves across devices fall back to copy then delete. Entries with no recorded path go to `Restored/<name>`. Unknown id: `not_found`.
- `POST /files/trash/delete` with `{"id":"..."}` removes one entry for good.
- `POST /files/trash/empty` removes every entry and returns `{"ok":true,"removed":<n>}`.

## Cloudflare limit

Through a Cloudflare tunnel on the free plan, a single request body is capped at 100 MB. Larger uploads fail before they reach the agent. The client has to split big files or use a connection that skips Cloudflare.

## Tests

`npm test` (Node 18+, no dependencies).
