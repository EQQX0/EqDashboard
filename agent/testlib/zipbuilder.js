'use strict';
// Tiny zip writer for tests. entries: { name, data, method (0|8), mode (unix st_mode), crc, dir, host }
const zlib = require('zlib');
const { crc32 } = require('../zip');

function buildZip(entries, { comment = '' } = {}) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const method = e.dir ? 0 : (e.method === undefined ? 8 : e.method);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = e.crc !== undefined ? e.crc : crc32(0, raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(((e.host === undefined ? 3 : e.host) << 8) | 20, 4);
    cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    const mode = e.mode !== undefined ? e.mode : (e.dir ? 0o40755 : 0o100644);
    cd.writeUInt32LE((mode << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    cds.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(cds);
  const c = Buffer.from(comment);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cdBuf, eocd, c]);
}

module.exports = { buildZip };
