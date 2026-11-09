'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zip = require('../zip');
const { buildZip } = require('../testlib/zipbuilder');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-zip-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
async function run(buf) {
  const id = ++n;
  const zp = path.join(tmp, id + '.zip');
  const dest = path.join(tmp, 'out' + id);
  fs.writeFileSync(zp, buf);
  fs.mkdirSync(dest);
  try { return { res: await zip.extract(zp, dest), dest }; } catch (e) { return { err: e.code, dest }; }
}

test('crc32 known vector', () => {
  assert.strictEqual(zip.crc32(0, Buffer.from('123456789')), 0xcbf43926);
});

test('stored and deflate entries, comment, dir entries, junk skipped', async () => {
  const big = Buffer.alloc(100000, 'abc');
  const { res, dest } = await run(buildZip([
    { name: 'a.txt', data: 'hello', method: 0 },
    { name: 'sub/', dir: true },
    { name: 'sub/b.bin', data: big },
    { name: 'empty.txt', data: '' },
    { name: '__MACOSX/._a.txt', data: 'x' },
    { name: 'sub/.DS_Store', data: 'x' },
    { name: './c.txt', data: 'c' },
  ], { comment: 'a comment' }));
  assert.deepStrictEqual(res, { files: 4, bytes: 5 + big.length + 0 + 1 });
  assert.strictEqual(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'hello');
  assert.ok(fs.readFileSync(path.join(dest, 'sub/b.bin')).equals(big));
  assert.ok(!fs.existsSync(path.join(dest, '__MACOSX')));
  assert.ok(!fs.existsSync(path.join(dest, 'sub/.DS_Store')));
});

test('unsafe entries', async () => {
  for (const name of ['../evil', 'a/../../evil', '/abs', 'C:/x', 'C:x', 'a\\b', 'a\0b']) {
    assert.strictEqual((await run(buildZip([{ name, data: 'x' }]))).err, 'unsafe_zip', JSON.stringify(name));
  }
  assert.strictEqual((await run(buildZip([{ name: 'l', data: 'x', mode: 0o120777 }]))).err, 'unsafe_zip');
  assert.strictEqual((await run(buildZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]))).err, 'unsafe_zip');
  const bomb = await run(buildZip([{ name: 'z', data: Buffer.alloc(11 * 1024 * 1024) }]));
  assert.strictEqual(bomb.err, 'unsafe_zip');
  assert.deepStrictEqual(fs.readdirSync(bomb.dest), []);
});

test('corrupt archives', async () => {
  const good = buildZip([{ name: 'a.txt', data: 'hello world, hello world', method: 0 }]);
  assert.strictEqual((await run(buildZip([{ name: 'a', data: 'x', crc: 1 }]))).err, 'bad_zip');
  assert.strictEqual((await run(good.subarray(0, good.length - 5))).err, 'bad_zip');
  assert.strictEqual((await run(Buffer.from('not a zip at all, definitely not'))).err, 'bad_zip');
  assert.strictEqual((await run(Buffer.alloc(0))).err, 'bad_zip');
  const enc = buildZip([{ name: 'a', data: 'x' }]);
  const cdOff = enc.readUInt32LE(enc.length - 6);
  enc.writeUInt16LE(1, cdOff + 8); // encrypted flag
  assert.strictEqual((await run(enc)).err, 'bad_zip');
});
