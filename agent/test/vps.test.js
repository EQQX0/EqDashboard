'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createVps, KEY_RE, NAME_RE } = require('../vps');

const FAKE = path.join(__dirname, '..', 'testlib', 'fake-proot.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-vps-'));
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
}

let counter = 0;
let portBase = 23000 + Math.floor(Math.random() * 2000);
function setup(extra = {}) {
  const dir = path.join(tmp, 'v' + counter++);
  process.env.FAKE_PROOT_STATE = path.join(dir, 'proot');
  delete process.env.FAKE_PROOT_FAIL;
  const vps = createVps({
    dataDir: path.join(dir, 'data'), prootCmd: [process.execPath, FAKE], minFree: 0,
    rootfsDir: path.join(dir, 'proot'), portBase: (portBase += 10), startTimeoutMs: 8000, ...extra,
  });
  vps.init();
  cleanups.push(async () => vps.stopAll());
  return { vps, dir, marker: (n) => path.join(dir, 'proot', 'samsung-' + n) };
}
const ready = (vps, name) => until(async () => {
  const it = (await vps.list()).items.find((i) => i.name === name);
  return it && it.status !== 'creating' ? it : null;
});
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
const code = (p) => p.then(() => null, (e) => e.code);

test('name and key validation', () => {
  assert.ok(NAME_RE.test('web-1') && NAME_RE.test('a'));
  for (const n of ['', '1a', 'A', 'a_b', '-a', 'a-', 'a'.repeat(24), 'a b', '../x']) assert.ok(!NAME_RE.test(n), n);
  const good = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@pc';
  assert.ok(KEY_RE.test(good));
  assert.ok(!KEY_RE.test(good + "'; rm -rf /"));
  assert.ok(!KEY_RE.test("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqq\nssh-rsa AAAA"));
});

test('create runs the lifecycle and returns the password once', async () => {
  const { vps, marker } = setup();
  const out = await vps.create({ name: 'web', distro: 'debian' });
  assert.equal(out.item.status, 'creating');
  assert.match(out.password, /^[A-Za-z0-9_-]{20}$/);
  const it = await ready(vps, 'web');
  assert.equal(it.status, 'running');
  assert.equal(it.authMode, 'password');
  assert.equal(it.error, null);
  assert.ok(await portOpen(it.port));
  const meta = JSON.parse(fs.readFileSync(marker('web'), 'utf8'));
  assert.deepEqual(meta.passwords, [out.password]);
  assert.match(meta.script, /apt-get install -y openssh-server/);
  const listed = JSON.stringify(await vps.list());
  assert.ok(!listed.includes(out.password), 'password must not appear in the list');
  assert.ok(!fs.readFileSync(path.join(vps.DATA_DIR, 'vps.json'), 'utf8').includes(out.password));
  await vps.stop('web');
});

test('alpine uses apk and a key install disables passwords', async () => {
  const { vps, marker } = setup();
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@pc';
  const out = await vps.create({ name: 'tiny', distro: 'alpine', sshKey: key });
  assert.equal(out.password, null);
  const it = await ready(vps, 'tiny');
  assert.equal(it.authMode, 'key');
  assert.equal(it.status, 'running');
  const meta = JSON.parse(fs.readFileSync(marker('tiny'), 'utf8'));
  assert.match(meta.script, /apk add --no-cache openssh/);
  assert.ok(meta.script.includes(key));
  await vps.stop('tiny');
});

test('stop and start cycle the sshd port', async () => {
  const { vps } = setup();
  await vps.create({ name: 'a1', distro: 'ubuntu' });
  const it = await ready(vps, 'a1');
  await vps.stop('a1');
  assert.equal((await vps.list()).items[0].status, 'stopped');
  await until(async () => !(await portOpen(it.port)));
  await vps.start('a1');
  assert.equal((await vps.list()).items[0].status, 'running');
  assert.ok(await portOpen(it.port));
  await vps.start('a1'); // starting a running slice is a no-op
  await vps.stop('a1');
});

test('each slice gets its own port', async () => {
  const { vps } = setup();
  await vps.create({ name: 'one', distro: 'debian' });
  await vps.create({ name: 'two', distro: 'debian' });
  await ready(vps, 'one'); await ready(vps, 'two');
  const ports = (await vps.list()).items.map((i) => i.port);
  assert.equal(new Set(ports).size, 2);
  await vps.stop('one'); await vps.stop('two');
});

test('rejects bad input, duplicates and the slice cap', async () => {
  const { vps } = setup({ maxSlices: 1 });
  assert.equal(await code(vps.create({ name: 'Bad Name', distro: 'debian' })), 'bad_name');
  assert.equal(await code(vps.create({ name: 'ok', distro: 'arch' })), 'bad_distro');
  assert.equal(await code(vps.create({ name: 'ok', distro: 'debian', sshKey: 'nope' })), 'bad_key');
  await vps.create({ name: 'ok', distro: 'debian' });
  assert.equal(await code(vps.create({ name: 'ok', distro: 'debian' })), 'exists');
  assert.equal(await code(vps.create({ name: 'two', distro: 'debian' })), 'too_many');
  assert.equal(await code(vps.start('ok')), 'busy');
  await ready(vps, 'ok');
  assert.equal(await code(vps.start('ghost')), 'not_found');
  await vps.stop('ok');
});

test('low disk space refuses to create', async () => {
  const { vps } = setup({ minFree: Number.MAX_SAFE_INTEGER });
  assert.equal(await code(vps.create({ name: 'big', distro: 'debian' })), 'low_space');
});

test('missing proot-distro is reported', async () => {
  const { vps } = setup();
  process.env.FAKE_PROOT_FAIL = 'list';
  assert.equal(await code(vps.create({ name: 'x', distro: 'debian' })), 'engine_missing');
  assert.equal((await vps.list()).engine, false);
});

test('failed download and failed setup end in error and clean up', async () => {
  for (const mode of ['install', 'setup']) {
    const { vps, marker } = setup();
    process.env.FAKE_PROOT_FAIL = mode;
    await vps.create({ name: 'bad', distro: 'debian' });
    const it = await ready(vps, 'bad');
    assert.equal(it.status, 'error', mode);
    assert.ok(it.error && it.error.length > 0);
    assert.ok(!fs.existsSync(marker('bad')), 'half-built distro removed');
    process.env.FAKE_PROOT_FAIL = '';
    await vps.remove('bad'); // errored slices can be deleted
    assert.equal((await vps.list()).items.length, 0);
  }
});

test('reset password changes the root password, key-only slices refuse', async () => {
  const { vps, marker } = setup();
  const out = await vps.create({ name: 'pw', distro: 'debian' });
  await ready(vps, 'pw');
  const next = await vps.resetPassword('pw');
  assert.notEqual(next, out.password);
  assert.deepEqual(JSON.parse(fs.readFileSync(marker('pw'), 'utf8')).passwords, [out.password, next]);
  await vps.stop('pw');
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
  await vps.create({ name: 'kk', distro: 'debian', sshKey: key });
  await ready(vps, 'kk');
  assert.equal(await code(vps.resetPassword('kk')), 'key_only');
  await vps.stop('kk');
});

test('a slice made before the rename is still found under its old name', async () => {
  const { vps, dir, marker } = setup();
  await vps.create({ name: 'old', distro: 'debian' });
  await ready(vps, 'old');
  await vps.stop('old');
  const legacy = path.join(dir, 'proot', 's21-old');
  fs.renameSync(marker('old'), legacy);
  await vps.remove('old');
  assert.ok(!fs.existsSync(legacy), 'removed through the old name');
});

test('delete stops the slice, removes the distro and forgets it', async () => {
  const { vps, marker } = setup();
  await vps.create({ name: 'gone', distro: 'debian' });
  const it = await ready(vps, 'gone');
  await vps.remove('gone');
  assert.equal((await vps.list()).items.length, 0);
  assert.ok(!fs.existsSync(marker('gone')));
  await until(async () => !(await portOpen(it.port)));
});

test('metadata survives a restart; stale running and creating are fixed up', async () => {
  const { vps, dir } = setup();
  await vps.create({ name: 'keep', distro: 'debian' });
  await ready(vps, 'keep');
  await vps.stop('keep');
  const file = path.join(vps.DATA_DIR, 'vps.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.slices.keep.status = 'running'; data.slices.keep.pid = 2147483000; // dead pid
  data.slices.half = { ...data.slices.keep, name: 'half', status: 'creating', pid: null, port: 1 };
  fs.writeFileSync(file, JSON.stringify(data));
  const again = createVps({ dataDir: path.join(dir, 'data'), rootfsDir: path.join(dir, 'proot'), prootCmd: [process.execPath, FAKE], minFree: 0 });
  again.init();
  const items = (await again.list()).items;
  assert.equal(items.find((i) => i.name === 'keep').status, 'stopped');
  const half = items.find((i) => i.name === 'half');
  assert.equal(half.status, 'error');
  assert.match(half.error, /restart/);
});

test('http routes', async () => {
  const { vps } = setup();
  const call = async (key, { body, query } = {}) => {
    const req = new (require('stream').Readable)({ read() {} });
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
    let status; let text = '';
    const res = {
      headersSent: false, writeHead(c) { status = c; }, end(t) { text = t; this.headersSent = true; }, destroy() {},
    };
    await vps.routes[key](req, res, new URL('http://x/vps' + (query || '')));
    return { status, json: JSON.parse(text) };
  };
  let r = await call('GET /vps/list');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.distros.map((d) => d.id), ['debian', 'ubuntu', 'alpine']);
  r = await call('POST /vps/create', { body: { name: 'BAD', distro: 'debian' } });
  assert.deepEqual([r.status, r.json.error], [400, 'bad_name']);
  r = await call('POST /vps/create', { body: { name: 'h1', distro: 'debian' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.password);
  await ready(vps, 'h1');
  r = await call('POST /vps/stop', { body: { id: 'h1' } });
  assert.equal(r.status, 200);
  r = await call('POST /vps/start', { body: { id: 'nope' } });
  assert.deepEqual([r.status, r.json.error], [404, 'not_found']);
  r = await call('POST /vps/start', { body: [1] });
  assert.equal(r.status, 400);
  r = await call('DELETE /vps', { query: '?id=h1' });
  assert.equal(r.status, 200);
});
