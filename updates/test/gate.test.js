'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const auth = require('../lib/auth');
const latest = require('../api/latest');
const apk = require('../api/apk');

const TOKEN = 'agent-token-SECRET-123';
const GH = 'ghp_FAKEGITHUBTOKEN456';
const realFetch = globalThis.fetch;

function setEnv() {
  process.env.TOKEN_SHA256 = crypto.createHash('sha256').update(TOKEN).digest('hex');
  process.env.GITHUB_TOKEN = GH;
  delete process.env.GITHUB_REPO;
}
test.beforeEach(() => { auth._reset(); setEnv(); });
test.afterEach(() => { globalThis.fetch = realFetch; });

function mkReq(over = {}) {
  return { method: 'GET', headers: { authorization: 'Bearer ' + TOKEN }, query: {}, socket: { remoteAddress: '1.2.3.4' }, ...over };
}
function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const META = { versionCode: 7, versionName: '1.7', sha256: 'ab'.repeat(32), size: 1234, notes: 'hi' };
const RELEASE = {
  published_at: '2026-01-02T03:04:05Z', draft: false, prerelease: false,
  assets: [{ name: 'meta.json', url: 'https://api.github.com/a/1' }, { name: 'app.apk', url: 'https://api.github.com/a/2' }],
};
const resp = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
function mockGh(calls = []) {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/releases/latest')) return resp(200, RELEASE);
    if (url.endsWith('/a/1')) return resp(200, META);
    if (url.endsWith('/a/2')) return resp(302, '', { location: 'https://objects.example/signed?x=1' });
    return resp(404, {});
  };
  return calls;
}

test('auth: missing token 401', async () => {
  mockGh(); const res = mkRes();
  await latest(mkReq({ headers: {} }), res);
  assert.equal(res.code, 401); assert.deepEqual(res.body, { error: 'unauthorized' });
});
test('auth: wrong token 401', async () => {
  mockGh(); const res = mkRes();
  await latest(mkReq({ headers: { authorization: 'Bearer nope' } }), res);
  assert.equal(res.code, 401);
});
test('auth: right token 200 and timingSafeEqual executed', async (t) => {
  mockGh(); const spy = t.mock.method(crypto, 'timingSafeEqual');
  const res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 200); assert.equal(spy.mock.callCount(), 1);
});
test('auth: 429 after 5 failures', async () => {
  mockGh(); const bad = { authorization: 'Bearer nope' };
  for (let i = 0; i < 5; i++) { const r = mkRes(); await latest(mkReq({ headers: bad }), r); assert.equal(r.code, 401); }
  const r = mkRes(); await latest(mkReq(), r);
  assert.equal(r.code, 429); assert.deepEqual(r.body, { error: 'too_many_failures' });
});
test('auth: 429 after 60 requests/min', async () => {
  mockGh(); let last;
  for (let i = 0; i < 61; i++) { last = mkRes(); await latest(mkReq(), last); }
  assert.equal(last.code, 429);
});
test('auth: 503 when env unset, before auth', async () => {
  for (const k of ['TOKEN_SHA256', 'GITHUB_TOKEN']) {
    setEnv(); delete process.env[k];
    const res = mkRes(); await latest(mkReq({ headers: {} }), res);
    assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'not_configured' });
  }
});
test('405 for non-GET', async () => {
  const res = mkRes(); await apk(mkReq({ method: 'POST' }), res);
  assert.equal(res.code, 405); assert.ok(res.body.error);
});

test('latest: ok mapping', async () => {
  const calls = mockGh(); const res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ...META, publishedAt: RELEASE.published_at });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(calls[0].url, /repos\/EQQX0\/EqDashboard\/releases\/latest$/);
  assert.equal(calls[1].opts.headers.Accept, 'application/octet-stream');
});
test('latest: no_release on 404 and on missing assets', async () => {
  globalThis.fetch = async () => resp(404, {});
  let res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 404); assert.deepEqual(res.body, { error: 'no_release' });
  globalThis.fetch = async () => resp(200, { ...RELEASE, assets: [RELEASE.assets[0]] });
  res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 404);
});
test('latest: upstream failure 502', async () => {
  globalThis.fetch = async () => resp(500, {});
  let res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 502); assert.deepEqual(res.body, { error: 'upstream' });
  globalThis.fetch = async () => { throw new Error('boom ' + GH); };
  res = mkRes(); await latest(mkReq(), res);
  assert.equal(res.code, 502);
});

test('apk: ok returns signed url, manual redirect, no bytes', async () => {
  const calls = mockGh(); const res = mkRes();
  await apk(mkReq({ query: { versionCode: '7' } }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { url: 'https://objects.example/signed?x=1', expiresInSec: 300 });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls[2].opts.redirect, 'manual');
  assert.equal(Buffer.isBuffer(res.body), false);
});
test('apk: wrong versionCode 404', async () => {
  mockGh(); const res = mkRes();
  await apk(mkReq({ query: { versionCode: '8' } }), res);
  assert.equal(res.code, 404); assert.deepEqual(res.body, { error: 'no_such_version' });
});
test('apk: 302 without Location -> 502', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/releases/latest')) return resp(200, RELEASE);
    if (url.endsWith('/a/1')) return resp(200, META);
    return resp(302, '');
  };
  const res = mkRes(); await apk(mkReq({ query: { versionCode: '7' } }), res);
  assert.equal(res.code, 502); assert.deepEqual(res.body, { error: 'upstream' });
});

test('no response or log contains tokens', async () => {
  const logs = [];
  const orig = { l: console.log, e: console.error, w: console.warn };
  console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const out = [];
  try {
    mockGh();
    for (const [h, q] of [[{ authorization: 'Bearer ' + TOKEN }, { versionCode: '7' }], [{ authorization: 'Bearer ' + TOKEN }, { versionCode: '9' }], [{ authorization: 'Bearer bad' }, {}]]) {
      for (const fn of [latest, apk]) { const r = mkRes(); await fn(mkReq({ headers: h, query: q }), r); out.push(JSON.stringify([r.body, r.headers])); }
    }
    globalThis.fetch = async () => { throw new Error(GH); };
    const r = mkRes(); await latest(mkReq(), r); out.push(JSON.stringify([r.body, r.headers]));
  } finally { console.log = orig.l; console.error = orig.e; console.warn = orig.w; }
  const all = out.join('') + logs.join('');
  for (const s of [TOKEN, GH, process.env.TOKEN_SHA256]) assert.ok(!all.includes(s));
});
