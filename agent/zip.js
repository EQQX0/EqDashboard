// Minimal pure-Node zip extractor. Zero dependencies; Node 18+ built-ins only.
// Supports stored (0) and deflate (8). No zip64, no encryption, no multi-disk.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const IS_WIN = process.platform === 'win32';
const MAX_ENTRIES = 20000;
const MAX_TOTAL = 1024 * 1024 * 1024; // 1 GiB uncompressed
const RATIO_LIMIT = 200;
const RATIO_MIN_SIZE = 10 * 1024 * 1024;
const MAX_CD_BYTES = 64 * 1024 * 1024;

class ZipError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code; // 'bad_zip' | 'unsafe_zip'
  }
}
const bad = (m) => new ZipError('bad_zip', m);
const unsafe = (m) => new ZipError('unsafe_zip', m);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(prev, buf) {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, pos + got);
    if (bytesRead === 0) throw bad('truncated');
    got += bytesRead;
  }
  return buf;
}

// Reads the central directory. Returns raw entries (not yet validated for path safety).
async function readEntries(fh, size) {
  if (size < 22) throw bad('too small');
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let i = tail.length - 22;
  for (; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) break;
  }
  if (i < 0) throw bad('no end of central directory');
  const disk = tail.readUInt16LE(i + 4);
  const cdDisk = tail.readUInt16LE(i + 6);
  const onDisk = tail.readUInt16LE(i + 8);
  const total = tail.readUInt16LE(i + 10);
  const cdSize = tail.readUInt32LE(i + 12);
  const cdOff = tail.readUInt32LE(i + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw bad('multi-disk');
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw bad('zip64 unsupported');
  if (total > MAX_ENTRIES) throw unsafe('too many entries');
  if (total === 0) throw bad('empty archive');
  if (cdSize > MAX_CD_BYTES || cdOff + cdSize > size) throw bad('bad central directory');
  const cd = await readAt(fh, cdOff, cdSize);
  const entries = [];
  let pos = 0;
  for (let k = 0; k < total; k++) {
    if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== 0x02014b50) throw bad('bad central entry');
    const nlen = cd.readUInt16LE(pos + 28);
    const mlen = cd.readUInt16LE(pos + 30);
    const clen = cd.readUInt16LE(pos + 32);
    if (pos + 46 + nlen + mlen + clen > cd.length) throw bad('bad central entry');
    const e = {
      host: cd.readUInt16LE(pos + 4) >> 8,
      flags: cd.readUInt16LE(pos + 8),
      method: cd.readUInt16LE(pos + 10),
      crc: cd.readUInt32LE(pos + 16),
      csize: cd.readUInt32LE(pos + 20),
      usize: cd.readUInt32LE(pos + 24),
      attrs: cd.readUInt32LE(pos + 38),
      offset: cd.readUInt32LE(pos + 42),
      name: cd.toString('utf8', pos + 46, pos + 46 + nlen),
    };
    if (e.csize === 0xffffffff || e.usize === 0xffffffff || e.offset === 0xffffffff) throw bad('zip64 unsupported');
    entries.push(e);
    pos += 46 + nlen + mlen + clen;
  }
  return entries;
}

// Returns the cleaned segments, or null to skip silently. Throws unsafe_zip on hostile names.
function cleanName(name) {
  if (name.includes('\0') || name.includes('\\')) throw unsafe('bad name');
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw unsafe('absolute path');
  const raw = name.split('/');
  if (raw.includes('..')) throw unsafe('path traversal');
  const segs = raw.filter((s) => s !== '' && s !== '.');
  if (segs.length === 0) return null;
  for (const s of segs) {
    if (Buffer.byteLength(s) > 255) throw bad('name too long');
    if (IS_WIN && s.includes(':')) throw unsafe('bad name');
  }
  if (segs[0] === '__MACOSX' || segs[segs.length - 1] === '.DS_Store') return null;
  return segs;
}

// Validates everything up front so nothing is written for a hostile archive.
function plan(entries) {
  const out = [];
  const seen = new Set();
  let total = 0;
  for (const e of entries) {
    const segs = cleanName(e.name);
    if (!segs) continue;
    if (e.flags & 0x41) throw bad('encrypted entries unsupported');
    if (e.method !== 0 && e.method !== 8) throw bad('unsupported method');
    const isDir = e.name.endsWith('/');
    if (e.host === 3) {
      const type = (e.attrs >>> 16) & 0xf000;
      if (type !== 0 && type !== 0x8000 && type !== 0x4000) throw unsafe('special file entry'); // symlink, device...
    }
    const key = segs.join('/');
    if (seen.has(key)) throw unsafe('duplicate entry');
    seen.add(key);
    if (!isDir) {
      total += e.usize;
      if (total > MAX_TOTAL) throw unsafe('too large when extracted');
      if (e.usize > RATIO_MIN_SIZE && (e.csize === 0 || e.usize / e.csize > RATIO_LIMIT)) throw unsafe('compression ratio');
      if (e.method === 0 && e.csize !== e.usize) throw bad('size mismatch');
    }
    out.push({ ...e, segs, isDir });
  }
  return out;
}

function mapStreamError(e) {
  if (e instanceof ZipError) return e;
  const c = e && e.code;
  if (typeof c === 'string' && (c.startsWith('Z_') || c.startsWith('ERR_BUFFER') || c === 'EEXIST' || c === 'ENOTDIR' || c === 'EISDIR' || c === 'ENAMETOOLONG')) {
    return bad(String(e.message || c));
  }
  return e;
}

// Extracts zipPath into destDir (must exist, should be empty). Returns { files, bytes }.
async function extract(zipPath, destDir) {
  const fh = await fsp.open(zipPath, 'r');
  try {
    const size = (await fh.stat()).size;
    const items = plan(await readEntries(fh, size));
    let files = 0;
    let bytes = 0;
    let running = 0;
    for (const e of items) {
      const target = path.join(destDir, ...e.segs);
      if (e.isDir) {
        try { await fsp.mkdir(target, { recursive: true }); } catch (err) { throw mapStreamError(err); }
        continue;
      }
      const head = await readAt(fh, e.offset, 30);
      if (head.readUInt32LE(0) !== 0x04034b50) throw bad('bad local header');
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      if (start + e.csize > size) throw bad('truncated');
      try { await fsp.mkdir(path.dirname(target), { recursive: true }); } catch (err) { throw mapStreamError(err); }
      let n = 0;
      let crc = 0;
      const counter = new Transform({
        transform(chunk, enc, cb) {
          n += chunk.length;
          running += chunk.length;
          if (n > e.usize || running > MAX_TOTAL) return cb(bad('size mismatch'));
          crc = crc32(crc, chunk);
          cb(null, chunk);
        },
      });
      const stages = [];
      if (e.csize > 0) {
        stages.push(fs.createReadStream(zipPath, { start, end: start + e.csize - 1 }));
        if (e.method === 8) stages.push(zlib.createInflateRaw());
        stages.push(counter);
      }
      try {
        if (e.csize > 0) {
          stages.push(fs.createWriteStream(target, { flags: 'wx' }));
          await pipeline(stages);
        } else {
          await fsp.writeFile(target, '', { flag: 'wx' });
        }
      } catch (err) {
        await fsp.rm(target, { force: true }).catch(() => {});
        throw mapStreamError(err);
      }
      if (n !== e.usize || crc !== e.crc) throw bad('crc or size mismatch');
      files++;
      bytes += n;
    }
    return { files, bytes };
  } finally {
    await fh.close().catch(() => {});
  }
}

module.exports = { extract, ZipError, crc32, MAX_ENTRIES, MAX_TOTAL };
