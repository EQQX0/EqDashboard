'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { buildZip } = require('../testlib/zipbuilder');

const TOKEN = 'test-token-' + Math.random().toString(16).slice(2);
const SERVER = path.join(__dirname, '..', 'server.js');
const DOMAIN = 'example.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-sites-'));
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
  const sitesPort = await freePort();
  const filesRoot = path.join(tmp, name, 'files');
  const dataDir = path.join(tmp, name, 'data');
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN, FILES_ROOT: filesRoot,
      TOKEN_FILE: path.join(tmp, name + '.token'), SITES_PORT: String(sitesPort), SITES_DOMAIN: DOMAIN,
      DATA_DIR: dataDir, ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    let out = '';
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('agent listening') && out.includes('sites listening')) resolve();
    });
  });
  cleanups.push(() => new Promise((r) => { child.removeAllListeners('exit'); child.once('exit', r); child.kill(); }));
  return { port, sitesPort, filesRoot, dataDir };
}

function request(port, method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Length'] = Buffer.byteLength(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

// Management API client (authenticated).
function api(port, method, p, { body, headers = {}, token = TOKEN } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  let payload = body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  return request(port, method, p, { body: payload, headers: h });
}

// Public site client.
const pub = (sp, p, { host = 'blog.' + DOMAIN, method = 'GET', headers = {} } = {}) =>
  request(sp, method, p, { headers: { Host: host, ...headers } });

const write = (f, content) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

test('public site server', async (t) => {
  const { port, sitesPort, filesRoot } = await boot('pub');
  const site = path.join(filesRoot, 'sites', 'blog');
  const created = await api(port, 'POST', '/sites/create', { body: { name: 'blog' } });
  assert.strictEqual(created.status, 200);
  write(path.join(site, 'index.html'), '<h1>home</h1>');
  write(path.join(site, 'style.css'), 'body{}');
  write(path.join(site, 'sub', 'index.html'), '<h1>sub</h1>');
  fs.mkdirSync(path.join(site, 'emptydir'));
  write(path.join(site, '.env'), 'TOPSECRET');
  write(path.join(site, 'video.bin'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  write(path.join(filesRoot, 'secret.txt'), 'TOPSECRET');
  write(path.join(filesRoot, 'sites', 'secret2.txt'), 'TOPSECRET');

  await t.test('host routing', async () => {
    assert.strictEqual((await pub(sitesPort, '/')).text, '<h1>home</h1>');
    assert.strictEqual((await pub(sitesPort, '/', { host: 'BLOG.Example.TEST' })).status, 200);
    assert.strictEqual((await pub(sitesPort, '/', { host: `blog.${DOMAIN}:8790` })).status, 200);
    for (const host of ['blog.other.test', `${DOMAIN}`, `blog.${DOMAIN}.evil.com`, `a.blog.${DOMAIN}`, `nope.${DOMAIN}`, `.${DOMAIN}`]) {
      const r = await pub(sitesPort, '/', { host });
      assert.strictEqual(r.status, 404, host);
      assert.strictEqual(r.text, 'Not found');
      assert.strictEqual(r.headers['x-s21-site'], '1');
    }
    await api(port, 'POST', '/sites/update', { body: { name: 'blog', enabled: false } });
    assert.strictEqual((await pub(sitesPort, '/')).status, 404);
    await api(port, 'POST', '/sites/update', { body: { name: 'blog', enabled: true } });
    assert.strictEqual((await pub(sitesPort, '/')).status, 200);
  });

  await t.test('traversal and dotfiles', async () => {
    const paths = [
      '/../secret.txt', '/../../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/%2E%2E/secret.txt',
      '/%252e%252e/secret.txt', '/%252e%252e%252fsecret.txt', '/..%5csecret.txt', '/a%5c..%5csecret.txt',
      '/..\\secret.txt', '/sub/../../secret.txt', '/sub/%2e%2e/index.html', '/.env', '/%2eenv', '/sub/.env',
      '/.trash/x', '/x%00', '/x%00.html', '/%00', '/index.html%00', '/../sites/secret2.txt',
    ];
    for (const p of paths) {
      const r = await pub(sitesPort, p);
      assert.strictEqual(r.status, 404, p);
      assert.ok(!r.text.includes('TOPSECRET'), p);
      assert.strictEqual(r.headers['x-s21-site'], '1');
    }
    // raw socket, no client-side normalisation at all
    const raw = await new Promise((resolve) => {
      const s = net.connect(sitesPort, '127.0.0.1', () => {
        s.write(`GET /../../secret.txt HTTP/1.1\r\nHost: blog.${DOMAIN}\r\nConnection: close\r\n\r\n`);
      });
      let d = '';
      s.on('data', (c) => { d += c; });
      s.on('close', () => resolve(d));
    });
    assert.match(raw, /^HTTP\/1\.1 404/);
    assert.ok(!raw.includes('TOPSECRET'));
  });

  await t.test('symlink escape', async (tt) => {
    try {
      fs.symlinkSync(path.join(filesRoot, 'secret.txt'), path.join(site, 'link.txt'));
      fs.symlinkSync(filesRoot, path.join(site, 'linkdir'), 'junction');
    } catch { return tt.skip('symlinks unavailable'); }
    for (const p of ['/link.txt', '/linkdir/secret.txt', '/linkdir/']) {
      const r = await pub(sitesPort, p);
      assert.strictEqual(r.status, 404, p);
      assert.ok(!r.text.includes('TOPSECRET'), p);
    }
  });

  await t.test('index, redirect, headers', async () => {
    const root = await pub(sitesPort, '/');
    assert.match(root.headers['content-type'], /^text\/html; charset=utf-8/);
    assert.strictEqual(root.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(root.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.strictEqual(root.headers['cache-control'], 'public, max-age=60');
    assert.strictEqual(root.headers['x-s21-site'], '1');
    assert.strictEqual(root.headers['accept-ranges'], 'bytes');
    const css = await pub(sitesPort, '/style.css');
    assert.strictEqual(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.strictEqual(css.headers['cache-control'], 'public, max-age=3600');
    assert.strictEqual((await pub(sitesPort, '/video.bin')).headers['content-type'], 'application/octet-stream');
    const redir = await pub(sitesPort, '/sub?x=1');
    assert.strictEqual(redir.status, 301);
    assert.strictEqual(redir.headers.location, '/sub/?x=1');
    assert.strictEqual((await pub(sitesPort, '/sub/')).text, '<h1>sub</h1>');
    assert.strictEqual((await pub(sitesPort, '/emptydir/')).status, 404);
    const evil = await pub(sitesPort, '//evil.com');
    assert.strictEqual(evil.status, 404);
    assert.ok(!evil.headers.location);
    assert.strictEqual((await pub(sitesPort, '/style.css/')).status, 404);
  });

  await t.test('spa fallback and custom 404', async () => {
    assert.strictEqual((await pub(sitesPort, '/app/route')).status, 404);
    await api(port, 'POST', '/sites/update', { body: { name: 'blog', spa: true } });
    const r = await pub(sitesPort, '/app/route');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.text, '<h1>home</h1>');
    assert.strictEqual((await pub(sitesPort, '/missing.js')).status, 404);
    await api(port, 'POST', '/sites/update', { body: { name: 'blog', spa: false } });
    assert.strictEqual((await pub(sitesPort, '/app/route')).status, 404);
    write(path.join(site, '404.html'), '<h1>custom</h1>');
    const c = await pub(sitesPort, '/nope');
    assert.strictEqual(c.status, 404);
    assert.strictEqual(c.text, '<h1>custom</h1>');
    assert.strictEqual(c.headers['x-s21-site'], '1');
    fs.rmSync(path.join(site, '404.html'));
    const b = await pub(sitesPort, '/nope');
    assert.strictEqual(b.status, 404);
    assert.match(b.text, /404/);
    assert.strictEqual(b.headers['x-s21-site'], '1');
  });

  await t.test('etag, range, head, methods', async () => {
    const first = await pub(sitesPort, '/style.css');
    const etag = first.headers.etag;
    assert.ok(etag);
    const nm = await pub(sitesPort, '/style.css', { headers: { 'If-None-Match': etag } });
    assert.strictEqual(nm.status, 304);
    assert.strictEqual(nm.buf.length, 0);
    assert.strictEqual((await pub(sitesPort, '/style.css', { headers: { 'If-None-Match': '"other"' } })).status, 200);

    const r1 = await pub(sitesPort, '/video.bin', { headers: { Range: 'bytes=0-9' } });
    assert.strictEqual(r1.status, 206);
    assert.strictEqual(r1.headers['content-range'], 'bytes 0-9/1000');
    assert.strictEqual(r1.headers['content-length'], '10');
    assert.deepStrictEqual([...r1.buf], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const r2 = await pub(sitesPort, '/video.bin', { headers: { Range: 'bytes=-5' } });
    assert.strictEqual(r2.status, 206);
    assert.strictEqual(r2.headers['content-range'], 'bytes 995-999/1000');
    const r3 = await pub(sitesPort, '/video.bin', { headers: { Range: 'bytes=5000-' } });
    assert.strictEqual(r3.status, 416);
    assert.strictEqual(r3.headers['content-range'], 'bytes */1000');

    const h = await pub(sitesPort, '/video.bin', { method: 'HEAD' });
    assert.strictEqual(h.status, 200);
    assert.strictEqual(h.headers['content-length'], '1000');
    assert.strictEqual(h.buf.length, 0);
    const h404 = await pub(sitesPort, '/nope', { method: 'HEAD' });
    assert.strictEqual(h404.status, 404);
    assert.strictEqual(h404.buf.length, 0);

    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await pub(sitesPort, '/', { method: m });
      assert.strictEqual(r.status, 405, m);
      assert.strictEqual(r.headers.allow, 'GET, HEAD');
      assert.strictEqual(r.headers['x-s21-site'], '1');
    }
  });
});

test('public rate limit', async () => {
  const { port, sitesPort } = await boot('rate');
  await api(port, 'POST', '/sites/create', { body: { name: 'blog' } });
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const batch = [];
    for (let j = 0; j < 50; j++) batch.push(pub(sitesPort, '/', { headers: { 'cf-connecting-ip': '9.9.9.9' } }));
    for (const r of await Promise.all(batch)) statuses.push(r.status);
  }
  assert.strictEqual(statuses.filter((s) => s === 200).length, 600);
  assert.strictEqual(statuses.filter((s) => s === 429).length, 0);
  const over = await pub(sitesPort, '/', { headers: { 'cf-connecting-ip': '9.9.9.9' } });
  assert.strictEqual(over.status, 429);
  assert.strictEqual(over.headers['x-s21-site'], '1');
  assert.strictEqual((await pub(sitesPort, '/', { headers: { 'cf-connecting-ip': '8.8.8.8' } })).status, 200);
});

test('management API', async (t) => {
  const { port, sitesPort, filesRoot, dataDir } = await boot('mgmt');

  await t.test('auth required on every route', async () => {
    const routes = [
      ['GET', '/sites/list'], ['POST', '/sites/create'], ['POST', '/sites/update'], ['DELETE', '/sites?name=x'],
      ['POST', '/sites/deploy?name=x'], ['GET', '/sites/check?name=x'],
    ];
    let i = 0;
    for (const [m, p] of routes) {
      const r = await api(port, m, p, { token: null, headers: { 'cf-connecting-ip': '10.0.0.' + (++i) } });
      assert.strictEqual(r.status, 401, m + ' ' + p);
    }
  });

  await t.test('create, validation, list', async () => {
    const ok = await api(port, 'POST', '/sites/create', { body: { name: 'blog', spa: false } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.ok, true);
    assert.strictEqual(ok.json.site.name, 'blog');
    assert.strictEqual(ok.json.site.hostname, 'blog.' + DOMAIN);
    assert.strictEqual(ok.json.site.enabled, true);
    const starter = fs.readFileSync(path.join(filesRoot, 'sites', 'blog', 'index.html'), 'utf8');
    assert.match(starter, /blog\.example\.test is live/);
    assert.match(starter, /sites\/blog\//);
    assert.ok(fs.existsSync(path.join(dataDir, 'sites.json')));

    for (const name of ['Blog', '-a', 'a-', 'a_b', '', 'x'.repeat(33), 'a.b', 5, null]) {
      const r = await api(port, 'POST', '/sites/create', { body: { name } });
      assert.strictEqual(r.status, 400, String(name));
      assert.deepStrictEqual(r.json, { error: 'bad_name' });
    }
    assert.strictEqual((await api(port, 'POST', '/sites/create', { body: { name: 'x'.repeat(32) } })).status, 200);
    for (const name of ['api', 'www', 'sites', 'ns2', 'downloader']) {
      const r = await api(port, 'POST', '/sites/create', { body: { name } });
      assert.strictEqual(r.status, 400, name);
      assert.deepStrictEqual(r.json, { error: 'reserved_name' });
    }
    const dup = await api(port, 'POST', '/sites/create', { body: { name: 'blog' } });
    assert.strictEqual(dup.status, 409);
    assert.deepStrictEqual(dup.json, { error: 'exists' });

    fs.writeFileSync(path.join(filesRoot, 'sites', 'blog', 'a.txt'), '12345');
    fs.mkdirSync(path.join(filesRoot, 'sites', 'orphan'));
    const list = await api(port, 'GET', '/sites/list');
    assert.strictEqual(list.json.domain, DOMAIN);
    const blog = list.json.sites.find((s) => s.name === 'blog');
    assert.strictEqual(blog.files, 2);
    assert.strictEqual(blog.bytes, starter.length + 5);
    assert.strictEqual(blog.spa, false);
    assert.ok(!Number.isNaN(Date.parse(blog.modified)));
    assert.ok(!Number.isNaN(Date.parse(blog.createdAt)));
    assert.ok(!list.json.sites.some((s) => s.name === 'orphan'));
  });

  await t.test('update', async () => {
    const r = await api(port, 'POST', '/sites/update', { body: { name: 'blog', enabled: false, spa: true } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.site.enabled, false);
    assert.strictEqual(r.json.site.spa, true);
    const r2 = await api(port, 'POST', '/sites/update', { body: { name: 'blog', enabled: true } });
    assert.strictEqual(r2.json.site.spa, true);
    assert.strictEqual(r2.json.site.enabled, true);
    const nf = await api(port, 'POST', '/sites/update', { body: { name: 'ghost', enabled: true } });
    assert.strictEqual(nf.status, 404);
    assert.deepStrictEqual(nf.json, { error: 'not_found' });
    assert.strictEqual((await api(port, 'POST', '/sites/update', { body: { name: 'blog', enabled: 'yes' } })).status, 400);
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'sites.json'), 'utf8'));
    assert.strictEqual(meta.sites.blog.spa, true);
    assert.deepStrictEqual(fs.readdirSync(dataDir).filter((f) => f.includes('.tmp-')), []);
  });

  await t.test('files API cannot rename or delete site folders', async () => {
    for (const [m, p, body] of [
      ['POST', '/files/rename', { from: 'sites', to: 'websites' }],
      ['POST', '/files/rename', { from: 'sites/blog', to: 'sites/blog2' }],
      ['DELETE', '/files?path=sites'],
      ['DELETE', '/files?path=sites/blog'],
    ]) {
      const r = await api(port, m, p, { body });
      assert.strictEqual(r.status, 400, m + ' ' + p);
      assert.deepStrictEqual(r.json, { error: 'bad_path' });
    }
    assert.ok(fs.existsSync(path.join(filesRoot, 'sites', 'blog')));
    // files inside a site stay manageable
    assert.strictEqual((await api(port, 'DELETE', '/files?path=sites/blog/a.txt')).status, 200);
    assert.strictEqual((await api(port, 'GET', '/files/list?path=sites/blog')).status, 200);
  });

  await t.test('delete moves to trash', async () => {
    assert.strictEqual((await api(port, 'POST', '/sites/create', { body: { name: 'gone' } })).status, 200);
    const r = await api(port, 'DELETE', '/sites?name=gone');
    assert.deepStrictEqual(r.json, { ok: true });
    assert.ok(!fs.existsSync(path.join(filesRoot, 'sites', 'gone')));
    const trashed = fs.readdirSync(path.join(filesRoot, '.trash')).filter((n) => /^\d+-site-gone$/.test(n));
    assert.strictEqual(trashed.length, 1);
    assert.ok(fs.existsSync(path.join(filesRoot, '.trash', trashed[0], 'index.html')));
    const list = await api(port, 'GET', '/sites/list');
    assert.ok(!list.json.sites.some((s) => s.name === 'gone'));
    assert.strictEqual((await api(port, 'DELETE', '/sites?name=gone')).status, 404);
    assert.strictEqual((await pub(sitesPort, '/', { host: 'gone.' + DOMAIN })).status, 404);
  });
});

test('deploy', async (t) => {
  const { port, sitesPort, filesRoot, dataDir } = await boot('deploy');
  const siteDir = path.join(filesRoot, 'sites', 'dep');
  await api(port, 'POST', '/sites/create', { body: { name: 'dep' } });
  const deploy = (zipBuf, name = 'dep', p = port) => api(p, 'POST', '/sites/deploy?name=' + name, { body: zipBuf });
  const tmpClean = () => assert.deepStrictEqual(fs.readdirSync(path.join(dataDir, 'tmp')), []);
  const stagingClean = () =>
    assert.deepStrictEqual(fs.readdirSync(path.join(filesRoot, '.trash')).filter((n) => n.startsWith('.staging')), []);

  await t.test('ok, replaces and trashes the old copy, skips junk', async () => {
    write(path.join(siteDir, 'old.txt'), 'old');
    const zipBuf = buildZip([
      { name: 'index.html', data: '<h1>v1</h1>' },
      { name: 'css/', dir: true },
      { name: 'css/a.css', data: 'a{}'.repeat(100), method: 0 },
      { name: '__MACOSX/._index.html', data: 'junk' },
      { name: '.DS_Store', data: 'junk' },
    ]);
    const r = await deploy(zipBuf);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true, files: 2, bytes: 11 + 300 });
    assert.strictEqual(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), '<h1>v1</h1>');
    assert.ok(!fs.existsSync(path.join(siteDir, 'old.txt')));
    assert.ok(!fs.existsSync(path.join(siteDir, '.DS_Store')));
    assert.ok(!fs.existsSync(path.join(siteDir, '__MACOSX')));
    const olds = fs.readdirSync(path.join(filesRoot, '.trash')).filter((n) => /^\d+-site-dep-old/.test(n));
    assert.strictEqual(olds.length, 1);
    assert.ok(fs.existsSync(path.join(filesRoot, '.trash', olds[0], 'old.txt')));
    assert.strictEqual((await pub(sitesPort, '/', { host: 'dep.' + DOMAIN })).text, '<h1>v1</h1>');
    tmpClean();
    stagingClean();
  });

  await t.test('flattens a single top-level directory', async () => {
    const r = await deploy(buildZip([
      { name: 'mysite/', dir: true },
      { name: 'mysite/index.html', data: '<h1>flat</h1>' },
      { name: 'mysite/img/x.png', data: 'png' },
    ]));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), '<h1>flat</h1>');
    assert.ok(fs.existsSync(path.join(siteDir, 'img', 'x.png')));
    assert.ok(!fs.existsSync(path.join(siteDir, 'mysite')));
  });

  await t.test('does not flatten when index.html is at the root', async () => {
    const r = await deploy(buildZip([{ name: 'index.html', data: 'root' }, { name: 'only/a.txt', data: 'a' }]));
    assert.strictEqual(r.status, 200);
    assert.ok(fs.existsSync(path.join(siteDir, 'only', 'a.txt')));
    assert.ok(fs.existsSync(path.join(siteDir, 'index.html')));
  });

  await t.test('rejections leave the site untouched and temp clean', async () => {
    const before = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    const good = buildZip([{ name: 'index.html', data: 'hello hello hello', method: 0 }]);
    const cases = [
      ['zip-slip', buildZip([{ name: '../evil.txt', data: 'x' }, { name: 'index.html', data: 'i' }]), 'unsafe_zip'],
      ['nested slip', buildZip([{ name: 'a/../../evil.txt', data: 'x' }]), 'unsafe_zip'],
      ['absolute', buildZip([{ name: '/etc/evil.txt', data: 'x' }]), 'unsafe_zip'],
      ['drive letter', buildZip([{ name: 'C:/evil.txt', data: 'x' }]), 'unsafe_zip'],
      ['backslash', buildZip([{ name: 'a\\..\\evil.txt', data: 'x' }]), 'unsafe_zip'],
      ['symlink', buildZip([{ name: 'index.html', data: '/etc/passwd', mode: 0o120777 }]), 'unsafe_zip'],
      ['bomb', buildZip([{ name: 'big.txt', data: Buffer.alloc(11 * 1024 * 1024) }]), 'unsafe_zip'],
      ['bad crc', buildZip([{ name: 'index.html', data: 'hello', crc: 12345 }]), 'bad_zip'],
      ['truncated', good.subarray(0, good.length - 10), 'bad_zip'],
      ['truncated body', good.subarray(10), 'bad_zip'],
      ['garbage', Buffer.from('this is not a zip file at all'), 'bad_zip'],
      ['empty body', Buffer.alloc(0), 'bad_zip'],
    ];
    for (const [label, buf, code] of cases) {
      const r = await deploy(buf);
      assert.strictEqual(r.status, 400, label);
      assert.deepStrictEqual(r.json, { error: code }, label);
      tmpClean();
      stagingClean();
    }
    assert.strictEqual(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), before);
    for (const p of [path.join(filesRoot, 'evil.txt'), path.join(filesRoot, 'sites', 'evil.txt'),
      path.join(dataDir, 'evil.txt'), path.join(dataDir, 'tmp', 'evil.txt'), path.join(filesRoot, '.trash', 'evil.txt')]) {
      assert.ok(!fs.existsSync(p), p);
    }
  });

  await t.test('unknown site and bad name', async () => {
    const z = buildZip([{ name: 'index.html', data: 'x' }]);
    const nf = await deploy(z, 'ghost');
    assert.strictEqual(nf.status, 404);
    assert.deepStrictEqual(nf.json, { error: 'not_found' });
    assert.strictEqual((await deploy(z, 'Bad_Name')).status, 400);
    tmpClean();
  });

  await t.test('too_large', async () => {
    const small = await boot('deploy-small', { SITE_ZIP_MAX_BYTES: '200' });
    await api(small.port, 'POST', '/sites/create', { body: { name: 'dep' } });
    const big = buildZip([{ name: 'index.html', data: crypto_bytes(2000), method: 0 }]);
    const r = await deploy(big, 'dep', small.port);
    assert.strictEqual(r.status, 413);
    assert.deepStrictEqual(r.json, { error: 'too_large' });
    assert.deepStrictEqual(fs.readdirSync(path.join(small.dataDir, 'tmp')), []);
    // chunked body without Content-Length is stopped while streaming
    const chunked = await new Promise((resolve, reject) => {
      const rq = http.request({
        host: '127.0.0.1', port: small.port, method: 'POST', path: '/sites/deploy?name=dep', agent: false,
        headers: { Authorization: 'Bearer ' + TOKEN, 'Transfer-Encoding': 'chunked' },
      }, (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      });
      rq.on('error', reject);
      rq.write(big.subarray(0, 150));
      rq.write(big.subarray(150, 400));
      rq.end(big.subarray(400));
    });
    assert.strictEqual(chunked.status, 413);
    await new Promise((r2) => setTimeout(r2, 100));
    assert.deepStrictEqual(fs.readdirSync(path.join(small.dataDir, 'tmp')), []);
  });
});

function crypto_bytes(n) {
  return require('crypto').randomBytes(n);
}

test('check', async (t) => {
  let reply = { status: 200, headers: {} };
  const stub = http.createServer((req, res) => { res.writeHead(reply.status, reply.headers); res.end('x'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;
  cleanups.push(() => new Promise((r) => { stub.close(() => r()); stub.closeAllConnections?.(); }));
  const { port } = await boot('check', { SITES_TEST_CHECK_URL: `http://127.0.0.1:${stubPort}/` });
  await api(port, 'POST', '/sites/create', { body: { name: 'blog' } });
  const check = () => api(port, 'GET', '/sites/check?name=blog');

  await t.test('reachable', async () => {
    reply = { status: 200, headers: {} };
    assert.deepStrictEqual((await check()).json, { hostname: 'blog.' + DOMAIN, reachable: true, status: 200, error: null });
    reply = { status: 302, headers: { Location: '/elsewhere' } };
    const r = await check();
    assert.strictEqual(r.json.reachable, true);
    assert.strictEqual(r.json.status, 302);
    reply = { status: 404, headers: { 'x-s21-site': '1' } };
    assert.deepStrictEqual((await check()).json, { hostname: 'blog.' + DOMAIN, reachable: true, status: 404, error: null });
  });

  await t.test('not ours and server errors', async () => {
    reply = { status: 404, headers: {} };
    assert.deepStrictEqual((await check()).json, { hostname: 'blog.' + DOMAIN, reachable: false, status: 404, error: 'not_ours' });
    reply = { status: 530, headers: {} };
    assert.deepStrictEqual((await check()).json, { hostname: 'blog.' + DOMAIN, reachable: false, status: 530, error: 'http_530' });
  });

  await t.test('unknown site and auth', async () => {
    const r = await api(port, 'GET', '/sites/check?name=ghost');
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(r.json, { error: 'not_found' });
  });

  await t.test('connection refused', async () => {
    await new Promise((r) => { stub.close(() => r()); stub.closeAllConnections?.(); });
    const r = await check();
    assert.strictEqual(r.json.reachable, false);
    assert.strictEqual(r.json.status, null);
    assert.strictEqual(r.json.error, 'connection');
  });
});
