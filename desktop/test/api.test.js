'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi, normalizeBase, allowedPath, parsePair, httpErrorMessage } = require('../api');

test('httpErrorMessage maps 413 to a clear message', () => {
  assert.strictEqual(httpErrorMessage(413, ''), 'File too large for the tunnel (100 MB max)');
});

test('normalizeBase requires https and trims slashes', () => {
  assert.strictEqual(normalizeBase(' https://api.example.com/ '), 'https://api.example.com');
  assert.throws(() => normalizeBase('http://api.example.com'));
  assert.throws(() => normalizeBase(''));
});

test('allowedPath accepts known routes and rejects traversal', () => {
  assert.ok(allowedPath('status'));
  assert.ok(allowedPath('files/list'));
  assert.ok(allowedPath('vps'));
  for (const p of ['files/trash', 'files/trash/restore', 'files/trash/delete', 'files/trash/empty']) assert.ok(allowedPath(p), p);
  assert.ok(!allowedPath('files/trash/other'));
  assert.ok(!allowedPath('files/trash/../x'));
  assert.ok(allowedPath('agent/update'));
  assert.ok(allowedPath('tunnel/routes'));
  assert.ok(!allowedPath('agent/restart'));
  assert.ok(!allowedPath('files/../x'));
  assert.ok(!allowedPath(undefined));
});

test('parsePair reads a pairing file and rejects bad ones', () => {
  const tok = 'a'.repeat(64);
  assert.deepStrictEqual(parsePair(JSON.stringify({ v: 1, url: 'https://api.example.com/', token: tok }) + ' '), { url: 'https://api.example.com', token: tok });
  assert.throws(() => parsePair('nope'), /not a pairing file/);
  assert.throws(() => parsePair(JSON.stringify({ v: 2, url: 'https://x.example.com', token: tok })), /not a pairing file/);
  assert.throws(() => parsePair(JSON.stringify({ v: 1, url: 'http://x.example.com', token: tok })), /https/);
  assert.throws(() => parsePair(JSON.stringify({ v: 1, url: 'https://x.example.com', token: 'short' })), /token/);
  assert.throws(() => parsePair('x'.repeat(5000)), /too large/);
});

test('call sends bearer token, query and JSON body', async () => {
  let seen;
  const api = createApi({
    getConfig: () => ({ baseUrl: 'https://api.example.com', token: 'tok' }),
    fetchImpl: async (url, init) => { seen = { url: String(url), init }; return { ok: true, status: 200, text: async () => '{"ok":1}' }; },
  });
  const out = await api.call({ method: 'POST', path: 'vps/start', body: { id: 'a' } });
  assert.deepStrictEqual(out, { ok: 1 });
  assert.strictEqual(seen.url, 'https://api.example.com/vps/start');
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer tok');
  assert.strictEqual(seen.init.body, '{"id":"a"}');
  await api.call({ path: 'files/list', query: { path: 'a b' } });
  assert.strictEqual(seen.url, 'https://api.example.com/files/list?path=a+b');
});

test('call maps 401 and refuses when signed out', async () => {
  const bad = createApi({
    getConfig: () => ({ baseUrl: 'https://x.example.com', token: 't' }),
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }),
  });
  await assert.rejects(bad.call({ path: 'status' }), /Wrong token/);
  const out = createApi({ getConfig: () => ({}) });
  await assert.rejects(out.call({ path: 'status' }), /Not signed in/);
  await assert.rejects(out.call({ path: 'agent/restart' }), /not allowed/);
});

test('530 with error 1033 reports the tunnel as offline', async () => {
  const fetchImpl = async () => ({ ok: false, status: 530, text: async () => 'error code: 1033' });
  const api = createApi({ getConfig: () => ({ baseUrl: 'https://api.example.com', token: 'a'.repeat(64) }), fetchImpl });
  await assert.rejects(() => api.call({ path: 'status' }), (e) => /tunnel offline/.test(e.message) && /1033/.test(e.message) && e.status === 530);
});
