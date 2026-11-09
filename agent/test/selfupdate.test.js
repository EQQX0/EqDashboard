'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { createSelfUpdate, cmpVersion } = require('../selfupdate');
const { crc32 } = require('../zip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-su-'));
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Minimal zip writer (deflate) so the test needs no tools.
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nm = Buffer.from(name);
    const crc = crc32(0, data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const goodFiles = (v) => ({
  'agent/server.js': 'module.exports = "new server " + ' + JSON.stringify(v) + ';\n',
  'agent/extra.js': 'module.exports = 1;\n',
  'agent/package.json': JSON.stringify({ name: 's21-agent', version: v }),
  'agent/README-extra.md': '# extra\n',
  'termux/new.sh': 'echo hi\n',
  'agent/.token': 'must not be copied',
  'agent/data/secret.json': '{}',
});

async function fakeGithub(zipBuf, { name = 's21-agent-0.8.0.zip', digest, status = 200 } = {}) {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (req.url.endsWith('/releases/latest')) {
      if (status !== 200) { res.writeHead(status); return res.end('{}'); }
      const base = `http://127.0.0.1:${srv.address().port}`;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        body: 'notes', assets: [
          { name: 'app.apk', browser_download_url: base + '/nope' },
          { name, size: zipBuf.length, browser_download_url: base + '/redirect', digest },
        ],
      }));
    }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/zip' }); return res.end(); }
    if (req.url === '/zip') { res.setHeader('Content-Type', 'application/zip'); return res.end(zipBuf); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => srv.close(r)));
  return { base: `http://127.0.0.1:${srv.address().port}`, hits: () => hits };
}

let n = 0;
function install(version = '0.7.0') {
  const root = path.join(tmp, 'r' + n++);
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent, { recursive: true });
  fs.mkdirSync(path.join(root, 'termux'));
  fs.writeFileSync(path.join(agent, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(agent, 'server.js'), 'module.exports = "old server";\n');
  fs.writeFileSync(path.join(agent, '.token'), 'keep-me');
  return { root, agent };
}
const make = (agent, gh, extra = {}) => {
  const restarts = [];
  const su = createSelfUpdate({ repo: 'owner/name', agentDir: agent, apiBase: gh.base, allowAnyHost: true, restart: () => restarts.push(1), ...extra });
  return { su, restarts };
};
const code = (p) => p.then(() => null, (e) => e.code);

test('version compare', () => {
  assert.equal(cmpVersion('0.7.0', '0.8.0'), -1);
  assert.equal(cmpVersion('0.10.0', '0.9.0'), 1);
  assert.equal(cmpVersion('1.0.0', '1.0.0'), 0);
});

test('check reports an available update', async () => {
  const { agent } = install('0.7.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')));
  const { su } = make(agent, gh);
  const r = await su.check();
  assert.deepEqual([r.current, r.latest, r.available], ['0.7.0', '0.8.0', true]);
});

test('check finds the samsung-agent zip name', async () => {
  const { agent } = install('0.7.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')), { name: 'samsung-agent-0.8.0.zip' });
  const { su } = make(agent, gh);
  const r = await su.check();
  assert.deepEqual([r.latest, r.available], ['0.8.0', true]);
});

test('check says up to date when versions match or the release has no agent zip', async () => {
  const { agent } = install('0.8.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')));
  assert.equal((await make(agent, gh).su.check()).available, false);
  const gh2 = await fakeGithub(makeZip({}), { name: 'other.zip' });
  const r = await make(agent, gh2).su.check();
  assert.deepEqual([r.latest, r.available], [null, false]);
});

test('apply copies allowed files, keeps token and data, backs up, then restarts', async () => {
  const { root, agent } = install('0.7.0');
  const zip = makeZip(goodFiles('0.8.0'));
  const gh = await fakeGithub(zip, { digest: 'sha256:' + crypto.createHash('sha256').update(zip).digest('hex') });
  const { su } = make(agent, gh);
  const r = await su.apply();
  assert.deepEqual([r.updated, r.from, r.to], [true, '0.7.0', '0.8.0']);
  assert.match(fs.readFileSync(path.join(agent, 'server.js'), 'utf8'), /new server/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(agent, 'package.json'), 'utf8')).version, '0.8.0');
  assert.ok(fs.existsSync(path.join(agent, 'extra.js')));
  assert.ok(fs.existsSync(path.join(agent, 'README-extra.md')));
  assert.ok(fs.existsSync(path.join(root, 'termux', 'new.sh')));
  assert.equal(fs.readFileSync(path.join(agent, '.token'), 'utf8'), 'keep-me');
  assert.ok(!fs.existsSync(path.join(agent, 'data')));
  assert.match(fs.readFileSync(path.join(root, 'agent-backup', 'server.js'), 'utf8'), /old server/);
  assert.deepEqual(fs.readdirSync(agent).filter((f) => f.endsWith('.new')), []);
});

test('apply does nothing when already current', async () => {
  const { agent } = install('0.8.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')));
  const r = await make(agent, gh).su.apply();
  assert.equal(r.updated, false);
  assert.match(fs.readFileSync(path.join(agent, 'server.js'), 'utf8'), /old server/);
});

test('a wrong checksum, a broken script or a mismatched version changes nothing', async () => {
  const cases = [
    ['bad_checksum', makeZip(goodFiles('0.8.0')), { digest: 'sha256:' + '0'.repeat(64) }],
    ['bad_archive', makeZip({ ...goodFiles('0.8.0'), 'agent/extra.js': 'this is ( not js' }), {}],
    ['bad_archive', makeZip(goodFiles('0.9.9')), {}], // package.json version differs from the asset name
    ['bad_archive', makeZip({ 'agent/package.json': '{"version":"0.8.0"}' }), {}], // no server.js
    ['bad_archive', Buffer.from('not a zip at all'), {}],
  ];
  for (const [expected, zip, extra] of cases) {
    const { agent } = install('0.7.0');
    const gh = await fakeGithub(zip, extra);
    const { su, restarts } = make(agent, gh);
    assert.equal(await code(su.apply()), expected);
    assert.match(fs.readFileSync(path.join(agent, 'server.js'), 'utf8'), /old server/);
    assert.equal(restarts.length, 0);
  }
});

test('hostile zip paths are refused', async () => {
  const { agent, root } = install('0.7.0');
  const gh = await fakeGithub(makeZip({ ...goodFiles('0.8.0'), '../evil.js': 'x' }));
  assert.equal(await code(make(agent, gh).su.apply()), 'bad_archive');
  assert.ok(!fs.existsSync(path.join(root, 'evil.js')));
});

test('github errors map to codes, and production refuses non-GitHub hosts', async () => {
  const { agent } = install('0.7.0');
  const gh = await fakeGithub(makeZip({}), { status: 403 });
  assert.equal(await code(make(agent, gh).su.check()), 'rate_limited');
  const real = createSelfUpdate({ repo: 'owner/name', agentDir: agent, apiBase: 'http://127.0.0.1:1' });
  assert.equal(await code(real.check()), 'untrusted_host');
  const evil = createSelfUpdate({ repo: 'owner/name', agentDir: agent, apiBase: 'https://evil.example.com' });
  assert.equal(await code(evil.check()), 'untrusted_host');
});

test('no update source configured: nothing is contacted; package.json repository is used', async () => {
  const { agent } = install('0.7.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')));
  const bare = () => createSelfUpdate({ agentDir: agent, apiBase: gh.base, allowAnyHost: true });
  assert.equal(await code(bare().check()), 'not_configured');
  assert.equal(gh.hits(), 0);
  const pkg = path.join(agent, 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), repository: 'someone/their-repo' }));
  assert.equal((await bare().check()).available, true);
  assert.equal(gh.hits(), 1);
});

test('http route: update then restart after the response finishes', async () => {
  const { agent } = install('0.7.0');
  const gh = await fakeGithub(makeZip(goodFiles('0.8.0')));
  const { su, restarts } = make(agent, gh);
  const call = async (key) => {
    let status; let text = '';
    const { EventEmitter } = require('events');
    const res = new EventEmitter();
    res.headersSent = false;
    res.writeHead = (c) => { status = c; };
    res.end = (t) => { text = t; res.headersSent = true; setImmediate(() => res.emit('finish')); };
    const req = new (require('stream').Readable)({ read() {} });
    req.push(null);
    await su.routes[key](req, res);
    await new Promise((r) => setTimeout(r, 20));
    return { status, json: JSON.parse(text) };
  };
  let r = await call('GET /agent/update');
  assert.equal(r.json.available, true);
  assert.equal(restarts.length, 0);
  r = await call('POST /agent/update');
  assert.deepEqual([r.status, r.json.ok, r.json.updated], [200, true, true]);
  assert.equal(restarts.length, 1);
});
