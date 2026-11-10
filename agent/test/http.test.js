'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const TOKEN = 'test-token-' + Math.random().toString(16).slice(2);
const SERVER = path.join(__dirname, '..', 'server.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-http-'));
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function boot(name, extraEnv = {}) {
  const port = await freePort();
  const filesRoot = path.join(tmp, name);
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN,
      FILES_ROOT: filesRoot, TOKEN_FILE: path.join(tmp, name + '.token'), ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
  });
  cleanups.push(() => new Promise((r) => { child.removeAllListeners('exit'); child.once('exit', r); child.kill(); }));
  return { port, filesRoot };
}

function req(port, method, p, { body, headers = {}, token = TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    let payload = body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) h['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch { /* binary */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const q = (o) => new URLSearchParams(o).toString();

test('auth', async () => {
  const { port } = await boot('auth');
  assert.strictEqual((await req(port, 'GET', '/files/list', { token: null })).status, 401);
  assert.strictEqual((await req(port, 'GET', '/files/list', { token: 'nope' })).status, 401);
  assert.strictEqual((await req(port, 'GET', '/files/list')).status, 200);
  assert.strictEqual((await req(port, 'GET', '/status')).status, 200);
  assert.strictEqual((await req(port, 'DELETE', '/files?path=x', { token: null })).status, 401);
});

test('files API', async (t) => {
  const { port, filesRoot } = await boot('main');
  const upload = (dir, name, body, extra = {}) =>
    req(port, 'PUT', '/files/upload?' + q({ path: dir, name, ...extra }), { body });

  await t.test('list order, hidden entries', async () => {
    fs.mkdirSync(path.join(filesRoot, 'beta'));
    fs.mkdirSync(path.join(filesRoot, 'Alpha'));
    fs.mkdirSync(path.join(filesRoot, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(filesRoot, 'b.txt'), 'bb');
    fs.writeFileSync(path.join(filesRoot, 'A.txt'), 'a');
    fs.writeFileSync(path.join(filesRoot, 'c.txt.part'), 'partial');
    fs.writeFileSync(path.join(filesRoot, 'Zed.txt'), 'z');
    const r = await req(port, 'GET', '/files/list?path=');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.path, '');
    assert.deepStrictEqual(r.json.entries.map((e) => e.name), ['Alpha', 'beta', 'A.txt', 'b.txt', 'Zed.txt']);
    assert.deepStrictEqual(r.json.entries.map((e) => e.type), ['dir', 'dir', 'file', 'file', 'file']);
    const b = r.json.entries.find((e) => e.name === 'b.txt');
    assert.strictEqual(b.size, 2);
    assert.ok(!Number.isNaN(Date.parse(b.modified)));
    assert.strictEqual((await req(port, 'GET', '/files/list?path=nope')).status, 404);
    assert.strictEqual((await req(port, 'GET', '/files/list?path=b.txt')).json.error, 'not_a_directory');
    assert.strictEqual((await req(port, 'GET', '/files/list?path=' + encodeURIComponent('../'))).json.error, 'bad_path');
    assert.strictEqual((await req(port, 'GET', '/files/list?path=%252e%252e')).json.error, 'bad_path');
    assert.strictEqual((await req(port, 'GET', '/files/list?path=.trash')).json.error, 'bad_path');
  });

  await t.test('upload then download is byte-equal', async () => {
    const data = Buffer.alloc(3 * 1024 * 1024 + 17);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255;
    const u = await upload('photos/2024', 'big.bin', data);
    assert.strictEqual(u.status, 200);
    assert.deepStrictEqual(u.json, { ok: true, name: 'big.bin', size: data.length });
    const d = await req(port, 'GET', '/files/download?path=photos/2024/big.bin');
    assert.strictEqual(d.status, 200);
    assert.ok(d.buf.equals(data));
    assert.strictEqual(d.headers['content-length'], String(data.length));
    assert.strictEqual(d.headers['accept-ranges'], 'bytes');
    assert.match(d.headers['content-disposition'], /^attachment;.*filename\*=UTF-8''big\.bin$/);
    assert.deepStrictEqual(fs.readdirSync(path.join(filesRoot, 'photos', '2024')), ['big.bin']);
  });

  await t.test('unicode filename', async () => {
    const u = await upload('', 'файл 😀.txt', Buffer.from('hi'));
    assert.strictEqual(u.status, 200);
    const d = await req(port, 'GET', '/files/download?' + q({ path: 'файл 😀.txt' }));
    assert.strictEqual(d.buf.toString(), 'hi');
    assert.ok(d.headers['content-disposition'].includes("filename*=UTF-8''%D1%84"));
  });

  await t.test('overwrite 409 then overwrite=1', async () => {
    assert.strictEqual((await upload('', 'o.txt', Buffer.from('one'))).status, 200);
    const r = await upload('', 'o.txt', Buffer.from('two'));
    assert.strictEqual(r.status, 409);
    assert.deepStrictEqual(r.json, { error: 'exists' });
    assert.strictEqual((await req(port, 'GET', '/files/download?path=o.txt')).buf.toString(), 'one');
    assert.strictEqual((await upload('', 'o.txt', Buffer.from('three!'), { overwrite: '1' })).status, 200);
    assert.strictEqual((await req(port, 'GET', '/files/download?path=o.txt')).buf.toString(), 'three!');
  });

  await t.test('range 206 and 416', async () => {
    await upload('', 'r.txt', Buffer.from('0123456789'));
    const get = (range) => req(port, 'GET', '/files/download?path=r.txt', { headers: { Range: range } });
    let r = await get('bytes=2-5');
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.buf.toString(), '2345');
    assert.strictEqual(r.headers['content-range'], 'bytes 2-5/10');
    assert.strictEqual(r.headers['content-length'], '4');
    r = await get('bytes=7-');
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.buf.toString(), '789');
    r = await get('bytes=-3');
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.buf.toString(), '789');
    assert.strictEqual(r.headers['content-range'], 'bytes 7-9/10');
    r = await get('bytes=8-100');
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.buf.toString(), '89');
    r = await get('bytes=10-');
    assert.strictEqual(r.status, 416);
    assert.strictEqual(r.headers['content-range'], 'bytes */10');
    assert.strictEqual((await get('bytes=50-60')).status, 416);
  });

  await t.test('download errors', async () => {
    assert.strictEqual((await req(port, 'GET', '/files/download?path=missing')).status, 404);
    const d = await req(port, 'GET', '/files/download?path=photos');
    assert.strictEqual(d.status, 400);
    assert.strictEqual(d.json.error, 'is_a_directory');
  });

  await t.test('mkdir', async () => {
    let r = await req(port, 'POST', '/files/mkdir', { body: { path: 'docs/new' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true });
    assert.ok(fs.statSync(path.join(filesRoot, 'docs', 'new')).isDirectory());
    r = await req(port, 'POST', '/files/mkdir', { body: { path: 'docs/new' } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await req(port, 'POST', '/files/mkdir', { body: { path: '../evil' } })).status, 400);
    assert.strictEqual((await req(port, 'POST', '/files/mkdir', { body: { path: '.trash2' } })).status, 400);
  });

  await t.test('rename', async () => {
    await upload('docs', 'a.txt', Buffer.from('A'));
    await upload('docs', 'taken.txt', Buffer.from('T'));
    let r = await req(port, 'POST', '/files/rename', { body: { from: 'docs/a.txt', to: 'docs/c.txt' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true });
    assert.ok(!fs.existsSync(path.join(filesRoot, 'docs', 'a.txt')));
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'docs', 'c.txt'), 'utf8'), 'A');
    r = await req(port, 'POST', '/files/rename', { body: { from: 'docs/c.txt', to: 'docs/taken.txt' } });
    assert.strictEqual(r.status, 409);
    r = await req(port, 'POST', '/files/rename', { body: { from: 'docs/nope.txt', to: 'docs/z.txt' } });
    assert.strictEqual(r.status, 404);
    r = await req(port, 'POST', '/files/rename', { body: { from: 'docs/c.txt', to: 'a/../../x' } });
    assert.strictEqual(r.status, 400);
  });

  await t.test('delete moves to .trash', async () => {
    await upload('', 'del.txt', Buffer.from('bye'));
    const r = await req(port, 'DELETE', '/files?path=del.txt');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true });
    assert.ok(!fs.existsSync(path.join(filesRoot, 'del.txt')));
    const trashed = fs.readdirSync(path.join(filesRoot, '.trash')).filter((n) => n !== '.meta');
    assert.strictEqual(trashed.length, 1);
    assert.match(trashed[0], /^\d+-del\.txt$/);
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, '.trash', trashed[0]), 'utf8'), 'bye');
    assert.strictEqual((await req(port, 'DELETE', '/files?path=docs')).status, 200);
    assert.strictEqual((await req(port, 'DELETE', '/files?path=docs')).status, 404);
    assert.strictEqual((await req(port, 'DELETE', '/files?path=')).status, 400);
    assert.strictEqual((await req(port, 'DELETE', '/files?path=/')).status, 400);
    assert.strictEqual((await req(port, 'DELETE', '/files')).status, 400);
    assert.strictEqual((await req(port, 'DELETE', '/files?path=.trash')).status, 400);
  });

  await t.test('upload validation', async () => {
    for (const name of ['..', '.', 'a/b', 'a\\b', '.trash', '.trash-x', '', 'x'.repeat(256)]) {
      const r = await upload('', name, Buffer.from('x'));
      assert.strictEqual(r.status, 400, JSON.stringify(name));
      assert.strictEqual(r.json.error, 'bad_path');
    }
    assert.strictEqual((await upload('../x', 'ok.txt', Buffer.from('x'))).status, 400);
    assert.strictEqual((await upload('o.txt', 'ok.txt', Buffer.from('x'))).json.error, 'not_a_directory');
    assert.strictEqual((await upload('', 'photos', Buffer.from('x'), { overwrite: '1' })).json.error, 'is_a_directory');
    assert.strictEqual((await upload('photos', '.trash', Buffer.from('x'))).status, 200);
  });

  await t.test('upload aborted mid-stream leaves nothing behind', async () => {
    const dir = path.join(filesRoot, 'abort');
    fs.mkdirSync(dir);
    await new Promise((resolve) => {
      const r = http.request({
        host: '127.0.0.1', port, method: 'PUT', agent: false,
        path: '/files/upload?' + q({ path: 'abort', name: 'half.bin' }),
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Length': 5000000 },
      });
      r.on('error', () => {});
      r.write(Buffer.alloc(100000, 1), () => setTimeout(() => { r.destroy(); resolve(); }, 150));
    });
    const deadline = Date.now() + 3000;
    while (fs.readdirSync(dir).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

test('too_large returns 413 and cleans up', async () => {
  const { port, filesRoot } = await boot('small', { MAX_UPLOAD_BYTES: '10' });
  const ok = await req(port, 'PUT', '/files/upload?name=ten.bin', { body: Buffer.alloc(10, 1) });
  assert.strictEqual(ok.status, 200);
  const r = await req(port, 'PUT', '/files/upload?name=big.bin', { body: Buffer.alloc(11, 1) });
  assert.strictEqual(r.status, 413);
  assert.deepStrictEqual(r.json, { error: 'too_large' });

  // chunked (no Content-Length): detected while streaming
  const chunked = await new Promise((resolve, reject) => {
    const rq = http.request({
      host: '127.0.0.1', port, method: 'PUT', agent: false, path: '/files/upload?name=chunked.bin',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Transfer-Encoding': 'chunked' },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    rq.on('error', reject);
    rq.write(Buffer.alloc(6, 1));
    rq.write(Buffer.alloc(6, 1));
    rq.end();
  });
  assert.strictEqual(chunked, 413);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepStrictEqual(fs.readdirSync(filesRoot).sort(), ['ten.bin']);
});
