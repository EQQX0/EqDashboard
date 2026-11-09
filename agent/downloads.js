// Downloads for the Samsung server agent. Zero dependencies; Node 18+ built-ins only.
// Direct links, torrents and magnets go to an aria2 daemon (JSON-RPC on 127.0.0.1); video pages go to yt-dlp.
// Finished files land in FILES_ROOT/downloads, so they show up in the Files tab.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');
const { spawn } = require('child_process');
const files = require('./files');

const FILE_EXT = new Set([
  'zip', 'rar', '7z', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'iso', 'img', 'apk', 'deb', 'rpm', 'exe', 'msi', 'dmg', 'pkg',
  'pdf', 'epub', 'mobi', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'json', 'bin',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac',
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'torrent',
]);
const MODES = new Set(['auto', 'direct', 'video', 'audio']);
const ARIA_KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorMessage', 'files', 'bittorrent', 'followedBy'];
const ARIA_STATUS = { active: 'active', waiting: 'queued', paused: 'paused', error: 'error', complete: 'complete' };
const ID_RE = /^([0-9a-f]{16}|y[0-9a-f]{12})$/;
const LIST_CAP = 200;

class ApiError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

function sendJson(res, code, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---- source URLs -----------------------------------------------------------------

function isBlockedHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]); const b = Number(v4[2]);
    // Home-network addresses stay allowed on purpose (downloading from a NAS or router share is a normal use).
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^fe[89ab]/.test(h)) return true; // link-local
    // URL parsing rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1; decode the embedded IPv4 and check it.
    const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return isBlockedHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^::ffff:/.test(h)) return isBlockedHost(h.slice(7));
  }
  return false;
}

// Returns { kind: 'magnet' | 'http', url } or throws ApiError.
function parseSource(raw, allowPrivate) {
  if (typeof raw !== 'string') throw new ApiError(400, 'bad_url');
  const s = raw.trim();
  if (!s || s.length > 4096) throw new ApiError(400, 'bad_url');
  if (/^magnet:\?/i.test(s)) {
    if (!/[?&]xt=urn:bt(ih|mh):/i.test(s)) throw new ApiError(400, 'bad_url');
    return { kind: 'magnet', url: s };
  }
  let u;
  try { u = new URL(s); } catch { throw new ApiError(400, 'bad_url'); }
  if (!['http:', 'https:', 'ftp:'].includes(u.protocol) || !u.hostname) throw new ApiError(400, 'bad_url');
  if (!allowPrivate && isBlockedHost(u.hostname)) throw new ApiError(400, 'blocked_url');
  return { kind: 'http', url: u.href };
}

function sourceLabel(url) {
  if (/^magnet:/i.test(url)) {
    const m = /[?&]dn=([^&]+)/i.exec(url);
    if (m) { try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).slice(0, 200); } catch { /* fall through */ } }
    return 'Magnet link';
  }
  try {
    const u = new URL(url);
    return (u.host + u.pathname).slice(0, 200); // no credentials, no query string
  } catch { return ''; }
}

function nameFromUrl(url) {
  if (/^magnet:/i.test(url)) return sourceLabel(url);
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch { return url.slice(0, 60); }
}

function chooseEngine(src, mode) {
  if (src.kind === 'magnet') return 'aria2';
  if (mode === 'video' || mode === 'audio') return 'ytdlp';
  if (mode === 'direct') return 'aria2';
  let ext = '';
  try { ext = path.extname(new URL(src.url).pathname).slice(1).toLowerCase(); } catch { /* none */ }
  return FILE_EXT.has(ext) ? 'aria2' : 'ytdlp';
}

// ---- factory ------------------------------------------------------------------------

function createDownloads(opts = {}) {
  const env = process.env;
  const FILES_ROOT = path.resolve(opts.filesRoot || files.FILES_ROOT);
  const DL_DIR = path.join(FILES_ROOT, 'downloads');
  const PARTIAL = path.join(DL_DIR, '.partial');
  const DATA_DIR = path.resolve(opts.dataDir || env.DATA_DIR || path.join(__dirname, 'data'));
  const META_FILE = path.join(DATA_DIR, 'downloads.json');
  const SESSION = path.join(DATA_DIR, 'aria2.session');
  const SECRET_FILE = path.join(DATA_DIR, 'aria2.secret');
  const EXTERNAL_ARIA = opts.aria2Url || env.ARIA2_RPC_URL || null;
  const ARIA_PORT = Number(opts.aria2Port || env.ARIA2_RPC_PORT || 6800);
  const ARIA_URL = EXTERNAL_ARIA || `http://127.0.0.1:${ARIA_PORT}/jsonrpc`;
  const ARIA_BIN = opts.aria2Bin || env.ARIA2_BIN || 'aria2c';
  const CAN_SPAWN = !EXTERNAL_ARIA && opts.spawnAria2 !== false;
  const YT_CMD = opts.ytdlpCmd || [env.YTDLP_BIN || 'yt-dlp'];
  const ALLOW_PRIVATE = !!opts.allowPrivate || env.DL_ALLOW_PRIVATE === '1';
  const MIN_FREE = Number(opts.minFree !== undefined ? opts.minFree : (env.DL_MIN_FREE_BYTES || 524288000));
  const MAX_YT = Number(opts.maxYtdlp || 2);
  const LOOKUP = opts.lookup || ((h) => dns.promises.lookup(h, { all: true }));

  let secret = opts.aria2Secret !== undefined ? opts.aria2Secret : (env.ARIA2_RPC_SECRET || '');
  let meta = { aria2: {}, ytdlp: {} }; // aria2: gid -> { url, createdAt }; ytdlp: id -> job record
  const procs = new Map(); // yt-dlp id -> child
  let loaded = false;
  let ariaOk = false;
  let ariaBinMissing = false;
  let ariaTriedAt = 0;
  let ytOk = null;
  let ytCheckedAt = 0;

  // ---- persistence -----------------------------------------------------------------

  function init() {
    if (loaded) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      const v = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
      if (v && typeof v === 'object') {
        if (v.aria2 && typeof v.aria2 === 'object') meta.aria2 = v.aria2;
        if (v.ytdlp && typeof v.ytdlp === 'object') meta.ytdlp = v.ytdlp;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('downloads: metadata unreadable, starting empty:', e.code || e.message);
    }
    for (const j of Object.values(meta.ytdlp)) {
      if (j.status === 'active' || j.status === 'queued') { j.status = 'paused'; j.speedBps = 0; j.etaSec = null; }
    }
    if (!EXTERNAL_ARIA && opts.aria2Secret === undefined && !secret) {
      try { secret = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch { /* first run */ }
      if (!secret) {
        secret = hex(16);
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
      }
    }
    loaded = true;
  }

  function save() {
    const tmp = META_FILE + '.tmp-' + hex(4);
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, ...meta }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, META_FILE);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      console.error('downloads: could not save metadata:', e.code || e.message);
    }
  }

  // ---- aria2 JSON-RPC -------------------------------------------------------------------

  function rpc(method, params = []) {
    return new Promise((resolve, reject) => {
      const full = secret ? [`token:${secret}`, ...params] : params;
      const body = JSON.stringify({ jsonrpc: '2.0', id: 'samsung', method, params: full });
      const u = new URL(ARIA_URL);
      const req = http.request({
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', agent: false, timeout: 4000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let j;
          try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new Error('bad_rpc_response')); }
          if (j && j.error) {
            const err = new Error(String(j.error.message || 'rpc_error'));
            err.rpc = true;
            return reject(err);
          }
          resolve(j.result);
        });
      });
      req.on('timeout', () => req.destroy(new Error('rpc_timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }

  async function ariaReachable() {
    try { await rpc('aria2.getVersion'); return true; } catch { return false; }
  }

  async function startAria() {
    if (await ariaReachable()) { ariaOk = true; return true; }
    ariaOk = false;
    if (!CAN_SPAWN || ariaBinMissing) return false;
    try { if (!fs.existsSync(SESSION)) fs.writeFileSync(SESSION, ''); } catch { /* aria2 will cope */ }
    let log = 'ignore';
    try { log = fs.openSync(path.join(DATA_DIR, 'aria2.log'), 'a'); } catch { /* no log */ }
    const args = [
      '--enable-rpc', `--rpc-listen-port=${ARIA_PORT}`, '--rpc-listen-all=false', `--rpc-secret=${secret}`,
      `--dir=${DL_DIR}`, '--continue=true', '--max-concurrent-downloads=3', '--max-connection-per-server=4',
      '--split=4', '--min-split-size=5M', '--file-allocation=none', '--seed-time=0', '--follow-torrent=true',
      `--save-session=${SESSION}`, `--input-file=${SESSION}`, '--save-session-interval=30', '--summary-interval=0',
      '--console-log-level=warn',
    ];
    try {
      // Detached: downloads keep running while the agent restarts; the next agent re-attaches using the saved secret.
      const child = spawn(ARIA_BIN, args, { detached: true, stdio: ['ignore', log, log] });
      child.on('error', (e) => { if (e.code === 'ENOENT') ariaBinMissing = true; });
      child.unref();
    } catch (e) {
      if (e.code === 'ENOENT') ariaBinMissing = true;
      return false;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (ariaBinMissing) return false;
      if (await ariaReachable()) { ariaOk = true; return true; }
    }
    return false;
  }

  async function ensureAria() {
    if (ariaOk) return true;
    if (Date.now() - ariaTriedAt < 15000) return false;
    ariaTriedAt = Date.now();
    return startAria();
  }

  // ---- yt-dlp --------------------------------------------------------------------------

  function checkYt() {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const c = spawn(YT_CMD[0], [...YT_CMD.slice(1), '--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
        const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } fin(false); }, 8000);
        t.unref();
        c.on('error', () => fin(false));
        c.on('close', (code) => { clearTimeout(t); fin(code === 0); });
      } catch { fin(false); }
    });
  }

  async function ytReady() {
    if (ytOk === true) return true;
    if (ytOk === false && Date.now() - ytCheckedAt < 30000) return false;
    ytOk = await checkYt();
    ytCheckedAt = Date.now();
    return ytOk;
  }

  const rel = (abs) => {
    const r = path.relative(FILES_ROOT, abs);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : null;
  };

  function ytArgs(job) {
    const a = [
      '--newline', '--no-playlist', '--no-warnings', '--no-simulate', '--progress', '--continue',
      // Each job works in its own folder; the finished file is moved into downloads afterwards. Never download
      // straight into downloads: audio extraction would treat (and delete) a same-named finished file as its source.
      '--paths', `home:${path.join(PARTIAL, job.id, 'out')}`, '--paths', `temp:${path.join(PARTIAL, job.id, 'tmp')}`,
      '-o', '%(title).120B [%(id)s].%(ext)s',
      '--print', 'before_dl:NAME|%(title)s',
      '--print', 'after_move:FINAL|%(filepath)s',
      '--progress-template', 'download:DL|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    ];
    if (job.mode === 'audio') a.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    else a.push('-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4');
    a.push('--', job.url);
    return a;
  }

  // Moves a finished file into downloads, adding " (1)", " (2)" ... if the name is taken. Returns the new path.
  async function moveIntoDownloads(src) {
    await fsp.mkdir(DL_DIR, { recursive: true });
    const ext = path.extname(src);
    const base = path.basename(src, ext);
    for (let i = 0; i < 1000; i++) {
      const dest = path.join(DL_DIR, i === 0 ? base + ext : `${base} (${i})${ext}`);
      try { await fsp.lstat(dest); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        await fsp.rename(src, dest);
        return dest;
      }
    }
    throw new Error('too many files with that name');
  }

  async function onlyFileIn(dir) {
    try {
      const ents = await fsp.readdir(dir, { withFileTypes: true });
      const f = ents.find((e) => e.isFile() && !/\.(part|ytdl)$/.test(e.name));
      return f ? path.join(dir, f.name) : null;
    } catch { return null; }
  }

  function startYt(job) {
    job.status = 'active';
    job.error = null;
    job.speedBps = 0;
    let child;
    try {
      fs.mkdirSync(path.join(PARTIAL, job.id), { recursive: true });
      child = spawn(YT_CMD[0], [...YT_CMD.slice(1), ...ytArgs(job)], { cwd: path.join(PARTIAL, job.id), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      job.status = 'error';
      job.error = 'Could not start yt-dlp';
      save();
      return;
    }
    procs.set(job.id, child);
    let errLine = '';
    let buf = '';
    let finalTmp = null;
    const onLine = (line) => {
      let m;
      if ((m = /^DL\|(.*)$/.exec(line))) {
        const [done, total, est, speed, eta] = m[1].split('|').map((x) => (x === 'NA' || x === 'None' || x === '' ? null : num(x)));
        if (done !== null) job.doneBytes = Math.round(done);
        const t = total || est;
        if (t) job.totalBytes = Math.round(t);
        job.speedBps = speed ? Math.round(speed) : 0;
        job.etaSec = eta !== null ? Math.round(eta) : null;
      } else if ((m = /^NAME\|(.*)$/.exec(line))) {
        if (m[1]) job.name = m[1].slice(0, 200);
      } else if ((m = /^FINAL\|(.*)$/.exec(line))) {
        finalTmp = path.resolve(m[1]);
      }
    };
    child.stdout.on('data', (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 65536) buf = '';
    });
    child.stderr.on('data', (d) => {
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) errLine = l.trim();
    });
    child.on('error', () => { errLine = 'Could not run yt-dlp'; });
    child.on('close', async (code) => {
      if (procs.get(job.id) !== child) return; // paused or removed by us
      procs.delete(job.id);
      job.speedBps = 0;
      job.etaSec = null;
      if (code === 0) {
        try {
          // Only trust the printed path if it is inside this job's own output folder (a page title can print fake lines).
          const outDir = path.join(PARTIAL, job.id, 'out');
          const inside = finalTmp ? path.relative(outDir, finalTmp) : '';
          const printed = finalTmp && inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? finalTmp : null;
          const out = printed || await onlyFileIn(outDir);
          if (!out) throw new Error('no output file');
          const dest = await moveIntoDownloads(out);
          job.path = rel(dest);
          job.name = path.basename(dest);
          job.totalBytes = job.doneBytes = (await fsp.stat(dest)).size;
          job.status = 'complete';
          job.error = null;
          await fsp.rm(path.join(PARTIAL, job.id), { recursive: true, force: true }).catch(() => {});
        } catch (e) {
          job.status = 'error';
          job.error = 'Could not save the finished file';
        }
        if (meta.ytdlp[job.id] !== job) return; // removed while the file was being moved
      } else {
        job.status = 'error';
        job.error = (errLine || `yt-dlp exited with code ${code}`).replace(/^ERROR:\s*/, '').slice(0, 300);
      }
      save();
      pump();
    });
    save();
  }

  function pump() {
    let running = 0;
    for (const j of Object.values(meta.ytdlp)) if (j.status === 'active') running++;
    for (const j of Object.values(meta.ytdlp)) {
      if (running >= MAX_YT) break;
      if (j.status === 'queued') { startYt(j); running++; }
    }
  }

  function killYt(id) {
    const c = procs.get(id);
    if (!c) return;
    procs.delete(id); // marks the close as ours
    try { c.kill(); } catch { /* already gone */ }
  }

  const ytItem = (j) => ({
    id: j.id, engine: 'ytdlp', source: sourceLabel(j.url), name: j.name, status: j.status,
    totalBytes: j.totalBytes || 0, doneBytes: j.doneBytes || 0, speedBps: j.speedBps || 0, etaSec: j.etaSec,
    error: j.error || null, path: j.path || null, createdAt: j.createdAt,
  });

  // ---- aria2 items ----------------------------------------------------------------------------

  function ariaItem(s) {
    const m = meta.aria2[s.gid] || {};
    const fl = Array.isArray(s.files) ? s.files : [];
    const info = s.bittorrent && s.bittorrent.info;
    let name = (info && info.name) || '';
    let p = null;
    if (fl.length > 1 && info && info.name) {
      p = rel(path.join(DL_DIR, info.name));
    } else if (fl[0] && fl[0].path) {
      p = rel(fl[0].path);
      if (!name) name = path.basename(fl[0].path);
    }
    if (!name) name = nameFromUrl(m.url || '');
    const total = num(s.totalLength) || 0;
    const done = num(s.completedLength) || 0;
    const speed = num(s.downloadSpeed) || 0;
    const status = ARIA_STATUS[s.status] || 'error';
    return {
      id: s.gid, engine: 'aria2', source: sourceLabel(m.url || ''), name, status,
      totalBytes: total, doneBytes: done, speedBps: speed,
      etaSec: status === 'active' && speed > 0 && total > done ? Math.ceil((total - done) / speed) : null,
      error: status === 'error' ? String(s.errorMessage || 'Download failed').slice(0, 300) : null,
      path: status === 'complete' ? p : null, createdAt: m.createdAt || null,
    };
  }

  async function ariaItems() {
    const [active, waiting, stopped] = await Promise.all([
      rpc('aria2.tellActive', [ARIA_KEYS]),
      rpc('aria2.tellWaiting', [0, LIST_CAP, ARIA_KEYS]),
      rpc('aria2.tellStopped', [0, LIST_CAP, ARIA_KEYS]),
    ]);
    const all = [...active, ...waiting, ...stopped];
    // A magnet first downloads its metadata under one gid, then continues under another: show only the second.
    const out = all
      .filter((s) => s.status !== 'removed' && !(Array.isArray(s.followedBy) && s.followedBy.length && s.status === 'complete'))
      .map(ariaItem);
    const seen = new Set(all.map((s) => s.gid));
    let pruned = false;
    for (const gid of Object.keys(meta.aria2)) {
      if (!seen.has(gid)) { delete meta.aria2[gid]; pruned = true; }
    }
    if (pruned) save();
    return out;
  }

  // ---- operations ------------------------------------------------------------------------------

  // The downloads folder is created on first use, so measure the nearest folder that exists.
  async function freeBytes() {
    let dir = DL_DIR;
    for (let i = 0; i < 8; i++) {
      try {
        const s = await fsp.statfs(dir);
        return Number(s.bavail) * Number(s.bsize);
      } catch (e) {
        if (e.code !== 'ENOENT') return null;
        const up = path.dirname(dir);
        if (up === dir) return null;
        dir = up;
      }
    }
    return null;
  }

  async function list() {
    let items = [];
    if (ariaOk || await ensureAria()) {
      try { items = await ariaItems(); ariaOk = true; } catch { ariaOk = false; ariaTriedAt = 0; }
    }
    items.push(...Object.values(meta.ytdlp).map(ytItem));
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { dir: 'downloads', engines: { aria2: ariaOk, ytdlp: ytOk === true }, freeBytes: await freeBytes(), items: items.slice(0, LIST_CAP) };
  }

  // A public-looking name can still point at this phone or the home network; refuse it when it resolves there.
  async function checkResolved(url) {
    if (ALLOW_PRIVATE) return;
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return; // literal addresses were checked by parseSource
    let addrs;
    try { addrs = await LOOKUP(host); } catch { return; } // cannot resolve: the engine will fail on its own
    if (addrs.some((a) => isBlockedHost(a.address))) throw new ApiError(400, 'blocked_url');
  }

  async function add(body) {
    const src = parseSource(body.url, ALLOW_PRIVATE);
    if (src.kind === 'http') await checkResolved(src.url);
    const mode = body.mode === undefined ? 'auto' : body.mode;
    if (!MODES.has(mode)) throw new ApiError(400, 'bad_mode');
    const engine = chooseEngine(src, mode);
    const free = await freeBytes();
    if (free !== null && free < MIN_FREE) throw new ApiError(507, 'low_space', { freeBytes: free });
    await fsp.mkdir(DL_DIR, { recursive: true });
    const now = new Date().toISOString();
    if (engine === 'aria2') {
      if (!(await ensureAria()) && !ariaOk) throw new ApiError(503, 'engine_missing', { engine: 'aria2' });
      let gid;
      try { gid = await rpc('aria2.addUri', [[src.url], { dir: DL_DIR }]); } catch (e) {
        throw new ApiError(502, 'engine_error', { engine: 'aria2' });
      }
      meta.aria2[gid] = { url: src.url, createdAt: now };
      save();
      let st;
      try { st = await rpc('aria2.tellStatus', [gid, ARIA_KEYS]); } catch { st = { gid, status: 'waiting' }; }
      return ariaItem(st);
    }
    if (!(await ytReady())) throw new ApiError(503, 'engine_missing', { engine: 'ytdlp' });
    const id = 'y' + hex(6);
    const job = {
      id, url: src.url, mode: mode === 'audio' ? 'audio' : 'video', status: 'queued', name: nameFromUrl(src.url),
      totalBytes: 0, doneBytes: 0, speedBps: 0, etaSec: null, error: null, path: null, createdAt: now,
    };
    meta.ytdlp[id] = job;
    save();
    pump();
    return ytItem(job);
  }

  function checkId(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new ApiError(400, 'bad_id');
    return id;
  }

  async function ariaStatus(gid) {
    try { return await rpc('aria2.tellStatus', [gid, ARIA_KEYS]); } catch (e) {
      if (e.rpc) throw new ApiError(404, 'not_found');
      throw new ApiError(503, 'engine_missing', { engine: 'aria2' });
    }
  }

  async function pause(id) {
    checkId(id);
    if (id.startsWith('y')) {
      const j = meta.ytdlp[id];
      if (!j) throw new ApiError(404, 'not_found');
      if (j.status === 'active' || j.status === 'queued') {
        killYt(id);
        j.status = 'paused';
        j.speedBps = 0;
        j.etaSec = null;
        save();
        pump();
      }
      return;
    }
    await ariaStatus(id);
    try { await rpc('aria2.forcePause', [id]); } catch (e) { if (!e.rpc) throw new ApiError(503, 'engine_missing', { engine: 'aria2' }); }
  }

  async function resume(id) {
    checkId(id);
    if (id.startsWith('y')) {
      const j = meta.ytdlp[id];
      if (!j) throw new ApiError(404, 'not_found');
      if (j.status === 'paused' || j.status === 'error') {
        j.status = 'queued';
        j.error = null;
        save();
        pump();
      }
      return;
    }
    await ariaStatus(id);
    try { await rpc('aria2.unpause', [id]); } catch (e) { if (!e.rpc) throw new ApiError(503, 'engine_missing', { engine: 'aria2' }); }
  }

  // Removing a download only forgets it. A finished file stays; partial files are deleted.
  async function remove(id) {
    checkId(id);
    if (id.startsWith('y')) {
      const j = meta.ytdlp[id];
      if (!j) throw new ApiError(404, 'not_found');
      killYt(id);
      delete meta.ytdlp[id];
      save();
      await fsp.rm(path.join(PARTIAL, id), { recursive: true, force: true }).catch(() => {});
      pump();
      return;
    }
    const st = await ariaStatus(id);
    const finished = st.status === 'complete' || st.status === 'removed';
    if (st.status !== 'error' && !finished) {
      try { await rpc('aria2.forceRemove', [id]); } catch (e) { if (!e.rpc) throw new ApiError(503, 'engine_missing', { engine: 'aria2' }); }
    }
    try { await rpc('aria2.removeDownloadResult', [id]); } catch { /* already gone */ }
    if (!finished) {
      for (const f of Array.isArray(st.files) ? st.files : []) {
        if (!f.path) continue;
        const abs = path.resolve(f.path);
        const inside = path.relative(DL_DIR, abs);
        if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
          await fsp.rm(abs, { force: true }).catch(() => {});
          await fsp.rm(abs + '.aria2', { force: true }).catch(() => {});
        }
      }
    }
    delete meta.aria2[id];
    save();
  }

  // ---- HTTP handlers -----------------------------------------------------------------------------

  function readBody(req, limit = 16384) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on('data', (c) => {
        n += c.length;
        if (n > limit) { reject(new ApiError(413, 'too_large')); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
          if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0;
          resolve(v);
        } catch { reject(new ApiError(400, 'bad_request')); }
      });
      req.on('error', () => reject(new ApiError(400, 'bad_request')));
    });
  }

  function wrap(fn) {
    return async (req, res, url) => {
      try {
        init();
        await fn(req, res, url);
      } catch (e) {
        if (e instanceof ApiError) sendJson(res, e.status, { error: e.code, ...e.extra });
        else {
          console.error('downloads error:', (e && (e.code || e.message)) || 'unknown');
          sendJson(res, 500, { error: 'internal' });
        }
      }
      if (!req.readableEnded && !req.destroyed) {
        req.resume();
        setTimeout(() => req.destroy(), 10000).unref();
      }
    };
  }

  const routes = {
    'GET /downloads/list': wrap(async (req, res) => sendJson(res, 200, await list())),
    'POST /downloads/add': wrap(async (req, res) => {
      const item = await add(await readBody(req));
      sendJson(res, 200, { ok: true, item });
    }),
    'POST /downloads/pause': wrap(async (req, res) => { await pause((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    'POST /downloads/resume': wrap(async (req, res) => { await resume((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    'DELETE /downloads': wrap(async (req, res, url) => { await remove(url.searchParams.get('id')); sendJson(res, 200, { ok: true }); }),
  };

  async function start() {
    init();
    await Promise.all([startAria().catch(() => {}), ytReady().catch(() => {})]);
    pump();
  }

  function stop() {
    for (const id of [...procs.keys()]) killYt(id);
  }

  return { routes, start, stop, init, list, add, pause, resume, remove, DL_DIR };
}

const instance = createDownloads();

module.exports = {
  createDownloads, parseSource, chooseEngine, isBlockedHost, sourceLabel,
  routes: instance.routes, start: instance.start, stop: instance.stop,
};
