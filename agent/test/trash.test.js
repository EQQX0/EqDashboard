'use strict';
// Recycle bin: list, restore, delete forever, empty, purge.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { purgeTrash, createRoutes, sweepOrphanMeta, moveEntry } = require('../files');

const TOKEN = 'trash-token-' + Math.random().toString(16).slice(2);
const SERVER = path.join(__dirname, '..', 'server.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-trash-'));
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function boot(name) {
  const port = await freePort();
  const filesRoot = path.join(tmp, name);
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN, FILES_ROOT: filesRoot, TOKEN_FILE: path.join(tmp, name + '.token'), TRASH_DAYS: '30' },
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

function req(port, method, p, { body, token = TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const h = {};
    if (token) h.Authorization = 'Bearer ' + token;
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

const write = (root, rel, data) => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

test('trash API', async (t) => {
  const { port, filesRoot } = await boot('bin');
  const del = (p) => req(port, 'DELETE', '/files?path=' + encodeURIComponent(p));
  const list = async () => (await req(port, 'GET', '/files/trash')).json;
  const entries = () => fs.readdirSync(path.join(filesRoot, '.trash')).filter((n) => !n.startsWith('.'));

  await t.test('requires auth', async () => {
    assert.strictEqual((await req(port, 'GET', '/files/trash', { token: null })).status, 401);
    assert.strictEqual((await req(port, 'POST', '/files/trash/empty', { token: null })).status, 401);
  });

  await t.test('empty bin lists nothing', async () => {
    assert.deepStrictEqual(await list(), { days: 30, items: [] });
  });

  await t.test('list after delete, newest first, with original path', async () => {
    write(filesRoot, 'docs/a.txt', 'hello');
    write(filesRoot, 'pics/x/y.txt', '12345');
    const t0 = Date.now();
    assert.strictEqual((await del('docs/a.txt')).status, 200);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual((await del('pics')).status, 200);
    const j = await list();
    assert.strictEqual(j.days, 30);
    assert.strictEqual(j.items.length, 2);
    const [dir, file] = j.items;
    assert.strictEqual(dir.name, 'pics');
    assert.strictEqual(dir.isDir, true);
    assert.strictEqual(dir.size, 5);
    assert.strictEqual(dir.originalPath, 'pics');
    assert.strictEqual(file.name, 'a.txt');
    assert.strictEqual(file.isDir, false);
    assert.strictEqual(file.size, 5);
    assert.strictEqual(file.originalPath, 'docs/a.txt');
    assert.ok(file.deletedAt >= t0 && dir.deletedAt >= file.deletedAt);
    assert.strictEqual(file.expiresAt, file.deletedAt + 30 * 86400000);
    assert.match(file.id, /^\d{13}-a\.txt$/);
    // the bin is still hidden from the normal listing and paths
    assert.strictEqual((await req(port, 'GET', '/files/list?path=.trash')).json.error, 'bad_path');
  });

  await t.test('restore to original, including a folder', async () => {
    const [dir, file] = (await list()).items;
    let r = await req(port, 'POST', '/files/trash/restore', { body: { id: file.id } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true, path: 'docs/a.txt' });
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'docs', 'a.txt'), 'utf8'), 'hello');
    r = await req(port, 'POST', '/files/trash/restore', { body: { id: dir.id } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'pics', 'x', 'y.txt'), 'utf8'), '12345');
    assert.deepStrictEqual((await list()).items, []);
    assert.deepStrictEqual(fs.readdirSync(path.join(filesRoot, '.trash', '.meta')), []);
    assert.strictEqual((await req(port, 'POST', '/files/trash/restore', { body: { id: file.id } })).json.error, 'not_found');
  });

  await t.test('restore conflict returns exists, overwrite replaces', async () => {
    write(filesRoot, 'docs/c.txt', 'old');
    await del('docs/c.txt');
    write(filesRoot, 'docs/c.txt', 'new');
    const { id } = (await list()).items[0];
    let r = await req(port, 'POST', '/files/trash/restore', { body: { id } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'exists');
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'docs', 'c.txt'), 'utf8'), 'new');
    assert.strictEqual((await list()).items.length, 1);
    r = await req(port, 'POST', '/files/trash/restore', { body: { id, overwrite: true } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'docs', 'c.txt'), 'utf8'), 'old');
    assert.strictEqual((await list()).items.length, 1); // the replaced 'new' copy is now in the bin
  });

  await t.test('restore recreates a missing parent', async () => {
    write(filesRoot, 'deep/er/f.txt', 'f');
    await del('deep/er/f.txt');
    fs.rmSync(path.join(filesRoot, 'deep'), { recursive: true });
    const { id } = (await list()).items[0];
    const r = await req(port, 'POST', '/files/trash/restore', { body: { id } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'deep', 'er', 'f.txt'), 'utf8'), 'f');
  });

  await t.test('old entries without metadata list and restore to Restored/', async () => {
    const id = '1700000000000-legacy.txt';
    write(path.join(filesRoot, '.trash'), id, 'legacy');
    const item = (await list()).items.find((i) => i.id === id);
    assert.strictEqual(item.name, 'legacy.txt');
    assert.strictEqual(item.deletedAt, 1700000000000);
    assert.strictEqual('originalPath' in item, false);
    const r = await req(port, 'POST', '/files/trash/restore', { body: { id } });
    assert.deepStrictEqual(r.json, { ok: true, path: 'Restored/legacy.txt' });
    assert.strictEqual(fs.readFileSync(path.join(filesRoot, 'Restored', 'legacy.txt'), 'utf8'), 'legacy');
  });

  await t.test('ids with separators or traversal are rejected', async () => {
    write(filesRoot, 'victim.txt', 'keep');
    for (const id of ['..', '.', '../victim.txt', '..\\victim.txt', 'a/b', 'a\\b', '.meta', '.staging-x', '', '/etc/passwd', 'C:\\x', '1-..', 'x\0y', 5, null, undefined]) {
      for (const route of ['restore', 'delete']) {
        const r = await req(port, 'POST', '/files/trash/' + route, { body: { id } });
        assert.strictEqual(r.status, 400, `${route} ${JSON.stringify(id)}`);
        assert.strictEqual(r.json.error, 'bad_path');
      }
    }
    assert.ok(fs.existsSync(path.join(filesRoot, 'victim.txt')));
    assert.strictEqual((await req(port, 'POST', '/files/trash/delete', { body: { id: '123-nope' } })).status, 404);
  });

  await t.test('a tampered sidecar cannot escape the root', async () => {
    write(filesRoot, 'tamper.txt', 'x');
    await del('tamper.txt');
    const { id } = (await list()).items[0];
    const mp = path.join(filesRoot, '.trash', '.meta', id + '.json');
    fs.writeFileSync(mp, JSON.stringify({ originalPath: '../../escape.txt', name: 'tamper.txt', deletedAt: Date.now() }));
    let r = await req(port, 'POST', '/files/trash/restore', { body: { id } });
    assert.strictEqual(r.json.path, 'Restored/tamper.txt');
    fs.rmSync(path.join(filesRoot, 'Restored', 'tamper.txt'));
    write(filesRoot, 'tamper2.txt', 'x');
    await del('tamper2.txt');
    const id2 = (await list()).items[0].id;
    fs.writeFileSync(path.join(filesRoot, '.trash', '.meta', id2 + '.json'), JSON.stringify({ originalPath: '.trash/boom', name: 'tamper2.txt', deletedAt: Date.now() }));
    r = await req(port, 'POST', '/files/trash/restore', { body: { id: id2 } });
    assert.strictEqual(r.json.path, 'Restored/tamper2.txt');
    assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')));
  });

  await t.test('delete one forever removes entry and sidecar', async () => {
    write(filesRoot, 'gone.txt', 'g');
    await del('gone.txt');
    const { id } = (await list()).items.find((i) => i.name === 'gone.txt');
    const r = await req(port, 'POST', '/files/trash/delete', { body: { id } });
    assert.deepStrictEqual(r.json, { ok: true });
    assert.ok(!fs.existsSync(path.join(filesRoot, '.trash', id)));
    assert.ok(!fs.existsSync(path.join(filesRoot, '.trash', '.meta', id + '.json')));
  });

  await t.test('empty removes everything but leaves in-flight staging folders', async () => {
    write(filesRoot, 'e1.txt', '1');
    write(filesRoot, 'e2/inner.txt', '2');
    await del('e1.txt');
    await del('e2');
    fs.mkdirSync(path.join(filesRoot, '.trash', '.staging-live'));
    assert.ok(entries().length >= 2);
    const r = await req(port, 'POST', '/files/trash/empty');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.ok(r.json.removed >= 2);
    assert.deepStrictEqual(entries(), []);
    assert.deepStrictEqual(fs.readdirSync(path.join(filesRoot, '.trash', '.meta')), []);
    assert.ok(fs.existsSync(path.join(filesRoot, '.trash', '.staging-live')));
    assert.deepStrictEqual((await list()).items, []);
  });
});

test('purgeTrash removes expired entries with their sidecars and never treats .meta as an entry', async () => {
  const root = path.join(tmp, 'purge');
  const trash = path.join(root, '.trash');
  const meta = path.join(trash, '.meta');
  fs.mkdirSync(meta, { recursive: true });
  const day = 86400000;
  const now = Date.now();
  const old = `${now - 31 * day}-old.txt`;
  const fresh = `${now - 1 * day}-fresh.txt`;
  for (const id of [old, fresh]) {
    fs.writeFileSync(path.join(trash, id), 'x');
    fs.writeFileSync(path.join(meta, id + '.json'), JSON.stringify({ originalPath: 'x', name: id, deletedAt: now }));
  }
  const orphan = path.join(meta, `${now - 40 * day}-orphan.txt.json`);
  fs.writeFileSync(orphan, '{}');
  fs.utimesSync(orphan, new Date(now - 40 * day), new Date(now - 40 * day));
  // sidecar folder is old by mtime: must still survive
  fs.utimesSync(meta, new Date(now - 90 * day), new Date(now - 90 * day));
  const n = await purgeTrash(root, 30 * day, now);
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(fs.readdirSync(trash).sort(), ['.meta', fresh].sort());
  assert.deepStrictEqual(fs.readdirSync(meta), [fresh + '.json']);
});

// In-process server so tests can inject the rename function.
async function inproc(name, renameFn) {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  const routes = createRoutes({ root, maxUploadBytes: 1 << 20, renameFn });
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://x');
    const h = routes[`${rq.method} ${url.pathname}`];
    if (!h) { rs.statusCode = 404; rs.end('{}'); return; }
    h(rq, rs, url);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  return { root, port: server.address().port };
}

const realRename = (a, b) => fs.promises.rename(a, b);

test('restore hardening', async (t) => {
  await t.test('a second restore of the same id while one is running gets busy', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let hit;
    const entered = new Promise((r) => { hit = r; });
    let armed = false;
    const { root, port } = await inproc('busy', async (a, b) => {
      if (armed) { hit(); await gate; }
      return realRename(a, b);
    });
    write(root, 'f.txt', 'one');
    await req(port, 'DELETE', '/files?path=f.txt');
    const { id } = (await req(port, 'GET', '/files/trash')).json.items[0];
    armed = true;
    const first = req(port, 'POST', '/files/trash/restore', { body: { id } });
    await entered;
    const second = await req(port, 'POST', '/files/trash/restore', { body: { id } });
    assert.strictEqual(second.status, 409);
    assert.strictEqual(second.json.error, 'busy');
    release();
    assert.strictEqual((await first).status, 200);
    assert.strictEqual(fs.readFileSync(path.join(root, 'f.txt'), 'utf8'), 'one');
  });

  await t.test('id is released after a failed restore', async () => {
    let fail = false;
    const { root, port } = await inproc('release', async (a, b) => {
      if (fail && path.basename(b) === 'g.txt') throw Object.assign(new Error('boom'), { code: 'EIO' });
      return realRename(a, b);
    });
    write(root, 'g.txt', 'g');
    await req(port, 'DELETE', '/files?path=g.txt');
    const { id } = (await req(port, 'GET', '/files/trash')).json.items[0];
    fail = true;
    assert.strictEqual((await req(port, 'POST', '/files/trash/restore', { body: { id } })).status, 500);
    fail = false;
    assert.strictEqual((await req(port, 'POST', '/files/trash/restore', { body: { id } })).status, 200);
  });

  await t.test('overwrite moves the old target into the trash and it is recoverable', async () => {
    const { root, port } = await inproc('ow', undefined);
    write(root, 'c.txt', 'old');
    await req(port, 'DELETE', '/files?path=c.txt');
    write(root, 'c.txt', 'new');
    const first = (await req(port, 'GET', '/files/trash')).json.items[0];
    const r = await req(port, 'POST', '/files/trash/restore', { body: { id: first.id, overwrite: true } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'old');
    const items = (await req(port, 'GET', '/files/trash')).json.items;
    assert.strictEqual(items.length, 1);
    assert.notStrictEqual(items[0].id, first.id);
    assert.strictEqual(items[0].originalPath, 'c.txt');
    assert.strictEqual(fs.readFileSync(path.join(root, '.trash', items[0].id), 'utf8'), 'new');
    // recover the replaced version
    assert.strictEqual((await req(port, 'POST', '/files/trash/restore', { body: { id: items[0].id, overwrite: true } })).status, 200);
    assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'new');
  });

  await t.test('failed rename puts the old target back', async () => {
    let armed = 0;
    const { root, port } = await inproc('rollback', async (a, b) => {
      // fail only the restore itself (trash entry into r.txt), once
      if (armed === 1 && path.basename(b) === 'r.txt' && a.includes('.trash')) {
        armed = 2;
        throw Object.assign(new Error('boom'), { code: 'EIO' });
      }
      return realRename(a, b);
    });
    write(root, 'r.txt', 'old');
    await req(port, 'DELETE', '/files?path=r.txt');
    write(root, 'r.txt', 'new');
    const { id } = (await req(port, 'GET', '/files/trash')).json.items[0];
    armed = 1;
    const r = await req(port, 'POST', '/files/trash/restore', { body: { id, overwrite: true } });
    assert.strictEqual(r.status, 500);
    assert.strictEqual(armed, 2);
    assert.strictEqual(fs.readFileSync(path.join(root, 'r.txt'), 'utf8'), 'new');
    assert.strictEqual(fs.readFileSync(path.join(root, '.trash', id), 'utf8'), 'old');
    assert.strictEqual((await req(port, 'GET', '/files/trash')).json.items.length, 1);
  });

  await t.test('file/folder mismatch needs replaceType', async () => {
    const { root, port } = await inproc('type', undefined);
    write(root, 'm/inner.txt', 'in');
    await req(port, 'DELETE', '/files?path=m');
    write(root, 'm', 'now a file');
    const { id } = (await req(port, 'GET', '/files/trash')).json.items[0];
    let r = await req(port, 'POST', '/files/trash/restore', { body: { id, overwrite: true } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'exists');
    assert.strictEqual(fs.readFileSync(path.join(root, 'm'), 'utf8'), 'now a file');
    r = await req(port, 'POST', '/files/trash/restore', { body: { id, overwrite: true, replaceType: true } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(root, 'm', 'inner.txt'), 'utf8'), 'in');
    const kept = (await req(port, 'GET', '/files/trash')).json.items[0];
    assert.strictEqual(fs.readFileSync(path.join(root, '.trash', kept.id), 'utf8'), 'now a file');
  });
});

test('sidecars younger than 60 seconds survive the sweep', async () => {
  const trash = path.join(tmp, 'age', '.trash');
  const meta = path.join(trash, '.meta');
  fs.mkdirSync(meta, { recursive: true });
  const young = path.join(meta, '1700000000001-young.txt.json');
  const stale = path.join(meta, '1700000000002-stale.txt.json');
  const now = Date.now();
  fs.writeFileSync(young, '{}');
  fs.writeFileSync(stale, '{}');
  fs.utimesSync(young, new Date(now - 30000), new Date(now - 30000));
  fs.utimesSync(stale, new Date(now - 120000), new Date(now - 120000));
  await sweepOrphanMeta(trash, now);
  assert.ok(fs.existsSync(young));
  assert.ok(!fs.existsSync(stale));
  await sweepOrphanMeta(trash, now + 61000);
  assert.ok(!fs.existsSync(young));
});

test('moveEntry falls back to copy and remove on EXDEV', async () => {
  const dir = path.join(tmp, 'exdev');
  fs.mkdirSync(path.join(dir, 'src', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'sub', 'a.txt'), 'a');
  const exdev = async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };
  await moveEntry(path.join(dir, 'src'), path.join(dir, 'dst'), exdev);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'dst', 'sub', 'a.txt'), 'utf8'), 'a');
  assert.ok(!fs.existsSync(path.join(dir, 'src')));
  // other errors pass through untouched
  const eio = async () => { throw Object.assign(new Error('x'), { code: 'EIO' }); };
  fs.writeFileSync(path.join(dir, 'f.txt'), 'f');
  await assert.rejects(moveEntry(path.join(dir, 'f.txt'), path.join(dir, 'g.txt'), eio), { code: 'EIO' });
  assert.ok(fs.existsSync(path.join(dir, 'f.txt')));
});

test('moveEntry rethrows a failed copy and leaves no destination behind', async () => {
  const dir = path.join(tmp, 'exdev2');
  fs.mkdirSync(dir, { recursive: true });
  const exdev = async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };
  await assert.rejects(moveEntry(path.join(dir, 'missing'), path.join(dir, 'out'), exdev));
  assert.ok(!fs.existsSync(path.join(dir, 'out')));
});
