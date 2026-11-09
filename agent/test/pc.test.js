'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const { createPc, normMac, isPrivateV4, magicPacket } = require('../pc');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-pc-'));
const cleanups = [];
test.after(async () => { for (const c of cleanups) await c(); fs.rmSync(tmp, { recursive: true, force: true }); });
const FAKE_SSH = path.join(__dirname, '..', 'testlib', 'fake-ssh.js');
const FAKE_KEYGEN = path.join(__dirname, '..', 'testlib', 'fake-keygen.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (p) => p.then(() => null, (e) => e.code);

async function udpListener() {
  const got = [];
  const s = dgram.createSocket('udp4');
  s.on('message', (m) => got.push(m));
  await new Promise((r) => s.bind(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => s.close(r)));
  return { port: s.address().port, got };
}

let n = 0;
function setup(extra = {}) {
  const dir = path.join(tmp, 'p' + n++);
  const log = path.join(dir, 'ssh.log');
  fs.mkdirSync(dir, { recursive: true });
  process.env.FAKE_SSH_LOG = log;
  process.env.FAKE_SSH_MODE = 'ok';
  const pc = createPc({
    dataDir: path.join(dir, 'data'), sshCmd: [process.execPath, FAKE_SSH], keygenCmd: [process.execPath, FAKE_KEYGEN],
    allowAnyIp: true, probePorts: [1], cooldownMs: 0, ...extra,
  });
  pc.init();
  return { pc, dir, log, sshArgs: () => JSON.parse(fs.readFileSync(log, 'utf8')) };
}
const body = (o = {}) => ({ name: 'Desktop', mac: 'AA-BB-CC-DD-EE-FF', ip: '127.0.0.1', sshUser: 'me', ...o });

test('mac and ip helpers', () => {
  assert.equal(normMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normMac('aabbccddeeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normMac('aa:bb:cc:dd:ee'), null);
  assert.equal(normMac('aa:bb:cc:dd:ee:gg'), null);
  assert.equal(normMac('aa:bb-cc:dd-ee:ff'), null);
  for (const ip of ['192.168.1.5', '10.0.0.1', '172.16.0.9', '172.31.255.1']) assert.ok(isPrivateV4(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '127.0.0.1', 'example.com', '192.168.1']) assert.ok(!isPrivateV4(ip), ip);
});

test('magic packet is 6 x FF then the MAC 16 times', () => {
  const p = magicPacket('aa:bb:cc:dd:ee:ff');
  assert.equal(p.length, 102);
  assert.ok(p.subarray(0, 6).every((b) => b === 0xff));
  for (let i = 0; i < 16; i++) assert.equal(p.subarray(6 + i * 6, 12 + i * 6).toString('hex'), 'aabbccddeeff');
});

test('add validates input and refuses public or loopback addresses', async () => {
  const { pc } = setup({ allowAnyIp: false });
  assert.equal(await code(pc.add(body({ name: '' }))), 'bad_name');
  assert.equal(await code(pc.add(body({ mac: 'nope' }))), 'bad_mac');
  assert.equal(await code(pc.add(body({ ip: '8.8.8.8' }))), 'bad_ip');
  assert.equal(await code(pc.add(body({ ip: '127.0.0.1' }))), 'bad_ip');
  assert.equal(await code(pc.add(body({ ip: '192.168.1.10', sshUser: 'a b; rm' }))), 'bad_user');
  assert.equal(await code(pc.add(body({ ip: '192.168.1.10', sshPort: 70000 }))), 'bad_port');
  const it = await pc.add(body({ ip: '192.168.1.10' }));
  assert.equal(it.mac, 'aa:bb:cc:dd:ee:ff');
  assert.equal(it.sshPort, 22);
  assert.equal(await code(pc.add(body({ ip: '192.168.1.11' }))), 'exists');
});

test('wake sends the magic packet and the list persists across restarts', async () => {
  const udp = await udpListener();
  const { pc, dir } = setup({ sendTo: [{ address: '127.0.0.1', port: 9 }] });
  const it = await pc.add(body());
  const pc2 = createPc({ dataDir: path.join(dir, 'data'), allowAnyIp: true, probePorts: [1], cooldownMs: 0, sendTo: [{ address: '127.0.0.1', port: udp.port }] });
  pc2.init();
  assert.equal((await pc2.list()).items.length, 1);
  await pc2.wake(it.id);
  await sleep(300);
  assert.ok(udp.got.length >= 3, 'sent several times: ' + udp.got.length);
  assert.ok(udp.got[0].equals(magicPacket('aa:bb:cc:dd:ee:ff')));
  assert.equal(await code(pc2.wake('nope')), 'not_found');
});

test('online status comes from a TCP probe; a refusal counts as up', async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => srv.close(r)));
  const { pc } = setup({ probePorts: [srv.address().port] });
  await pc.add(body());
  assert.equal((await pc.list()).items[0].online, true);
  const closed = net.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  const { pc: pc2 } = setup({ probePorts: [port] });
  await pc2.add(body());
  assert.equal((await pc2.list()).items[0].online, true); // ECONNREFUSED means the host answered
  const { pc: pc3 } = setup({ probePorts: [1] });
  await pc3.add(body({ ip: '10.255.255.1' })); // nothing answers there: times out
  assert.equal((await pc3.list()).items[0].online, false);
});

test('shutdown runs ssh with the agent key; the key is created once', async () => {
  const { pc, sshArgs, dir } = setup();
  const it = await pc.add(body({ sshPort: 2222 }));
  await pc.shutdown(it.id);
  const a = sshArgs();
  assert.ok(a.includes('BatchMode=yes') && a.includes('me@127.0.0.1') && a.includes('2222'));
  assert.equal(a[a.length - 1], 'shutdown');
  assert.ok(a.includes(path.join(dir, 'data', 'pc_key')));
  const key = await pc.publicKey();
  assert.match(key, /^ssh-ed25519 AAAA/);
  await pc.shutdown(it.id);
  assert.equal(await pc.publicKey(), key);
});

test('shutdown errors: no user, auth failure, unreachable', async () => {
  const { pc } = setup();
  const nouser = await pc.add(body({ sshUser: '', mac: '11:22:33:44:55:66' }));
  assert.equal(await code(pc.shutdown(nouser.id)), 'no_ssh_user');
  const it = await pc.add(body());
  process.env.FAKE_SSH_MODE = 'auth';
  assert.equal(await code(pc.shutdown(it.id)), 'auth_failed');
  process.env.FAKE_SSH_MODE = 'refused';
  assert.equal(await code(pc.shutdown(it.id)), 'unreachable');
});

test('setUser changes the ssh user and validates it', async () => {
  const { pc, sshArgs } = setup();
  const it = await pc.add(body({ sshUser: '' }));
  assert.equal(await code(pc.shutdown(it.id)), 'no_ssh_user');
  assert.equal(await code(Promise.resolve().then(() => pc.setUser(it.id, 'bad user!'))), 'bad_user');
  assert.equal(pc.setUser(it.id, 'Admin').sshUser, 'Admin');
  await pc.shutdown(it.id);
  assert.ok(sshArgs().includes('Admin@127.0.0.1'));
  assert.equal(await code(Promise.resolve().then(() => pc.setUser('nope', 'x'))), 'not_found');
});

test('rapid repeats are refused and delete forgets the pc', async () => {
  const udp = await udpListener();
  const { pc } = setup({ cooldownMs: 5000, sendTo: [{ address: '127.0.0.1', port: udp.port }] });
  const it = await pc.add(body());
  await pc.wake(it.id);
  assert.equal(await code(pc.wake(it.id)), 'too_fast');
  pc.remove(it.id);
  assert.equal((await pc.list()).items.length, 0);
});

test('http routes', async () => {
  const { pc } = setup();
  const call = async (key, { body: b, query } = {}) => {
    const req = new (require('stream').Readable)({ read() {} });
    if (b !== undefined) req.push(JSON.stringify(b));
    req.push(null);
    let status; let text = '';
    const res = { headersSent: false, writeHead(c) { status = c; }, end(t) { text = t; this.headersSent = true; }, destroy() {} };
    await pc.routes[key](req, res, new URL('http://x/pc' + (query || '')));
    return { status, json: JSON.parse(text) };
  };
  let r = await call('POST /pc/add', { body: body({ mac: 'bad' }) });
  assert.deepEqual([r.status, r.json.error], [400, 'bad_mac']);
  r = await call('POST /pc/add', { body: body() });
  assert.equal(r.status, 200);
  const id = r.json.item.id;
  r = await call('POST /pc/key', { body: {} });
  assert.match(r.json.key, /^ssh-ed25519 /);
  r = await call('GET /pc/list');
  assert.equal(r.json.items.length, 1);
  assert.match(r.json.key, /^ssh-ed25519 /);
  r = await call('POST /pc/shutdown', { body: { id } });
  assert.equal(r.status, 200);
  r = await call('POST /pc/wake', { body: [1] });
  assert.equal(r.status, 400);
  r = await call('DELETE /pc', { query: '?id=' + id });
  assert.equal(r.status, 200);
  r = await call('DELETE /pc', { query: '?id=' + id });
  assert.equal(r.status, 404);
});
