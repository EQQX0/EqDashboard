'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const td = require('../tunnel-doctor');

const TUNNEL = '11111111-2222-3333-4444-555555555555';
const SECRET = 'SYNTH-API-TOKEN-do-not-print';

function pem(obj) {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ARGO TUNNEL TOKEN-----\n${b64}\n-----END ARGO TUNNEL TOKEN-----\n`;
}

const CFG = `tunnel: ${TUNNEL}
credentials-file: ${TUNNEL}.json
ingress:
  - hostname: files.example.com
    service: http://127.0.0.1:9000
  - service: http_status:404
`;

test('decodeCert reads a synthetic ARGO TUNNEL TOKEN', () => {
  const c = td.decodeCert(pem({ zoneID: 'z1', accountID: 'a1', apiToken: SECRET }));
  assert.deepStrictEqual(c, { zoneID: 'z1', accountID: 'a1', apiToken: SECRET });
  assert.strictEqual(td.decodeCert('garbage'), null);
  assert.strictEqual(td.decodeCert(null), null);
});

test('parseRouteOutput handles all phrasings and zone mismatch', () => {
  const h = 'api.x.com';
  assert.deepStrictEqual(td.parseRouteOutput('INF Added CNAME api.x.com which will route to this tunnel', h),
    { state: 'created', name: h, zoneMismatch: false });
  assert.deepStrictEqual(td.parseRouteOutput('INF api.x.com updated to route to your tunnel', h),
    { state: 'updated', name: h, zoneMismatch: false });
  assert.deepStrictEqual(td.parseRouteOutput('INF api.x.com is already configured to route to your tunnel', h),
    { state: 'unchanged', name: h, zoneMismatch: false });
  const bad = td.parseRouteOutput('INF Added CNAME api.x.com.other.com which will route to this tunnel', h);
  assert.strictEqual(bad.state, 'created');
  assert.strictEqual(bad.name, 'api.x.com.other.com');
  assert.strictEqual(bad.zoneMismatch, true);
  assert.strictEqual(td.parseRouteOutput('boom', h).state, 'error');
});

test('readConfig parses tunnel, credentials, hostnames, services', () => {
  const c = td.readConfig(CFG);
  assert.strictEqual(c.tunnel, TUNNEL);
  assert.strictEqual(c.credentialsFile, `${TUNNEL}.json`);
  assert.deepStrictEqual(c.hostnames, ['files.example.com']);
  assert.deepStrictEqual(c.services, ['http://127.0.0.1:9000', 'http_status:404']);
});

test('ensureIngress inserts, is idempotent, and handles missing catch-all', () => {
  const next = td.ensureIngress(CFG, 'api.example.com');
  assert.ok(next);
  const c = td.readConfig(next);
  assert.deepStrictEqual(c.hostnames, ['files.example.com', 'api.example.com']);
  assert.ok(next.indexOf('api.example.com') < next.indexOf('http_status:404'));
  assert.ok(next.includes('service: http://127.0.0.1:8787'));
  assert.strictEqual(td.ensureIngress(next, 'api.example.com'), null);
  assert.strictEqual(td.ensureIngress(CFG, 'files.example.com'), null);
  assert.strictEqual(td.ensureIngress('tunnel: x\ningress:\n  - hostname: a.b\n    service: http://x\n', 'api.b'), null);
});

test('classifyProbe', () => {
  assert.strictEqual(td.classifyProbe(401, ''), 'ok');
  assert.strictEqual(td.classifyProbe(530, 'error code: 1033'), 'tunnel_offline');
  assert.strictEqual(td.classifyProbe(530, ''), 'cloudflare_530');
  assert.strictEqual(td.classifyProbe(404, ''), 'no_ingress');
  assert.strictEqual(td.classifyProbe(502, ''), 'agent_down');
  assert.strictEqual(td.classifyProbe(0, ''), 'dns');
});

test('probe retries past 530/1033 then succeeds on 401', async () => {
  const replies = [{ status: 530, body: 'error code: 1033' }, { status: 401, body: '' }];
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const r = replies.shift();
    return { status: r.status, text: async () => r.body };
  };
  const res = await td.probe('https://api.example.com/', { fetchImpl, tries: 5, delayMs: 0 });
  assert.deepStrictEqual(res, { kind: 'ok', status: 401 });
  assert.strictEqual(urls.length, 2);
  assert.strictEqual(urls[0], 'https://api.example.com/status');
});

test('probe reports last failure when tries run out', async () => {
  const fetchImpl = async () => { throw new Error('nope'); };
  const res = await td.probe('https://api.example.com', { fetchImpl, tries: 2, delayMs: 0 });
  assert.deepStrictEqual(res, { kind: 'dns', status: 0 });
});

test('parseArgs', () => {
  assert.strictEqual(td.parseArgs(['--bogus']), null);
  const a = td.parseArgs(['--domain', 'x.com', '--route', '--probe']);
  assert.strictEqual(a.domain, 'x.com');
  assert.ok(a.route && a.probe && !a.fixIngress);
});

test('main output never contains the cert apiToken (offline: cert has no zoneID, no --probe/--route)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdoc-'));
  const writes = [];
  const so = process.stdout.write, se = process.stderr.write;
  try {
    fs.writeFileSync(path.join(dir, 'config.yml'), CFG);
    fs.writeFileSync(path.join(dir, `${TUNNEL}.json`), JSON.stringify({ AccountTag: 'a1', TunnelID: TUNNEL, TunnelSecret: 'shh' }));
    fs.writeFileSync(path.join(dir, 'cert.pem'), pem({ accountID: 'a1', apiToken: SECRET }));
    process.stdout.write = (s) => { writes.push(String(s)); return true; };
    process.stderr.write = (s) => { writes.push(String(s)); return true; };
    const code = await td.main(['--config', path.join(dir, 'config.yml'), '--domain', 'example.com']);
    process.stdout.write = so; process.stderr.write = se;
    const out = writes.join('');
    assert.ok(!out.includes(SECRET));
    assert.ok(!out.includes('shh'));
    assert.ok(out.includes('OK: cert account matches'));
    assert.strictEqual(code, 2); // ingress for api.example.com is missing
    assert.ok(out.includes('PROBLEM: ingress is missing api.example.com'));
  } finally {
    process.stdout.write = so; process.stderr.write = se;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
