'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { createPc } = require('../pc');
const { rewriteHtml, rewriteJson } = require('../lights-relay');

const TOKEN = 'abcdef123456';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-lr-'));
const closers = [];
test.after(async () => { for (const c of closers) await c(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** A stand-in for EqRGB's phone server: needs the rgbt cookie, serves a page, JSON, a picture, and echoes POSTs. */
async function fakeEqrgb() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, cookie: req.headers.cookie, host: req.headers.host });
    if (req.headers.cookie !== `rgbt=${TOKEN}`) { res.writeHead(401); return res.end('no'); }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      return req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ got: Buffer.concat(chunks).toString() })); });
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'x=1' });
      return res.end('<head><link href="/logo.png"><style>a{background:url(/logo.png)}</style></head><script>fetch("/api/"+n); fetch("/api/poll"); const r = "/"; const u = `/upload?name=`</script>');
    }
    if (req.url === '/api/poll') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"profiles":[{"thumb":"/profiles/a.jpg?v=1"}],"msg":"a/b"}'); }
    if (req.url === '/app.apk') { res.writeHead(200); return res.end('APK'); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from([1, 2, 3]));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => srv.close(r)));
  return { port: srv.address().port, seen };
}

let n = 0;
async function setup(extra = {}) {
  const eq = await fakeEqrgb();
  const pc = createPc({ dataDir: path.join(tmp, 'd' + n++), allowAnyIp: true, probePorts: [1], cooldownMs: 0, ...extra });
  pc.init();
  const it = await pc.add({ name: 'Desktop', mac: 'AA-BB-CC-DD-EE-FF', ip: '127.0.0.1' });
  pc.setLights(it.id, `http://127.0.0.1:${eq.port}/?t=${TOKEN}`);
  const web = http.createServer((req, res) => { if (!pc.relay(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => web.close(r)));
  const get = (p, opt = {}) => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: web.address().port, path: p, method: opt.method || 'GET', headers: opt.headers }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, text: Buffer.concat(c).toString() }));
    });
    q.on('error', reject);
    q.end(opt.body);
  });
  return { pc, it, eq, get };
}

test('rewriters move root paths under the session prefix and leave the rest alone', () => {
  const P = '/pc/lights/r/x';
  const html = rewriteHtml('<img src="/logo.png"> fetch("/api/poll") `/upload?` "/" "a/b" \'//cdn\' url(/logo.png) "</div>"', P);
  assert.equal(html, `<img src="${P}/logo.png"> fetch("${P}/api/poll") \`${P}/upload?\` "/" "a/b" '//cdn' url(${P}/logo.png) "</div>"`);
  assert.equal(rewriteJson('{"t":"/profiles/a.jpg","m":"/etc/x","p":"/preview/1"}', P), `{"t":"${P}/profiles/a.jpg","m":"/etc/x","p":"${P}/preview/1"}`);
});

test('a session path serves the page with the PC token added server-side, and hides it from the phone', async () => {
  const { pc, it, eq, get } = await setup();
  const base = pc.lightsSession(it.id);
  assert.match(base, /^\/pc\/lights\/r\/[0-9a-f]{32}\/$/);
  const r = await get(base);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(`href="${base.slice(0, -1)}/logo.png"`) && r.text.includes(`url(${base.slice(0, -1)}/logo.png)`));
  assert.ok(r.text.includes(`fetch("${base.slice(0, -1)}/api/"+n)`));
  assert.equal(r.headers['set-cookie'], undefined, 'the PC cannot set cookies on the agent host');
  assert.ok(!r.text.includes(TOKEN) && !JSON.stringify(r.headers).includes(TOKEN));
  assert.equal(eq.seen[0].cookie, `rgbt=${TOKEN}`);
  assert.equal(eq.seen[0].host, `127.0.0.1:${eq.port}`);
});

test('json, images and POST bodies pass through; thumbs are rewritten', async () => {
  const { pc, it, get } = await setup();
  const base = pc.lightsSession(it.id);
  const j = JSON.parse((await get(base + 'api/poll')).text);
  assert.equal(j.profiles[0].thumb, `${base.slice(0, -1)}/profiles/a.jpg?v=1`);
  assert.equal(j.msg, 'a/b');
  const img = await get(base + 'profiles/a.jpg?v=1');
  assert.equal(img.headers['content-type'], 'image/png');
  const post = await get(base + 'api/set_color', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"args":[1,2]}' });
  assert.equal(JSON.parse(post.text).got, '{"args":[1,2]}');
});

test('only the remote\'s own paths are relayed', async () => {
  const { pc, it, get } = await setup();
  const base = pc.lightsSession(it.id);
  assert.equal((await get(base + 'app.apk')).status, 404);
  assert.equal((await get(base + 'etc/passwd')).status, 404);
  assert.equal((await get(base + 'api/set_color')).status, 404, 'GET on an API method');
  assert.equal((await get(base + 'logo.png', { method: 'POST' })).status, 404);
  assert.equal((await get(base + 'x', { method: 'DELETE' })).status, 405);
});

test('unknown, malformed and expired sessions get 404; a short path redirects', async () => {
  const { pc, it, get } = await setup({ lightsTtlMs: 40 });
  assert.equal((await get('/pc/lights/r/' + '0'.repeat(32) + '/')).status, 404);
  assert.equal((await get('/pc/lights/r/short/')).status, 404);
  assert.equal((await get('/pc/lights/r/../../status')).status, 404);
  const base = pc.lightsSession(it.id);
  const bare = await get(base.slice(0, -1));
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.location, base);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await get(base)).status, 404);
});

test('no saved link means no session; removing the PC or its link ends sessions', async () => {
  const { pc, it, get } = await setup();
  const base = pc.lightsSession(it.id);
  pc.setLights(it.id, '');
  assert.equal((await get(base)).status, 404);
  assert.throws(() => pc.lightsSession(it.id), (e) => e.code === 'no_lights');
});

test('a PC that is off gives a 502 instead of hanging', async () => {
  const { pc, it, eq, get } = await setup();
  const base = pc.lightsSession(it.id);
  pc.setLights(it.id, `http://127.0.0.1:1/?t=${TOKEN}`);
  assert.equal((await get(base)).status, 502);
  assert.ok(eq.seen.length === 0);
});

test('session count is capped', async () => {
  const { pc, it } = await setup();
  const first = pc.lightsSession(it.id);
  for (let i = 0; i < 40; i++) pc.lightsSession(it.id);
  assert.notEqual(first, pc.lightsSession(it.id));
});
