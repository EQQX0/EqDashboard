'use strict';
// Regression tests for the review fixes: upload part files, trash purge, auth lockout, relay paths,
// download host checks and the yt-dlp output path.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { purgeTrash } = require('../files');
const { createRelay } = require('../lights-relay');
const { createDownloads } = require('../downloads');

const TOKEN = 'hardening-token-' + Math.random().toString(16).slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-hard-'));
const closers = [];
test.after(async () => { for (const c of closers) await c(); fs.rmSync(tmp, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function boot(name) {
  const port = await freePort();
  const filesRoot = path.join(tmp, name);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN, FILES_ROOT: filesRoot, TOKEN_FILE: path.join(tmp, name + '.token') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
  });
  closers.push(() => new Promise((r) => { child.removeAllListeners('exit'); child.once('exit', r); child.kill(); }));
  return { port, filesRoot };
}

function call(port, method, p, { body, token = TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const h = {};
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined) h['Content-Length'] = body.length;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

test('two uploads of the same name never share a partial file', async () => {
  const { port, filesRoot } = await boot('up');
  const a = Buffer.alloc(3000000, 1);
  const b = Buffer.alloc(3000000, 2);
  const put = (body) => call(port, 'PUT', '/files/upload?name=same.bin&overwrite=1', { body });
  const [ra, rb] = await Promise.all([put(a), put(b)]);
  // Windows refuses to rename over a file another rename is replacing, so one upload may fail there; neither may corrupt the file.
  assert.ok([ra.status, rb.status].includes(200), 'at least one upload succeeds');
  for (const s of [ra.status, rb.status]) assert.ok(s === 200 || s === 500, 'status ' + s);
  const got = fs.readFileSync(path.join(filesRoot, 'same.bin'));
  assert.ok(got.equals(a) || got.equals(b), 'the file is one upload, not a mix');
  assert.deepStrictEqual(fs.readdirSync(filesRoot).filter((n) => n.endsWith('.part')), []);
});

test('five wrong tokens lock the address out, even for the right token', async () => {
  const { port } = await boot('lock');
  for (let i = 0; i < 5; i++) assert.strictEqual((await call(port, 'GET', '/status', { token: 'wrong' })).status, 401);
  assert.strictEqual((await call(port, 'GET', '/status')).status, 429);
});

test('purgeTrash removes old entries, keeps new ones, clears stale staging folders', async () => {
  const root = path.join(tmp, 'trash');
  const trash = path.join(root, '.trash');
  fs.mkdirSync(trash, { recursive: true });
  const now = Date.now();
  const day = 86400000;
  const mk = (n) => { fs.mkdirSync(path.join(trash, n)); fs.writeFileSync(path.join(trash, n, 'f'), 'x'); };
  mk(`${now - 40 * day}-old`);
  mk(`${now - 1 * day}-recent`);
  mk('.staging-abc');
  fs.utimesSync(path.join(trash, '.staging-abc'), new Date(now - 2 * day), new Date(now - 2 * day));
  mk('.staging-fresh');
  const n = await purgeTrash(root, 30 * day, now);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(fs.readdirSync(trash).sort(), [`${now - 1 * day}-recent`, '.staging-fresh'].sort());
  assert.strictEqual(await purgeTrash(path.join(tmp, 'nothing-here'), day, now), 0);
});

test('the lights relay refuses encoded slashes and dots', async () => {
  const relay = createRelay({
    getPc: () => ({ ip: '127.0.0.1', lightsUrl: 'http://127.0.0.1:1/?t=abcdefgh' }), host: '127.0.0.1',
  });
  const base = relay.open('pc1');
  const srv = http.createServer((req, res) => { if (!relay.handle(req, res)) { res.writeHead(500); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => srv.close(r)));
  const port = srv.address().port;
  for (const bad of ['preview/..%2fapi%2fsecret', 'preview/a%2Fb', 'preview/%2e%2e%2fx', 'preview/a%5cb']) {
    assert.strictEqual((await call(port, 'GET', base + bad, { token: null })).status, 404, bad);
  }
  // a normal picture path gets through to the PC (nothing listens there, so the relay answers 502)
  assert.strictEqual((await call(port, 'GET', base + 'preview/a.png', { token: null })).status, 502);
});

const FAKE_YT = path.join(__dirname, '..', 'testlib', 'fake-ytdlp.js');
function makeDl(extra = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'dl-'));
  const dl = createDownloads({
    filesRoot: path.join(root, 'files'), dataDir: path.join(root, 'data'), minFree: 0, spawnAria2: false, aria2Secret: 's',
    ytdlpCmd: [process.execPath, FAKE_YT], lookup: async () => [{ address: '93.184.216.34' }], ...extra,
  });
  dl.init();
  return dl;
}

test('a name that resolves to this phone is refused, a public one is not', async () => {
  const toLoopback = makeDl({ lookup: async () => [{ address: '127.0.0.1' }] });
  await assert.rejects(toLoopback.add({ url: 'https://sneaky.example.com/watch?v=1' }), (e) => e.code === 'blocked_url');
  const toLinkLocal = makeDl({ lookup: async () => [{ address: '8.8.8.8' }, { address: '169.254.169.254' }] });
  await assert.rejects(toLinkLocal.add({ url: 'https://sneaky.example.com/watch?v=1' }), (e) => e.code === 'blocked_url');
  const fine = makeDl();
  assert.strictEqual((await fine.add({ url: 'https://ok.example.com/watch?v=1' })).engine, 'ytdlp');
  const cantResolve = makeDl({ lookup: async () => { throw new Error('ENOTFOUND'); } });
  assert.strictEqual((await cantResolve.add({ url: 'https://gone.example.com/watch?v=1' })).engine, 'ytdlp');
});

test('a fake FINAL line pointing outside the job folder is ignored', async () => {
  const dl = makeDl();
  const item = await dl.add({ url: 'https://v.example.com/inject' });
  const deadline = Date.now() + 6000;
  let done;
  while (Date.now() < deadline) {
    done = (await dl.list()).items.find((i) => i.id === item.id);
    if (done && (done.status === 'complete' || done.status === 'error')) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(done.status, 'complete', done.error);
  assert.strictEqual(done.name, 'Fake Title [abc].mp4');
  assert.deepStrictEqual(fs.readdirSync(dl.DL_DIR).filter((n) => !n.startsWith('.')), ['Fake Title [abc].mp4']);
});
