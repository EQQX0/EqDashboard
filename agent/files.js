// File-cloud API for the Samsung server agent. Zero dependencies; Node 18+ built-ins only.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STATUS = {
  bad_path: 400, not_found: 404, exists: 409, busy: 409, too_large: 413,
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
// Trash helpers. Entries live in FILES_ROOT/.trash as '<epoch ms>-<name>'; the original location of each is kept in
// '.trash/.meta/<entry>.json' (written atomically). Entries without a sidecar (older deletes) still list and restore.
// ---------------------------------------------------------------------------

const TRASH_DAYS = Number(process.env.TRASH_DAYS || 30);
const DAY = 86400000;
const META_DIR = '.meta';

const metaPath = (trash, id) => path.join(trash, META_DIR, id + '.json');

// Real entries only: not the metadata folder, half-finished site deploys ('.staging-*') or other dotfiles.
function isTrashEntryName(id) {
  if (typeof id !== 'string' || id === '' || id.startsWith('.')) return false;
  if (/[\/\\\0]/.test(id) || id.includes('..')) return false;
  return Buffer.byteLength(id) <= 255;
}

const stripStamp = (id) => id.replace(/^\d{13}-/, '');

async function writeMeta(trash, id, meta) {
  const dir = path.join(trash, META_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const tmpFile = path.join(dir, `.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsp.writeFile(tmpFile, JSON.stringify(meta));
    await fsp.rename(tmpFile, metaPath(trash, id));
  } catch (e) {
    await fsp.rm(tmpFile, { force: true }).catch(() => {});
    throw e;
  }
}

async function readMeta(trash, id) {
  try {
    const m = JSON.parse(await fsp.readFile(metaPath(trash, id), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
}

const META_MIN_AGE_MS = 60000;

// Removes sidecars whose trash entry is gone, and leftover temp files. Anything younger than a minute is skipped: a
// sidecar is written just before its entry is renamed in, and must not be swept in that gap.
async function sweepOrphanMeta(trash, now = Date.now()) {
  let metas;
  try { metas = await fsp.readdir(path.join(trash, META_DIR)); } catch { return; }
  for (const f of metas) {
    const isMeta = f.endsWith('.json') && !f.startsWith('.');
    if (isMeta && await statOrNull(path.join(trash, f.slice(0, -5)))) continue;
    try {
      const st = await fsp.lstat(path.join(trash, META_DIR, f));
      if (now - st.mtimeMs < META_MIN_AGE_MS) continue;
    } catch { continue; }
    await fsp.rm(path.join(trash, META_DIR, f), { force: true }).catch(() => {});
  }
}

// Renames src to dest; across devices (EXDEV) copies then removes the source. A failed copy removes the partial dest.
async function moveEntry(src, dest, renameFn = fsp.rename) {
  try {
    await renameFn(src, dest);
  } catch (e) {
    if (!e || e.code !== 'EXDEV') throw e;
    try {
      await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    } catch (err) {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    await fsp.rm(src, { recursive: true });
  }
}

async function treeSize(p, depth = 0) {
  let total = 0;
  let ents;
  try { ents = await fsp.readdir(p, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) { if (depth < 32) total += await treeSize(q, depth + 1); }
    else { try { total += (await fsp.lstat(q)).size; } catch { /* gone */ } }
  }
  return total;
}

async function describeEntry(trash, id) {
  const abs = path.join(trash, id);
  const st = await fsp.lstat(abs);
  const meta = await readMeta(trash, id);
  const m = /^(\d{13})-/.exec(id);
  const deletedAt = meta && Number.isFinite(meta.deletedAt) ? meta.deletedAt : m ? Number(m[1]) : Math.round(st.mtimeMs);
  const isDir = st.isDirectory();
  const item = {
    id,
    name: (meta && typeof meta.name === 'string' && meta.name) || stripStamp(id),
    isDir,
    size: isDir ? await treeSize(abs) : st.size,
    deletedAt,
    expiresAt: TRASH_DAYS > 0 ? deletedAt + TRASH_DAYS * DAY : null,
  };
  if (meta && typeof meta.originalPath === 'string' && meta.originalPath) item.originalPath = meta.originalPath;
  return item;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

function createRoutes({ root, maxUploadBytes, renameFn }) {
  const mv = (a, b) => moveEntry(a, b, renameFn);
  const restoring = new Set(); // trash ids being restored right now
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

    // A unique name per upload: two uploads of the same file must not write into one partial file.
    const part = `${target}.${crypto.randomBytes(4).toString('hex')}.part`;
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

  // Moves abs into .trash with a sidecar holding its original location. Returns the new entry id.
  async function moveToTrash(abs, segs) {
    const trash = path.join(ROOT, '.trash');
    await fsp.mkdir(trash, { recursive: true });
    const now = Date.now();
    const st = await statOrNull(abs);
    const base = `${now}-${segs[segs.length - 1].slice(0, 100)}`; // short enough for any file name
    for (let i = 0; ; i++) {
      const id = i === 0 ? base : `${base}-${i}`;
      const dest = path.join(trash, id);
      if (await statOrNull(dest)) continue;
      // Sidecar first, so an entry never sits in the trash without its original location.
      await writeMeta(trash, id, { originalPath: segs.join('/'), name: segs[segs.length - 1], isDir: !!(st && st.isDirectory()), deletedAt: now });
      try { await mv(abs, dest); } catch (e) { await fsp.rm(metaPath(trash, id), { force: true }).catch(() => {}); throw e; }
      return id;
    }
  }

  const remove = wrap(async (req, res, url) => {
    const { segs, abs } = rp(url.searchParams.get('path') || '');
    if (segs.length === 0) throw E('bad_path');
    if (isSiteEntry(segs)) throw E('bad_path'); // sites are managed via /sites/*
    if (!(await statOrNull(abs))) throw E('not_found');
    await moveToTrash(abs, segs);
    sendJson(res, 200, { ok: true });
  });

  const trashDir = () => path.join(ROOT, '.trash');

  const trashList = wrap(async (req, res) => {
    const trash = trashDir();
    let names;
    try { names = await fsp.readdir(trash); } catch { names = []; }
    const items = [];
    for (const id of names) {
      if (!isTrashEntryName(id)) continue;
      try { items.push(await describeEntry(trash, id)); } catch { /* vanished: skip */ }
    }
    items.sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1));
    sendJson(res, 200, { days: TRASH_DAYS, items });
  });

  // Finds a trash entry by id. The id is a bare entry name, never a path.
  async function entryFor(id) {
    if (!isTrashEntryName(id)) throw E('bad_path');
    const trash = trashDir();
    const abs = path.join(trash, id);
    if (!(await statOrNull(abs))) throw E('not_found');
    return { trash, abs };
  }

  // body: {id, overwrite?, replaceType?}. A second restore of an id already in flight gives 'busy' (409).
  // overwrite never deletes the existing target: it goes into the trash as a new entry and is put back if the
  // restore fails. File over folder (or the reverse) is refused with 'exists' unless replaceType is true.
  const trashRestore = wrap(async (req, res) => {
    const body = await readJson(req);
    if (typeof body.id === 'string' && restoring.has(body.id)) throw E('busy');
    const { trash, abs } = await entryFor(body.id);
    const id = body.id;
    restoring.add(id);
    try {
      const meta = await readMeta(trash, id);
      const name = (meta && typeof meta.name === 'string' && meta.name) || stripStamp(id);
      let rel = null;
      if (meta && typeof meta.originalPath === 'string') {
        try {
          const r = rp(meta.originalPath);
          if (r.segs.length && !isSiteEntry(r.segs)) rel = r.rel;
        } catch { /* unusable location: fall back to Restored/ */ }
      }
      if (!rel) rel = `Restored/${name.replace(/[\/\\\0:]/g, '_') || 'item'}`;
      const to = rp(rel);
      const existing = await statOrNull(to.abs);
      if (existing) {
        if (body.overwrite !== true) throw E('exists');
        const src = await fsp.lstat(abs);
        if (src.isDirectory() !== existing.isDirectory() && body.replaceType !== true) throw E('exists');
      }
      await fsp.mkdir(path.dirname(to.abs), { recursive: true });
      resolveSafe(ROOT, to.rel); // re-verify after directory creation
      let oldId = null;
      if (existing) oldId = await moveToTrash(to.abs, to.segs);
      try {
        await mv(abs, to.abs);
      } catch (e) {
        if (oldId) {
          try { await mv(path.join(trash, oldId), to.abs); await fsp.rm(metaPath(trash, oldId), { force: true }).catch(() => {}); } catch { /* old copy stays in the trash */ }
        }
        throw e;
      }
      await fsp.rm(metaPath(trash, id), { force: true }).catch(() => {});
      sendJson(res, 200, { ok: true, path: to.rel });
    } finally {
      restoring.delete(id);
    }
  });

  const trashDelete = wrap(async (req, res) => {
    const body = await readJson(req);
    const { trash, abs } = await entryFor(body.id);
    await fsp.rm(abs, { recursive: true, force: true });
    await fsp.rm(metaPath(trash, body.id), { force: true }).catch(() => {});
    sendJson(res, 200, { ok: true });
  });

  const trashEmpty = wrap(async (req, res) => {
    const trash = trashDir();
    let names;
    try { names = await fsp.readdir(trash); } catch { names = []; }
    let removed = 0;
    for (const id of names) {
      if (!isTrashEntryName(id)) continue;
      try {
        await fsp.rm(path.join(trash, id), { recursive: true, force: true });
        await fsp.rm(metaPath(trash, id), { force: true }).catch(() => {});
        removed++;
      } catch { /* busy: leave it */ }
    }
    await sweepOrphanMeta(trash);
    sendJson(res, 200, { ok: true, removed });
  });

  return {
    'GET /files/list': list,
    'GET /files/download': download,
    'PUT /files/upload': upload,
    'POST /files/mkdir': mkdir,
    'POST /files/rename': rename,
    'DELETE /files': remove,
    'GET /files/trash': trashList,
    'POST /files/trash/restore': trashRestore,
    'POST /files/trash/delete': trashDelete,
    'POST /files/trash/empty': trashEmpty,
  };
}

const FILES_ROOT = process.env.FILES_ROOT || path.join(os.homedir(), 'samsung-cloud');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5368709120);

// Removes trash entries older than maxAgeMs. Entries are named '<epoch ms>-<name>' (older ones fall back to their
// modified time); half-finished site deploys ('.staging-*') go after a day. Returns how many were removed.
async function purgeTrash(root, maxAgeMs, now = Date.now()) {
  const trash = path.join(path.resolve(root), '.trash');
  let names;
  try { names = await fsp.readdir(trash); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (name === META_DIR) continue; // sidecar folder, not an entry
    const p = path.join(trash, name);
    try {
      let age;
      const m = /^(\d{13})-/.exec(name);
      if (m) age = now - Number(m[1]);
      else age = now - (await fsp.lstat(p)).mtimeMs;
      const limit = name.startsWith('.staging-') ? Math.min(maxAgeMs, DAY) : maxAgeMs;
      if (age >= limit) {
        await fsp.rm(p, { recursive: true, force: true });
        await fsp.rm(metaPath(trash, name), { force: true }).catch(() => {});
        removed++;
      }
    } catch { /* vanished or busy: try again next time */ }
  }
  await sweepOrphanMeta(trash, now);
  return removed;
}

// Creates FILES_ROOT and starts emptying old trash; called by server.js at startup.
function init() {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
  if (TRASH_DAYS > 0) {
    const sweep = () => purgeTrash(FILES_ROOT, TRASH_DAYS * DAY).catch(() => {});
    sweep();
    setInterval(sweep, 6 * 3600 * 1000).unref();
  }
}

module.exports = {
  routes: createRoutes({ root: FILES_ROOT, maxUploadBytes: MAX_UPLOAD_BYTES }),
  createRoutes,
  resolveSafe,
  validName,
  parseRange,
  purgeTrash,
  sweepOrphanMeta,
  moveEntry,
  init,
  FILES_ROOT,
  MAX_UPLOAD_BYTES,
};
