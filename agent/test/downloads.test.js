'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createDownloads, parseSource, chooseEngine, sourceLabel } = require('../downloads');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-dl-'));
const FAKE_YT = path.join(__dirname, '..', 'testlib', 'fake-ytdlp.js');
const SECRET = 'sekret';
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let counter = 0;
const fresh = (name) => path.join(tmp, name + '-' + (counter++));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
}

// ---- fake aria2 JSON-RPC server -------------------------------------------------------------
async function fakeAria(secret = SECRET) {
  const calls = [];
  const dls = new Map();
  let n = 0;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const { method, params, id } = JSON.parse(Buffer.concat(chunks).toString());
      const reply = (result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); };
      const fail = (message) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 1, message } })); };
      if (params[0] !== 'token:' + secret) return fail('Unauthorized');
      const p = params.slice(1);
      calls.push({ method, params: p });
      const by = (...st) => [...dls.values()].filter((d) => st.includes(d.status));
      switch (method) {
        case 'aria2.getVersion': return reply({ version: '1.37.0' });
        case 'aria2.addUri': {
          const gid = (++n).toString(16).padStart(16, '0');
          dls.set(gid, { gid, status: 'waiting', totalLength: '0', completedLength: '0', downloadSpeed: '0', files: [{ path: '', uris: [{ uri: p[0][0] }] }] });
          return reply(gid);
        }
        case 'aria2.tellActive': return reply(by('active'));
        case 'aria2.tellWaiting': return reply(by('waiting', 'paused'));
        case 'aria2.tellStopped': return reply(by('complete', 'error', 'removed'));
        case 'aria2.tellStatus': return dls.has(p[0]) ? reply(dls.get(p[0])) : fail('GID ' + p[0] + ' is not found');
        case 'aria2.forcePause': dls.get(p[0]).status = 'paused'; return reply(p[0]);
        case 'aria2.unpause': dls.get(p[0]).status = 'waiting'; return reply(p[0]);
        case 'aria2.forceRemove': dls.get(p[0]).status = 'removed'; return reply(p[0]);
        case 'aria2.removeDownloadResult': dls.delete(p[0]); return reply('OK');
        default: return fail('unknown method ' + method);
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => srv.close(r)));
  return { url: `http://127.0.0.1:${srv.address().port}/jsonrpc`, calls, dls, srv };
}

function make(extra = {}) {
  const root = fresh('root');
  const dl = createDownloads({
    filesRoot: path.join(root, 'files'), dataDir: path.join(root, 'data'), minFree: 0,
    spawnAria2: false, aria2Secret: SECRET, ytdlpCmd: [process.execPath, FAKE_YT], ...extra,
  });
  dl.init();
  cleanups.push(async () => dl.stop());
  return { dl, root };
}

// ---- sources ------------------------------------------------------------------------------------

test('parseSource accepts http, https, ftp and magnet links', () => {
  assert.strictEqual(parseSource('https://example.com/a.zip').kind, 'http');
  assert.strictEqual(parseSource('  ftp://ftp.example.com/x.iso ').url, 'ftp://ftp.example.com/x.iso');
  assert.strictEqual(parseSource('magnet:?xt=urn:btih:abcdef0123456789&dn=Thing').kind, 'magnet');
  assert.strictEqual(parseSource('http://192.168.1.5/file.bin').kind, 'http', 'LAN hosts are allowed');
});

test('parseSource rejects other schemes, junk, and magnets without a hash', () => {
  for (const bad of ['', '   ', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'not a url', 'magnet:?dn=x', 'http://', 'x'.repeat(5000), 12, null, undefined]) {
    assert.throws(() => parseSource(bad), (e) => e.code === 'bad_url', String(bad).slice(0, 30));
  }
});

test('parseSource blocks loopback and link-local targets unless allowed', () => {
  for (const h of ['http://localhost/x', 'http://127.0.0.1:8787/status', 'http://0.0.0.0/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://a.localhost/']) {
    assert.throws(() => parseSource(h), (e) => e.code === 'blocked_url', h);
  }
  assert.strictEqual(parseSource('http://localhost/x', true).kind, 'http');
});

test('chooseEngine routes by link type and mode', () => {
  const s = (u) => parseSource(u);
  assert.strictEqual(chooseEngine(s('magnet:?xt=urn:btih:abc'), 'video'), 'aria2');
  assert.strictEqual(chooseEngine(s('https://x.com/f.torrent'), 'auto'), 'aria2');
  assert.strictEqual(chooseEngine(s('https://x.com/f.zip'), 'auto'), 'aria2');
  assert.strictEqual(chooseEngine(s('https://x.com/video.MP4'), 'auto'), 'aria2');
  assert.strictEqual(chooseEngine(s('https://youtube.com/watch?v=abc'), 'auto'), 'ytdlp');
  assert.strictEqual(chooseEngine(s('https://x.com/f.zip'), 'video'), 'ytdlp');
  assert.strictEqual(chooseEngine(s('https://x.com/f.zip'), 'audio'), 'ytdlp');
  assert.strictEqual(chooseEngine(s('https://youtube.com/watch?v=abc'), 'direct'), 'aria2');
});

test('sourceLabel hides credentials and query strings', () => {
  assert.strictEqual(sourceLabel('https://user:pw@host.com/a/b.zip?token=SECRET'), 'host.com/a/b.zip');
  assert.strictEqual(sourceLabel('magnet:?xt=urn:btih:abc&dn=My+Movie&tr=http%3A%2F%2Ft'), 'My Movie');
  assert.strictEqual(sourceLabel('magnet:?xt=urn:btih:abc'), 'Magnet link');
});

// ---- aria2 -----------------------------------------------------------------------------------------

test('aria2: add sends the link to the daemon and list reports progress, eta and paths', async () => {
  const a = await fakeAria();
  const { dl, root } = make({ aria2Url: a.url });
  const item = await dl.add({ url: 'https://cdn.example.com/big.zip?sig=ABC' });
  assert.strictEqual(item.engine, 'aria2');
  assert.strictEqual(item.status, 'queued');
  assert.strictEqual(item.name, 'big.zip');
  const call = a.calls.find((c) => c.method === 'aria2.addUri');
  assert.deepStrictEqual(call.params[0], ['https://cdn.example.com/big.zip?sig=ABC']);
  assert.strictEqual(call.params[1].dir, dl.DL_DIR);

  const d = a.dls.get(item.id);
  d.status = 'active'; d.totalLength = '1000'; d.completedLength = '250'; d.downloadSpeed = '50';
  d.files = [{ path: path.join(dl.DL_DIR, 'big.zip'), uris: [] }];
  let l = await dl.list();
  assert.strictEqual(l.engines.aria2, true);
  const it = l.items.find((x) => x.id === item.id);
  assert.deepStrictEqual([it.status, it.totalBytes, it.doneBytes, it.speedBps, it.etaSec, it.path], ['active', 1000, 250, 50, 15, null]);
  assert.strictEqual(it.source, 'cdn.example.com/big.zip', 'query string with the signature is not echoed');

  d.status = 'complete'; d.completedLength = '1000'; d.downloadSpeed = '0';
  l = await dl.list();
  const done = l.items.find((x) => x.id === item.id);
  assert.deepStrictEqual([done.status, done.path, done.etaSec], ['complete', 'downloads/big.zip', null]);
  assert.ok(root);
});

test('aria2: errors show the message; metadata gids that were followed are hidden', async () => {
  const a = await fakeAria();
  const { dl } = make({ aria2Url: a.url });
  const m = await dl.add({ url: 'magnet:?xt=urn:btih:abc123&dn=Ubuntu' });
  const meta = a.dls.get(m.id);
  const follow = '00000000000000ff';
  meta.status = 'complete';
  meta.followedBy = [follow];
  a.dls.set(follow, {
    gid: follow, status: 'active', totalLength: '2000', completedLength: '500', downloadSpeed: '100',
    bittorrent: { info: { name: 'Ubuntu ISO' } }, files: [{ path: path.join(dl.DL_DIR, 'Ubuntu ISO', 'a.iso') }, { path: path.join(dl.DL_DIR, 'Ubuntu ISO', 'b.iso') }],
  });
  const bad = await dl.add({ url: 'https://x.com/missing.zip' });
  Object.assign(a.dls.get(bad.id), { status: 'error', errorMessage: 'File not found' });
  const l = await dl.list();
  assert.strictEqual(l.items.some((x) => x.id === m.id), false, 'metadata download is not listed');
  const t = l.items.find((x) => x.id === follow);
  assert.deepStrictEqual([t.name, t.status], ['Ubuntu ISO', 'active']);
  assert.strictEqual(l.items.find((x) => x.id === bad.id).error, 'File not found');
});

test('aria2: pause, resume and remove call the daemon; unfinished partial files are deleted, finished ones kept', async () => {
  const a = await fakeAria();
  const { dl } = make({ aria2Url: a.url });
  const one = await dl.add({ url: 'https://x.com/one.zip' });
  await dl.pause(one.id);
  assert.strictEqual(a.dls.get(one.id).status, 'paused');
  await dl.resume(one.id);
  assert.strictEqual(a.dls.get(one.id).status, 'waiting');

  const partial = path.join(dl.DL_DIR, 'one.zip');
  fs.writeFileSync(partial, 'half');
  fs.writeFileSync(partial + '.aria2', 'ctl');
  const outside = path.join(path.dirname(dl.DL_DIR), 'keep.txt');
  fs.writeFileSync(outside, 'mine');
  a.dls.get(one.id).files = [{ path: partial }, { path: outside }];
  await dl.remove(one.id);
  assert.ok(a.calls.some((c) => c.method === 'aria2.forceRemove'));
  assert.strictEqual(fs.existsSync(partial), false);
  assert.strictEqual(fs.existsSync(partial + '.aria2'), false);
  assert.strictEqual(fs.existsSync(outside), true, 'files outside the downloads folder are never touched');

  const two = await dl.add({ url: 'https://x.com/two.zip' });
  const finished = path.join(dl.DL_DIR, 'two.zip');
  fs.writeFileSync(finished, 'complete file');
  Object.assign(a.dls.get(two.id), { status: 'complete', files: [{ path: finished }] });
  await dl.remove(two.id);
  assert.strictEqual(fs.existsSync(finished), true, 'removing a finished download keeps the file');
  assert.strictEqual((await dl.list()).items.length, 0);
});

test('aria2: bad ids, unknown gids and a missing daemon', async () => {
  const a = await fakeAria();
  const { dl } = make({ aria2Url: a.url });
  await assert.rejects(dl.pause('../etc'), (e) => e.code === 'bad_id');
  await assert.rejects(dl.remove('0123456789abcdef'), (e) => e.code === 'not_found');
  const dead = make({ aria2Url: 'http://127.0.0.1:1/jsonrpc' });
  await assert.rejects(dead.dl.add({ url: 'https://x.com/a.zip' }), (e) => e.code === 'engine_missing' && e.extra.engine === 'aria2');
  assert.strictEqual((await dead.dl.list()).engines.aria2, false);
});

test('aria2: the daemon must see the secret', async () => {
  const a = await fakeAria('other-secret');
  const { dl } = make({ aria2Url: a.url }); // uses SECRET, which the fake rejects
  await assert.rejects(dl.add({ url: 'https://x.com/a.zip' }), (e) => e.code === 'engine_missing');
});

test('add validates input and free space', async () => {
  const a = await fakeAria();
  const { dl } = make({ aria2Url: a.url });
  await assert.rejects(dl.add({ url: 'file:///x' }), (e) => e.code === 'bad_url');
  await assert.rejects(dl.add({ url: 'http://127.0.0.1/x.zip' }), (e) => e.code === 'blocked_url');
  await assert.rejects(dl.add({ url: 'https://x.com/a.zip', mode: 'bogus' }), (e) => e.code === 'bad_mode');
  const full = make({ aria2Url: a.url, minFree: Number.MAX_SAFE_INTEGER });
  await assert.rejects(full.dl.add({ url: 'https://x.com/a.zip' }), (e) => e.status === 507 && e.code === 'low_space');
});

// ---- yt-dlp ---------------------------------------------------------------------------------------------

test('yt-dlp: a video page downloads, reports progress and ends with the file in downloads', async () => {
  const log = path.join(fresh('ytlog'));
  process.env.FAKE_YT_LOG = log;
  const { dl } = make();
  const item = await dl.add({ url: 'https://video.example.com/watch?v=1' });
  assert.strictEqual(item.engine, 'ytdlp');
  const done = await until(async () => (await dl.list()).items.find((x) => x.id === item.id && x.status === 'complete'));
  assert.deepStrictEqual([done.name, done.path, done.totalBytes, done.doneBytes], ['Fake Title [abc].mp4', 'downloads/Fake Title [abc].mp4', 1000, 1000]);
  assert.strictEqual(fs.readFileSync(path.join(dl.DL_DIR, 'Fake Title [abc].mp4'), 'utf8').length, 1000);
  assert.strictEqual(fs.existsSync(path.join(dl.DL_DIR, '.partial', item.id)), false, 'temp files are cleaned up');
  const args = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
  assert.ok(args.includes('--no-playlist') && args.includes('--merge-output-format'));
  assert.strictEqual(args[args.length - 2], '--');
  assert.strictEqual(args[args.length - 1], 'https://video.example.com/watch?v=1');
  delete process.env.FAKE_YT_LOG;
});

test('yt-dlp: finished files never overwrite or delete existing ones', async () => {
  const { dl } = make();
  fs.mkdirSync(dl.DL_DIR, { recursive: true });
  fs.writeFileSync(path.join(dl.DL_DIR, 'Fake Title [abc].mp4'), 'precious original');
  const one = await dl.add({ url: 'https://v.example.com/watch?v=1' });
  const two = await dl.add({ url: 'https://v.example.com/watch?v=1' });
  const fin = async (id) => until(async () => (await dl.list()).items.find((x) => x.id === id && x.status === 'complete'));
  const [a, b] = [await fin(one.id), await fin(two.id)];
  assert.deepStrictEqual([a.name, b.name].sort(), ['Fake Title [abc] (1).mp4', 'Fake Title [abc] (2).mp4']);
  assert.strictEqual(fs.readFileSync(path.join(dl.DL_DIR, 'Fake Title [abc].mp4'), 'utf8'), 'precious original');
});

test('yt-dlp: audio mode extracts mp3', async () => {
  const { dl } = make();
  const item = await dl.add({ url: 'https://video.example.com/watch?v=2', mode: 'audio' });
  const done = await until(async () => (await dl.list()).items.find((x) => x.id === item.id && x.status === 'complete'));
  assert.strictEqual(done.path, 'downloads/Fake Title [abc].mp3');
});

test('yt-dlp: a failing download shows yt-dlp\'s message and can be retried', async () => {
  const { dl } = make();
  const item = await dl.add({ url: 'https://video.example.com/fail' });
  const bad = await until(async () => (await dl.list()).items.find((x) => x.id === item.id && x.status === 'error'));
  assert.match(bad.error, /Unsupported URL/);
  assert.ok(!bad.error.startsWith('ERROR'), 'the ERROR: prefix is stripped');
  await dl.resume(item.id);
  const again = (await dl.list()).items.find((x) => x.id === item.id);
  assert.ok(['queued', 'active', 'error'].includes(again.status));
});

test('yt-dlp: pause stops the process, resume restarts it, remove deletes partial files; only two run at once', async () => {
  const { dl } = make({ maxYtdlp: 2 });
  const a = await dl.add({ url: 'https://v.example.com/slow1' });
  const b = await dl.add({ url: 'https://v.example.com/slow2' });
  const c = await dl.add({ url: 'https://v.example.com/slow3' });
  const st = async () => Object.fromEntries((await dl.list()).items.map((x) => [x.id, x]));
  await until(async () => { const s = await st(); return s[a.id].doneBytes === 250 && s[b.id].doneBytes === 250; });
  let s = await st();
  assert.deepStrictEqual([s[a.id].status, s[b.id].status, s[c.id].status], ['active', 'active', 'queued']);
  assert.strictEqual(s[a.id].name, 'Fake Title');

  await dl.pause(a.id);
  await until(async () => (await st())[c.id].status === 'active'); // the freed slot goes to the queued one
  s = await st();
  assert.strictEqual(s[a.id].status, 'paused');
  assert.strictEqual(fs.existsSync(path.join(dl.DL_DIR, '.partial', a.id, 'tmp', 'video.part')), true, 'a paused download keeps its partial file');

  await dl.resume(a.id);
  assert.strictEqual((await st())[a.id].status, 'queued', 'both slots are busy, so it waits its turn');
  await dl.remove(b.id);
  await until(async () => (await st())[a.id].status === 'active');
  await dl.remove(a.id);
  assert.strictEqual(fs.existsSync(path.join(dl.DL_DIR, '.partial', a.id)), false);
  assert.strictEqual((await st())[a.id], undefined);
  dl.stop();
});

test('yt-dlp: a missing binary gives engine_missing', async () => {
  const { dl } = make({ ytdlpCmd: [path.join(tmp, 'no-such-binary')] });
  await assert.rejects(dl.add({ url: 'https://video.example.com/watch?v=1' }), (e) => e.code === 'engine_missing' && e.extra.engine === 'ytdlp');
});

test('restart: unfinished yt-dlp jobs come back paused, aria2 links are remembered', async () => {
  const a = await fakeAria();
  const root = fresh('persist');
  const opts = { filesRoot: path.join(root, 'files'), dataDir: path.join(root, 'data'), minFree: 0, spawnAria2: false, aria2Secret: SECRET, aria2Url: a.url, ytdlpCmd: [process.execPath, FAKE_YT] };
  const one = createDownloads(opts);
  one.init();
  const y = await one.add({ url: 'https://v.example.com/slow1' });
  const r = await one.add({ url: 'https://x.com/file.zip' });
  await until(async () => (await one.list()).items.find((x) => x.id === y.id).doneBytes === 250);
  one.stop();
  const two = createDownloads(opts);
  two.init();
  const l = await two.list();
  assert.strictEqual(l.items.find((x) => x.id === y.id).status, 'paused');
  assert.strictEqual(l.items.find((x) => x.id === r.id).source, 'x.com/file.zip');
  await two.resume(y.id);
  await until(async () => (await two.list()).items.find((x) => x.id === y.id).status === 'active');
  two.stop();
});

// ---- through the real server -----------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

test('HTTP routes need the token and drive the downloads module', async () => {
  const a = await fakeAria();
  const TOKEN = 'dl-' + Math.random().toString(16).slice(2);
  const root = fresh('srv');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN, FILES_ROOT: path.join(root, 'files'),
      DATA_DIR: path.join(root, 'data'), TOKEN_FILE: path.join(root, 'token'), SITES_PORT: String(await freePort()),
      ARIA2_RPC_URL: a.url, ARIA2_RPC_SECRET: SECRET, DL_MIN_FREE_BYTES: '0', TUNNEL_CONFIG: path.join(root, 'none.yml'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  cleanups.push(() => new Promise((r) => { child.removeAllListeners('exit'); child.once('exit', r); child.kill(); }));
  await new Promise((resolve, reject) => {
    let out = '';
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    child.stdout.on('data', (d) => { out += String(d); if (out.includes('agent listening')) resolve(); });
  });
  const call = (method, p, body, token = TOKEN) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(s) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });

  assert.strictEqual((await call('GET', '/downloads/list', undefined, null)).status, 401);
  assert.strictEqual((await call('POST', '/downloads/add', { url: 'file:///etc/passwd' })).json.error, 'bad_url');
  assert.strictEqual((await call('POST', '/downloads/add', { url: 'http://localhost:8787/' })).status, 400);
  const added = await call('POST', '/downloads/add', { url: 'magnet:?xt=urn:btih:abc123&dn=Linux' });
  assert.strictEqual(added.status, 200);
  assert.strictEqual(added.json.item.name, 'Linux');
  const l = await call('GET', '/downloads/list');
  assert.strictEqual(l.json.engines.aria2, true);
  assert.deepStrictEqual(l.json.items.map((x) => x.id), [added.json.item.id]);
  assert.strictEqual((await call('POST', '/downloads/pause', { id: added.json.item.id })).status, 200);
  assert.strictEqual((await call('POST', '/downloads/pause', { id: 'nope' })).json.error, 'bad_id');
  assert.strictEqual((await call('DELETE', '/downloads?id=' + added.json.item.id)).status, 200);
  assert.strictEqual((await call('GET', '/downloads/list')).json.items.length, 0);
});
