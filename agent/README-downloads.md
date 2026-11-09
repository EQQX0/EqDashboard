# Downloads

The agent downloads links for you and saves them in `~/s21-cloud/downloads`, so they appear in the Files tab.

Direct links, torrents and magnets use aria2. Video pages use yt-dlp. Install both once in Termux:

```sh
pkg install -y aria2 ffmpeg python
pip install -U yt-dlp
```

The agent starts its own aria2 daemon on 127.0.0.1:6800 and keeps it running when the agent restarts, so downloads continue. The daemon's secret lives in `agent/data/aria2.secret`.

## API

All routes need the bearer token.

| Route | Purpose |
|---|---|
| `GET /downloads/list` | Items with progress, plus which engines work and the free space |
| `POST /downloads/add` | Body `{"url": "...", "mode": "auto"}`. Modes: `auto`, `direct`, `video`, `audio` |
| `POST /downloads/pause` | Body `{"id": "..."}` |
| `POST /downloads/resume` | Body `{"id": "..."}` |
| `DELETE /downloads?id=...` | Forget a download. Partial files go; finished files stay |

`auto` sends magnets, `.torrent` links and links ending in a file extension (zip, mp4, iso and so on) to aria2, and every other page to yt-dlp.

## Limits

- Accepted links: http, https, ftp and magnet. Links to localhost, 127.x and link-local addresses are refused. A hostname that resolves to one of those is not caught.
- Adding a download fails with `low_space` when less than 500 MB is free. Set `DL_MIN_FREE_BYTES` to change that.
- aria2 runs three downloads at once. yt-dlp runs two, and the rest wait in the queue.
- yt-dlp downloads one video, never a whole playlist. It takes up to 1080p and merges the video and audio into an mp4. `audio` mode saves an mp3.
- Each yt-dlp job works in `downloads/.partial/<id>` and moves the finished file into `downloads` under a free name, so it never overwrites an existing file.
- After an agent restart, unfinished yt-dlp jobs come back paused. Resume them from the app.
