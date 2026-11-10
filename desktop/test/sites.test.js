'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi, allowedPath } = require('../api');
const { validateSiteName, siteAddress, siteErrorText } = require('../renderer/sites-logic');

test('validateSiteName follows the Android and agent rules', () => {
  assert.strictEqual(validateSiteName('my-blog'), '');
  assert.strictEqual(validateSiteName(' blog1 '), '');
  assert.strictEqual(validateSiteName('a'), '');
  assert.match(validateSiteName(''), /Enter a name/);
  assert.match(validateSiteName('-x'), /lowercase/);
  assert.match(validateSiteName('x-'), /lowercase/);
  assert.match(validateSiteName('Blog'), /lowercase/);
  assert.match(validateSiteName('a.b'), /lowercase/);
  assert.match(validateSiteName('a'.repeat(33)), /lowercase/);
  assert.strictEqual(validateSiteName('a'.repeat(32)), '');
  assert.match(validateSiteName('api'), /reserved/);
  assert.match(validateSiteName('www'), /reserved/);
});

test('siteAddress shows a placeholder until a name is typed', () => {
  assert.strictEqual(siteAddress('blog', 'example.com'), 'blog.example.com');
  assert.strictEqual(siteAddress('', 'example.com'), 'name.example.com');
});

test('siteErrorText maps agent codes and passes unknown text through', () => {
  for (const c of ['bad_name', 'reserved_name', 'exists', 'too_large', 'bad_zip', 'unsafe_zip', 'not_found']) {
    assert.ok(siteErrorText(c).length > 10 && siteErrorText(c) !== c, c);
  }
  assert.strictEqual(siteErrorText('Wrong token'), 'Wrong token');
  assert.strictEqual(siteErrorText('', 'Deploy failed'), 'Deploy failed');
  assert.strictEqual(siteErrorText('constructor'), 'constructor');
});

test('allowedPath accepts the new site endpoints only', () => {
  for (const p of ['sites', 'sites/create', 'sites/update', 'sites/deploy', 'sites/list', 'sites/check']) assert.ok(allowedPath(p), p);
  assert.ok(!allowedPath('sites/other'));
});

test('call sends rawBody untouched with the given content type', async () => {
  let seen;
  const api = createApi({
    getConfig: () => ({ baseUrl: 'https://api.example.com', token: 't'.repeat(30) }),
    fetchImpl: async (url, init) => { seen = { url: String(url), init }; return { ok: true, status: 200, text: async () => '{"files":3,"bytes":10}' }; },
  });
  const zip = Buffer.from([0x50, 0x4b, 3, 4]);
  const r = await api.call({ method: 'POST', path: 'sites/deploy', query: { name: 'blog' }, rawBody: zip, contentType: 'application/zip' });
  assert.deepStrictEqual(r, { files: 3, bytes: 10 });
  assert.strictEqual(seen.url, 'https://api.example.com/sites/deploy?name=blog');
  assert.strictEqual(seen.init.body, zip);
  assert.strictEqual(seen.init.headers['Content-Type'], 'application/zip');
});

test('JSON bodies and agent error codes behave as before', async () => {
  let init;
  const mk = (res) => createApi({ getConfig: () => ({ baseUrl: 'https://a.example.com', token: 'x' }), fetchImpl: async (u, i) => { init = i; return res; } });
  await mk({ ok: true, status: 200, text: async () => '{}' }).call({ method: 'POST', path: 'sites/create', body: { name: 'a' } });
  assert.strictEqual(init.body, '{"name":"a"}');
  assert.strictEqual(init.headers['Content-Type'], 'application/json');
  const bad = mk({ ok: false, status: 413, text: async () => '{"error":"too_large"}' });
  await assert.rejects(bad.call({ method: 'POST', path: 'sites/deploy', query: { name: 'a' }, rawBody: Buffer.alloc(1) }), /too_large/);
});
