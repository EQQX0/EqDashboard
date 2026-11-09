// Static-site hosting for the Samsung server agent. Zero dependencies; Node 18+ built-ins only.
// Sites live in FILES_ROOT/sites/<name>/. A second HTTP server (public, no auth) serves them by Host header;
// the management API (bearer-auth, wired up by server.js) creates, updates, deploys and deletes them.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const files = require('./files');
const zip = require('./zip');
const tunnelCfg = require('./tunnel');

const { resolveSafe, parseRange } = files;

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED = new Set([
  'api', 'files', 'gym', 'downloader', 'www', 'mail', 'smtp', 'ftp', 'ssh', 'admin', 'root', 'app', 'dashboard',
  'cloud', 'sites', 'static', 'assets', 'eq', 'vercel', 'cdn', 'ns1', 'ns2',
]);
const WALK_CAP = 50000;
const RATE_LIMIT = 600;

const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', pdf: 'application/pdf', wasm: 'application/wasm',
  map: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8',
};

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, code, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const rand = () => crypto.randomBytes(8).toString('hex');

/** The `*.example.com` ingress entry that points at [port] on this machine, or ''. */
function domainFromTunnel(configPath, port) {
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    if (text.length > 262144) return '';
    for (const e of tunnelCfg.parseIngress(text)) {
      const t = tunnelCfg.serviceTarget(e.service);
      const m = /^\*\.([a-z0-9.-]+)$/i.exec(e.hostname || '');
      if (m && t && t.port === port && ['127.0.0.1', 'localhost'].includes(t.host)) return m[1];
    }
  } catch { /* no tunnel config */ }
  return '';
}

function createSites(opts = {}) {
  const FILES_ROOT = path.resolve(opts.filesRoot || files.FILES_ROOT);
  const SITES_ROOT = path.join(FILES_ROOT, 'sites');
  const TRASH = path.join(FILES_ROOT, '.trash');
  const DATA_DIR = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const TMP = path.join(DATA_DIR, 'tmp');
  const META_FILE = path.join(DATA_DIR, 'sites.json');
  const PORT = Number(opts.port !== undefined ? opts.port : (process.env.SITES_PORT || 8790));
  // No built-in domain. Use SITES_DOMAIN, else the wildcard hostname the tunnel already sends to the sites port.
  const DOMAIN = String(opts.domain || process.env.SITES_DOMAIN || domainFromTunnel(
    opts.tunnelConfig || process.env.TUNNEL_CONFIG || path.join(require('os').homedir(), '.cloudflared', 'config.yml'), PORT,
  )).toLowerCase().trim();
  const ZIP_MAX = Number(opts.zipMax || process.env.SITE_ZIP_MAX_BYTES || 524288000);
  // Test-only: probe this URL instead of https://<hostname>/ in /sites/check.
  const CHECK_URL = opts.checkUrl || process.env.SITES_TEST_CHECK_URL || null;

  let state = null; // { sites: { name: { enabled, spa, createdAt } } }
  const busy = new Set();

  // ---- metadata -----------------------------------------------------------

  function init() {
    if (state) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.rmSync(TMP, { recursive: true, force: true }); // leftovers from a crash
    fs.mkdirSync(TMP, { recursive: true });
    let loaded = {};
    try {
      const v = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
      if (v && typeof v.sites === 'object' && v.sites) loaded = v.sites;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('sites: metadata unreadable, starting empty:', e.code || e.message);
    }
    state = { sites: loaded };
  }

  function save() {
    const tmp = META_FILE + '.tmp-' + rand();
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, META_FILE);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw e;
    }
  }

  const siteDir = (name) => path.join(SITES_ROOT, name);

  // ---- public site server ---------------------------------------------------

  const rate = new Map();
  function limited(ip) {
    const now = Date.now();
    let arr = rate.get(ip);
    if (!arr) { arr = []; rate.set(ip, arr); }
    while (arr.length && now - arr[0] >= 60000) arr.shift();
    arr.push(now);
    return arr.length > RATE_LIMIT;
  }
  const rateSweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of rate) if (!arr.length || now - arr[arr.length - 1] >= 60000) rate.delete(ip);
  }, 60000);
  rateSweep.unref();

  function text(req, res, code, body, extra = {}) {
    res.writeHead(code, {
      'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const BUILTIN_404 = '<!doctype html><meta charset="utf-8"><title>Not found</title>'
    + '<body style="font:16px system-ui;margin:3rem"><h1>404</h1><p>Page not found.</p></body>';

  function siteForHost(hostHeader) {
    if (typeof hostHeader !== 'string') return null;
    const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
    const suffix = '.' + DOMAIN;
    if (!host.endsWith(suffix)) return null;
    const name = host.slice(0, -suffix.length);
    if (!NAME_RE.test(name)) return null;
    const site = state.sites[name];
    return site && site.enabled ? { name, ...site } : null;
  }

  // Parses the request target into safe path segments, or null if hostile.
  function parsePublicPath(target) {
    if (typeof target !== 'string' || !target.startsWith('/')) return null;
    const q = target.search(/[?#]/);
    const raw = q === -1 ? target : target.slice(0, q);
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { return null; }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const parts = decoded.split('/').slice(1);
    const trailing = parts.length > 0 && parts[parts.length - 1] === '';
    const segs = parts.filter((s) => s !== '');
    for (const s of segs) {
      if (s.startsWith('.') || s.endsWith('.part')) return null; // dotfiles, .., .trash, in-flight uploads
    }
    return { segs, trailing };
  }

  async function statFile(abs) {
    try { return await fsp.stat(abs); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'ENAMETOOLONG') return null;
      throw e;
    }
  }

  function etagOf(st) {
    return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  }
  function matchesEtag(header, etag) {
    if (!header) return false;
    const bare = etag.replace(/^W\//, '');
    return header.split(',').some((t) => {
      const v = t.trim();
      return v === '*' || v.replace(/^W\//, '') === bare;
    });
  }

  // Streams one file. `status` is 200 normally, 404 for error pages (no caching, no ranges).
  function sendFile(req, res, abs, st, status) {
    const ext = path.extname(abs).slice(1).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type };
    let start = 0;
    let end = st.size - 1;
    let code = status;
    if (status === 200) {
      const etag = etagOf(st);
      headers.ETag = etag;
      headers['Cache-Control'] = ext === 'html' ? 'public, max-age=60' : 'public, max-age=3600';
      headers['Accept-Ranges'] = 'bytes';
      if (matchesEtag(req.headers['if-none-match'], etag)) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      if (req.headers.range) {
        const r = parseRange(req.headers.range, st.size);
        if (r === 'unsat') {
          res.writeHead(416, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Range': `bytes */${st.size}`, 'Content-Length': 0 });
          res.end();
          return;
        }
        if (r) {
          code = 206;
          start = r.start;
          end = r.end;
          headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        }
      }
    } else {
      headers['Cache-Control'] = 'no-cache';
    }
    const len = st.size === 0 ? 0 : end - start + 1;
    headers['Content-Length'] = len;
    res.writeHead(code, headers);
    if (len === 0 || req.method === 'HEAD') { res.end(); return; }
    const rs = fs.createReadStream(abs, { start, end });
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  }

  async function notFound(req, res, root) {
    try {
      const abs = resolveSafe(root, '404.html');
      const st = await statFile(abs);
      if (st && st.isFile()) return sendFile(req, res, abs, st, 404);
    } catch { /* fall through to the built-in page */ }
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(BUILTIN_404), 'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : BUILTIN_404);
  }

  async function handlePublic(req, res) {
    res.setHeader('X-S21-Site', '1');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    if (limited(String(ip))) return text(req, res, 429, 'Too many requests', { 'Retry-After': '60' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return text(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    const site = siteForHost(req.headers.host);
    if (!site) return text(req, res, 404, 'Not found');
    const parsed = parsePublicPath(req.url);
    if (!parsed) return text(req, res, 404, 'Not found');
    const { segs, trailing } = parsed;

    const root = siteDir(site.name);
    if (!fs.existsSync(root)) return text(req, res, 404, 'Not found');

    let abs;
    try { abs = resolveSafe(root, segs.join('/')); } catch { return notFound(req, res, root); }
    const st = await statFile(abs);

    if (st && st.isDirectory()) {
      if (!trailing && segs.length > 0) {
        const loc = '/' + segs.map(encodeURIComponent).join('/') + '/';
        const q = req.url.indexOf('?');
        res.writeHead(301, { Location: loc + (q === -1 ? '' : req.url.slice(q)), 'Content-Length': 0 });
        return res.end();
      }
      let idx;
      try { idx = resolveSafe(root, [...segs, 'index.html'].join('/')); } catch { return notFound(req, res, root); }
      const ist = await statFile(idx);
      if (ist && ist.isFile()) return sendFile(req, res, idx, ist, 200);
      return notFound(req, res, root);
    }
    if (st && st.isFile() && !trailing) return sendFile(req, res, abs, st, 200);

    if (site.spa && !st && segs.length > 0 && path.extname(segs[segs.length - 1]) === '') {
      try {
        const idx = resolveSafe(root, 'index.html');
        const ist = await statFile(idx);
        if (ist && ist.isFile()) return sendFile(req, res, idx, ist, 200);
      } catch { /* fall through */ }
    }
    return notFound(req, res, root);
  }

  let server = null;
  function start() {
    if (server) return server;
    if (!DOMAIN) { console.log('sites are off: set SITES_DOMAIN to your domain to turn them on'); return null; }
    try {
      init();
      server = http.createServer((req, res) => {
        handlePublic(req, res).catch((e) => {
          console.error('sites request error:', (e && (e.code || e.message)) || 'unknown');
          try {
            if (!res.headersSent) text(req, res, 500, 'Internal error');
            else res.destroy();
          } catch { /* socket gone */ }
        });
      });
      server.on('error', (e) => console.error('sites server error:', (e && (e.code || e.message)) || 'unknown'));
      server.on('clientError', (e, sock) => { try { sock.destroy(); } catch { /* ignore */ } });
      server.requestTimeout = 60000;
      server.listen(PORT, '127.0.0.1', () => console.log(`sites listening on 127.0.0.1:${server.address().port} (*.${DOMAIN})`));
    } catch (e) {
      console.error('sites failed to start:', (e && (e.code || e.message)) || 'unknown');
    }
    return server;
  }

  // ---- management API ---------------------------------------------------------

  function wrap(fn, needsDomain = true) {
    return async (req, res, url) => {
      try {
        if (needsDomain && !DOMAIN) throw new ApiError(503, 'not_configured');
        init();
        await fn(req, res, url);
      } catch (e) {
        if (e instanceof ApiError) sendJson(res, e.status, { error: e.code });
        else if (e instanceof zip.ZipError) sendJson(res, 400, { error: e.code });
        else {
          console.error('sites error:', (e && (e.code || e.message)) || 'unknown');
          sendJson(res, 500, { error: 'internal' });
        }
      }
      if (!req.readableEnded && !req.destroyed) {
        req.resume();
        setTimeout(() => req.destroy(), 10000).unref();
      }
    };
  }

  function readBody(req, limit = 65536) {
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

  function checkName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new ApiError(400, 'bad_name');
    return name;
  }
  function existing(name) {
    checkName(name);
    if (!state.sites[name]) throw new ApiError(404, 'not_found');
    return state.sites[name];
  }
  function optBool(v) {
    if (v !== undefined && typeof v !== 'boolean') throw new ApiError(400, 'bad_request');
    return v;
  }

  async function walk(dir) {
    let count = 0; // entries visited, capped
    let nFiles = 0;
    let bytes = 0;
    let newest = 0;
    const stack = [dir];
    while (stack.length && count < WALK_CAP) {
      const d = stack.pop();
      let ents;
      try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const ent of ents) {
        if (++count > WALK_CAP) break;
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile()) {
          try {
            const s = await fsp.stat(p);
            nFiles++;
            bytes += s.size;
            if (s.mtimeMs > newest) newest = s.mtimeMs;
          } catch { /* vanished */ }
        }
      }
    }
    return { files: nFiles, bytes, modified: newest ? new Date(newest).toISOString() : null };
  }

  async function view(name) {
    const m = state.sites[name];
    const w = await walk(siteDir(name));
    return {
      name, hostname: `${name}.${DOMAIN}`, enabled: m.enabled, spa: m.spa,
      files: w.files, bytes: w.bytes, modified: w.modified, createdAt: m.createdAt,
    };
  }

  async function uniqueTrash(base) {
    await fsp.mkdir(TRASH, { recursive: true });
    for (let i = 0; ; i++) {
      const dest = path.join(TRASH, i === 0 ? base : `${base}-${i}`);
      try { await fsp.lstat(dest); } catch (e) { if (e.code === 'ENOENT') return dest; throw e; }
    }
  }

  async function moveDir(src, dst) {
    try { await fsp.rename(src, dst); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.cp(src, dst, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    }
  }

  const list = wrap(async (req, res) => {
    const out = [];
    for (const name of Object.keys(state.sites).sort()) out.push(await view(name));
    sendJson(res, 200, { domain: DOMAIN, sites: out });
  }, false);

  const create = wrap(async (req, res) => {
    const body = await readBody(req);
    const name = checkName(body.name);
    const spa = optBool(body.spa) === true;
    if (RESERVED.has(name)) throw new ApiError(400, 'reserved_name');
    const dir = siteDir(name);
    let onDisk = true;
    try { await fsp.lstat(dir); } catch (e) { if (e.code === 'ENOENT') onDisk = false; else throw e; }
    if (state.sites[name] || onDisk) throw new ApiError(409, 'exists');
    await fsp.mkdir(dir, { recursive: true });
    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} is live</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#222}code{background:#eee;padding:.1em .3em;border-radius:3px}</style>
</head><body><h1>${name}.${DOMAIN} is live</h1>
<p>Upload your files to <code>sites/${name}/</code> in the Samsung server cloud files, or deploy a zip, and replace this page with your own <code>index.html</code>.</p>
</body></html>
`;
    await fsp.writeFile(path.join(dir, 'index.html'), page);
    state.sites[name] = { enabled: true, spa, createdAt: new Date().toISOString() };
    save();
    sendJson(res, 200, { ok: true, site: await view(name) });
  });

  const update = wrap(async (req, res) => {
    const body = await readBody(req);
    const m = existing(body.name);
    const enabled = optBool(body.enabled);
    const spa = optBool(body.spa);
    if (enabled !== undefined) m.enabled = enabled;
    if (spa !== undefined) m.spa = spa;
    save();
    sendJson(res, 200, { ok: true, site: await view(body.name) });
  });

  const remove = wrap(async (req, res, url) => {
    const name = checkName(url.searchParams.get('name'));
    existing(name);
    if (busy.has(name)) throw new ApiError(409, 'busy');
    busy.add(name);
    try {
      const dir = siteDir(name);
      try {
        await fsp.lstat(dir);
        await fsp.rename(dir, await uniqueTrash(`${Date.now()}-site-${name}`));
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      delete state.sites[name];
      save();
    } finally { busy.delete(name); }
    sendJson(res, 200, { ok: true });
  });

  // Streams the request body to `dest`, enforcing `max`.
  function receive(req, dest, max) {
    return new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(dest, { flags: 'w' });
      let size = 0;
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (err) { ws.destroy(); ws.once('close', () => reject(err)); } else resolve(size);
      };
      ws.once('error', (e) => done(e));
      ws.once('close', () => done());
      req.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > max) { req.pause(); done(new ApiError(413, 'too_large')); return; }
        if (!ws.write(chunk)) { req.pause(); ws.once('drain', () => req.resume()); }
      });
      req.on('end', () => { if (!settled) ws.end(); });
      req.on('error', () => done(new ApiError(400, 'bad_request')));
      req.on('close', () => { if (!req.complete) done(new ApiError(400, 'bad_request')); });
    });
  }

  const deploy = wrap(async (req, res, url) => {
    const name = checkName(url.searchParams.get('name'));
    existing(name);
    const cl = req.headers['content-length'];
    if (cl !== undefined && Number(cl) > ZIP_MAX) throw new ApiError(413, 'too_large');
    if (busy.has(name)) throw new ApiError(409, 'busy');
    busy.add(name);
    const id = rand();
    const zipPath = path.join(TMP, id + '.zip');
    const work = path.join(TMP, id);
    const stage = path.join(TRASH, '.staging-' + id);
    let result;
    try {
      await fsp.mkdir(TMP, { recursive: true });
      await receive(req, zipPath, ZIP_MAX);
      await fsp.mkdir(work);
      result = await zip.extract(zipPath, work);

      let newRoot = work;
      const top = await fsp.readdir(work, { withFileTypes: true });
      if (top.length === 1 && top[0].isDirectory()) newRoot = path.join(work, top[0].name);

      await fsp.mkdir(TRASH, { recursive: true });
      await moveDir(newRoot, stage);

      await fsp.mkdir(SITES_ROOT, { recursive: true });
      const dir = siteDir(name);
      let oldDest = null;
      try {
        await fsp.lstat(dir);
        oldDest = await uniqueTrash(`${Date.now()}-site-${name}-old`);
        await fsp.rename(dir, oldDest);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      try {
        await fsp.rename(stage, dir);
      } catch (e) {
        if (oldDest) await fsp.rename(oldDest, dir).catch(() => {});
        throw e;
      }
    } finally {
      await fsp.rm(zipPath, { force: true }).catch(() => {});
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      busy.delete(name);
    }
    sendJson(res, 200, { ok: true, files: result.files, bytes: result.bytes });
  });

  function classifyError(e) {
    const c = e && e.code;
    if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'ENODATA') return 'dns';
    if (typeof c === 'string' && (c.startsWith('ERR_TLS') || c.startsWith('ERR_SSL') || c.startsWith('CERT_') || c === 'EPROTO'
      || /SELF_SIGNED|UNABLE_TO_VERIFY|CERT|HOSTNAME_MISMATCH/.test(c))) return 'tls';
    if (c === 'ETIMEDOUT') return 'timeout';
    return 'connection';
  }

  function probe(hostname) {
    return new Promise((resolve) => {
      let finished = false;
      let timer = null;
      let r = null;
      const fin = (v) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ hostname, status: null, ...v });
      };
      const target = new URL(CHECK_URL || `https://${hostname}/`);
      const mod = target.protocol === 'http:' ? http : https;
      timer = setTimeout(() => { fin({ reachable: false, error: 'timeout' }); if (r) r.destroy(); }, 5000);
      try {
        r = mod.request({
          protocol: target.protocol, hostname: target.hostname, port: target.port || undefined,
          path: '/', method: 'GET', agent: false, timeout: 5000,
        }, (resp) => {
          resp.resume();
          const status = resp.statusCode;
          const ours = resp.headers['x-s21-site'] === '1';
          if (status >= 200 && status < 400) fin({ reachable: true, status, error: null });
          else if (status === 404 && ours) fin({ reachable: true, status, error: null });
          else if (status >= 500) fin({ reachable: false, status, error: `http_${status}` });
          else fin({ reachable: false, status, error: 'not_ours' });
        });
        r.on('timeout', () => { fin({ reachable: false, error: 'timeout' }); r.destroy(); });
        r.on('error', (e) => fin({ reachable: false, error: classifyError(e) }));
        r.end();
      } catch (e) {
        fin({ reachable: false, error: classifyError(e) });
      }
    });
  }

  const check = wrap(async (req, res, url) => {
    const name = checkName(url.searchParams.get('name'));
    existing(name);
    sendJson(res, 200, await probe(`${name}.${DOMAIN}`));
  });

  const routes = {
    'GET /sites/list': list,
    'POST /sites/create': create,
    'POST /sites/update': update,
    'DELETE /sites': remove,
    'POST /sites/deploy': deploy,
    'GET /sites/check': check,
  };

  return {
    routes, start, init, handlePublic, DOMAIN, PORT,
    stop: () => new Promise((r) => { if (server) server.close(() => r()); else r(); }),
  };
}

const instance = createSites();

module.exports = { createSites, domainFromTunnel, routes: instance.routes, start: instance.start, NAME_RE, RESERVED };
