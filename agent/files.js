// File-cloud API for the S21 agent. Zero dependencies; Node 18+ built-ins only.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const STATUS = {
  bad_path: 400, not_found: 404, exists: 409, too_large: 413,
  not_a_directory: 400, is_a_directory: 400, range_not_satisfiable: 416, internal: 500,
};

class FileError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = STATUS[code] || 500;
  }
}
const E = (code) => new FileError(code);
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function checkSegments(segs) {
  for (const seg of segs) {
    if (seg === '' || seg === '.' || seg === '..') throw E('bad_path');
    if (Buffer.byteLength(seg) > 255) throw E('bad_path');
    if (IS_WIN && seg.includes(':')) throw E('bad_path');
  }
}

// Parse a client-supplied relative path into safe segments. "" and "/" are the root.
function parseRel(rel) {
  if (typeof rel !== 'string') throw E('bad_path');
  if (rel === '' || rel === '/') return [];
  const variants = [rel];
  try {
    const d = decodeURIComponent(rel);
    if (d !== rel) variants.push(d);
  } catch { /* malformed escape: keep raw only */ }
  for (const v of variants) {
    if (v.includes('\0') || v.includes('\\')) throw E('bad_path');
    if (v.startsWith('/') || /^[a-zA-Z]:/.test(v)) throw E('bad_path');
    if (v !== rel) {
      // decoded form must not smuggle in traversal segments
      for (const s of v.split('/')) if (s === '..' || s === '.') throw E('bad_path');
    }
  }
  let s = rel;
  if (s.endsWith('/')) s = s.slice(0, -1); // one trailing slash is tolerated
  const segs = s.split('/');
  checkSegments(segs);
  return segs;
}

function within(realRoot, p) {
  let a = realRoot;
  let b = p;
  if (IS_WIN) { a = a.toLowerCase(); b = b.toLowerCase(); }
  if (b === a) return true;
  return b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

// Returns the absolute path for `rel` under `root`, or throws bad_path.
// Symlinks (including dangling ones) cannot lead outside realpath(root).
function resolveSafe(root, rel) {
  const segs = parseRel(rel);
  const base = path.resolve(root);
  let realRoot;
  try { realRoot = fs.realpathSync(base); } catch { throw E('internal'); }
  const abs = path.join(base, ...segs);
  let cur = abs;
  const tail = [];
  for (;;) {
    let real;
    try {
      real = fs.realpathSync(cur);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      let isLink = true;
      try { fs.lstatSync(cur); } catch { isLink = false; }
      if (isLink) throw E('bad_path'); // dangling symlink: refuse
      tail.unshift(path.basename(cur));
      const parent = path.dirname(cur);
      if (parent === cur) throw E('bad_path');
      cur = parent;
      continue;
    }
    if (!within(realRoot, path.join(real, ...tail))) throw E('bad_path');
    return abs;
  }
}

// Validates a single file or folder name.
function validName(name, atRoot) {
  if (typeof name !== 'string' || name === '') throw E('bad_path');
  if (/[\/\\\0]/.test(name)) throw E('bad_path');
  if (name === '.' || name === '..') throw E('bad_path');
  if (Buffer.byteLength(name) > 255) throw E('bad_path');
  if (IS_WIN && name.includes(':')) throw E('bad_path');
  if (name.endsWith('.part')) throw E('bad_path'); // reserved for in-flight uploads
  if (atRoot && name.startsWith('.trash')) throw E('bad_path');
  return name;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, code, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function toFileError(e) {
  if (e instanceof FileError) return e;
  switch (e && e.code) {
    case 'ENOENT': return E('not_found');
    case 'ENOTDIR': return E('not_a_directory');
    case 'EISDIR': return E('is_a_directory');
    case 'ENAMETOOLONG': return E('bad_path');
    case 'EEXIST': return E('exists');
    default: return E('internal');
  }
}

function readJson(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(E('too_large')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0;
        resolve(v);
      } catch { reject(E('bad_path')); }
    });
    req.on('error', reject);
  });
}

async function statOrNull(p) {
  try { return await fsp.lstat(p); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

function asciiFallback(name) {
  return name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
}
function rfc5987(name) {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// True for the 'sites' folder itself and for 'sites/<name>' (managed by sites.js metadata).
function isSiteEntry(segs) {
  return segs[0] === 'sites' && segs.length <= 2;
}

// Parses a single Range header. Returns null (ignore), 'unsat', or {start,end}.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!m) return null; // malformed or multi-range: serve whole file
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (n === 0 || size === 0) return 'unsat';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  let end = b === '' ? size - 1 : Number(b);
  if (b !== '' && end < start) return null;
  if (start >= size) return 'unsat';
  if (end >= size) end = size - 1;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

function createRoutes({ root, maxUploadBytes }) {
  const ROOT = path.resolve(root);
  const MAX = Number(maxUploadBytes);

  // Resolve a client path. Blocks .trash and in-flight .part files.
  function rp(rel) {
    const segs = parseRel(rel);
    if (segs.length && segs[0].startsWith('.trash')) throw E('bad_path');
    if (segs.some((s) => s.endsWith('.part'))) throw E('not_found');
    return { segs, abs: resolveSafe(ROOT, rel), rel: segs.join('/') };
  }

  function wrap(fn) {
    const handler = async (req, res, url) => {
      try {
        await fn(req, res, url);
      } catch (e) {
        const fe = toFileError(e);
        if (fe.code === 'internal' && !(e instanceof FileError)) console.error('files error:', e);
        sendJson(res, fe.status, { error: fe.code });
      }
      if (!req.readableEnded && !req.destroyed) {
        // Body not consumed (early rejection): drain, but cap how long we keep the socket.
        req.resume();
        setTimeout(() => req.destroy(), 10000).unref();
      }
    };
    return handler;
  }

  const list = wrap(async (req, res, url) => {
    const { abs, rel } = rp(url.searchParams.get('path') || '');
    const st = await statOrNull(abs);
    if (!st) throw E('not_found');
    const real = await fsp.realpath(abs);
    const realRoot = await fsp.realpath(ROOT);
    const dst = await fsp.stat(real);
    if (!dst.isDirectory()) throw E('not_a_directory');
    const names = await fsp.readdir(abs);
    const entries = [];
    for (const name of names) {
      if (name.endsWith('.part')) continue;
      if (rel === '' && name.startsWith('.trash')) continue;
      const p = path.join(abs, name);
      try {
        const l = await fsp.lstat(p);
        if (l.isSymbolicLink()) {
          const target = await fsp.realpath(p);
          if (!within(realRoot, target)) continue; // never advertise escaping links
        }
        const s = l.isSymbolicLink() ? await fsp.stat(p) : l;
        const isDir = s.isDirectory();
        if (!isDir && !s.isFile()) continue;
        entries.push({
          name, type: isDir ? 'dir' : 'file', size: isDir ? 0 : s.size, modified: s.mtime.toISOString(),
        });
      } catch { /* vanished or broken entry */ }
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      if (x < y) return -1;
      if (x > y) return 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    sendJson(res, 200, { path: rel, entries });
  });

  const download = wrap(async (req, res, url) => {
    const { abs, segs } = rp(url.searchParams.get('path') || '');
    const st = await statOrNull(abs);
    if (!st) throw E('not_found');
    const fst = await fsp.stat(abs);
    if (fst.isDirectory()) throw E('is_a_directory');
    if (!fst.isFile()) throw E('not_found');
    const size = fst.size;
    const name = segs[segs.length - 1];
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${rfc5987(name)}`,
    };
    let code = 200;
    let start = 0;
    let end = size - 1;
    if (req.headers.range) {
      const r = parseRange(req.headers.range, size);
      if (r === 'unsat') {
        res.writeHead(416, { 'Content-Type': 'application/json', 'Content-Range': `bytes */${size}` });
        res.end(JSON.stringify({ error: 'range_not_satisfiable' }));
        return;
      }
      if (r) {
        code = 206;
        start = r.start;
        end = r.end;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
    }
    const len = size === 0 ? 0 : end - start + 1;
    headers['Content-Length'] = len;
    res.writeHead(code, headers);
    if (len === 0) { res.end(); return; }
    const rs = fs.createReadStream(abs, { start, end });
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  });

  const upload = wrap(async (req, res, url) => {
    if (req.method !== 'PUT') throw E('bad_path');
    const dirRel = url.searchParams.get('path') || '';
    const name = url.searchParams.get('name');
    const overwrite = url.searchParams.get('overwrite') === '1';

    const dirSegs = parseRel(dirRel);
    validName(name, dirSegs.length === 0);
    const dir = rp(dirRel);
    const dst = await statOrNull(dir.abs);
    if (dst && !(await fsp.stat(dir.abs)).isDirectory()) throw E('not_a_directory');

    const cl = req.headers['content-length'];
    if (cl !== undefined && Number(cl) > MAX) throw E('too_large');

    const targetRel = dir.rel ? `${dir.rel}/${name}` : name;
    const target = resolveSafe(ROOT, targetRel);
    const tst = await statOrNull(target);
    if (tst) {
      if ((await fsp.stat(target).catch(() => tst)).isDirectory()) throw E('is_a_directory');
      if (!overwrite) throw E('exists');
    }

    await fsp.mkdir(dir.abs, { recursive: true });
    resolveSafe(ROOT, targetRel); // re-verify after directory creation

    const part = target + '.part';
    const ws = fs.createWriteStream(part, { flags: 'w' });
    const wsClosed = new Promise((r) => ws.once('close', r));
    let size = 0;
    let failure = null;

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
        ws.once('error', settle);
        ws.once('close', () => settle());
        req.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX) { req.pause(); settle(E('too_large')); return; }
          if (!ws.write(chunk)) {
            req.pause();
            ws.once('drain', () => req.resume());
          }
        });
        req.on('end', () => { if (!settled) ws.end(); });
        req.on('error', () => settle(E('internal')));
        req.on('close', () => { if (!req.complete) settle(E('internal')); }); // client aborted
      });
    } catch (e) {
      failure = e;
    }

    if (failure) {
      ws.destroy();
      await wsClosed;
      await fsp.rm(part, { force: true }).catch(() => {});
      throw failure;
    }

    try {
      if (!overwrite && (await statOrNull(target))) throw E('exists');
      await fsp.rename(part, target);
    } catch (e) {
      await fsp.rm(part, { force: true }).catch(() => {});
      throw e;
    }
    sendJson(res, 200, { ok: true, name, size });
  });

  const mkdir = wrap(async (req, res) => {
    const body = await readJson(req);
    if (typeof body.path !== 'string') throw E('bad_path');
    const { segs, abs, rel } = rp(body.path);
    if (segs.length === 0) throw E('exists');
    validName(segs[segs.length - 1], segs.length === 1);
    if (await statOrNull(abs)) throw E('exists');
    await fsp.mkdir(abs, { recursive: true });
    resolveSafe(ROOT, rel);
    sendJson(res, 200, { ok: true });
  });

  const rename = wrap(async (req, res) => {
    const body = await readJson(req);
    if (typeof body.from !== 'string' || typeof body.to !== 'string') throw E('bad_path');
    const from = rp(body.from);
    const to = rp(body.to);
    if (from.segs.length === 0 || to.segs.length === 0) throw E('bad_path');
    if (isSiteEntry(from.segs)) throw E('bad_path'); // sites are managed via /sites/*
    validName(to.segs[to.segs.length - 1], to.segs.length === 1);
    if (!(await statOrNull(from.abs))) throw E('not_found');
    if (to.rel === from.rel || to.rel.startsWith(from.rel + '/')) {
      if (to.rel === from.rel) throw E('exists');
      throw E('bad_path'); // cannot move a folder into itself
    }
    if (await statOrNull(to.abs)) throw E('exists');
    await fsp.mkdir(path.dirname(to.abs), { recursive: true });
    resolveSafe(ROOT, to.rel);
    await fsp.rename(from.abs, to.abs);
    sendJson(res, 200, { ok: true });
  });

  const remove = wrap(async (req, res, url) => {
    const { segs, abs } = rp(url.searchParams.get('path') || '');
    if (segs.length === 0) throw E('bad_path');
    if (isSiteEntry(segs)) throw E('bad_path'); // sites are managed via /sites/*
    if (!(await statOrNull(abs))) throw E('not_found');
    const trash = path.join(ROOT, '.trash');
    await fsp.mkdir(trash, { recursive: true });
    const base = `${Date.now()}-${segs[segs.length - 1]}`;
    for (let i = 0; ; i++) {
      const dest = path.join(trash, i === 0 ? base : `${base}-${i}`);
      if (await statOrNull(dest)) continue;
      await fsp.rename(abs, dest);
      break;
    }
    sendJson(res, 200, { ok: true });
  });

  return {
    'GET /files/list': list,
    'GET /files/download': download,
    'PUT /files/upload': upload,
    'POST /files/mkdir': mkdir,
    'POST /files/rename': rename,
    'DELETE /files': remove,
  };
}

const FILES_ROOT = process.env.FILES_ROOT || path.join(os.homedir(), 's21-cloud');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5368709120);

// Creates FILES_ROOT; called by server.js at startup.
function init() {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

module.exports = {
  routes: createRoutes({ root: FILES_ROOT, maxUploadBytes: MAX_UPLOAD_BYTES }),
  createRoutes,
  resolveSafe,
  validName,
  parseRange,
  init,
  FILES_ROOT,
  MAX_UPLOAD_BYTES,
};
