'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createTunnel, parseIngress, serviceTarget } = require('../tunnel');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's21-tunnel-'));
const cleanups = [];
test.after(async () => {
  for (const c of cleanups) await c();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function listen() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => c.end());
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function writeConfig(name, body) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
}

const SAMPLE = `# cloudflared config
tunnel: abc-123
credentials-file: /data/data/com.termux/files/home/.cloudflared/abc-123.json

ingress:
  - hostname: gym.eqqx2.com
    service: http://localhost:8080
  - hostname: "downloader.eqqx2.com"   # the downloader
    service: 'http://127.0.0.1:8081'
    originRequest:
      noTLSVerify: true
  - hostname: api.eqqx2.com
    service: http://127.0.0.1:8787
  - hostname: "*.eqqx2.com"
    service: http://127.0.0.1:8790
  - service: http_status:404
`;

test('parseIngress reads hostnames and services, ignoring comments, quotes and nested keys', () => {
  const r = parseIngress(SAMPLE);
  assert.deepStrictEqual(r.map((e) => e.hostname), ['gym.eqqx2.com', 'downloader.eqqx2.com', 'api.eqqx2.com', '*.eqqx2.com', undefined]);
  assert.strictEqual(r[1].service, 'http://127.0.0.1:8081');
  assert.strictEqual(r[4].service, 'http_status:404');
});

test('parseIngress ignores keys outside ingress and handles empty or odd input', () => {
  assert.deepStrictEqual(parseIngress(''), []);
  assert.deepStrictEqual(parseIngress('tunnel: x\nservice: http://a:1\n'), []);
  assert.deepStrictEqual(parseIngress('ingress:\n  - hostname: a.test\n'), []); // no service
  assert.strictEqual(parseIngress('ingress:\r\n  - hostname: a.test\r\n    service: http://localhost:1\r\n').length, 1);
});

test('serviceTarget extracts host and port, null for non-network services', () => {
  assert.deepStrictEqual(serviceTarget('http://localhost:8080'), { host: 'localhost', port: 8080 });
  assert.deepStrictEqual(serviceTarget('https://127.0.0.1'), { host: '127.0.0.1', port: 443 });
  assert.deepStrictEqual(serviceTarget('ssh://127.0.0.1:8022'), { host: '127.0.0.1', port: 8022 });
  assert.strictEqual(serviceTarget('http_status:404'), null);
  assert.strictEqual(serviceTarget('hello_world'), null);
  assert.strictEqual(serviceTarget('unix:/tmp/x.sock'), null);
});

test('listing reports up and down for local apps and classifies kinds', async () => {
  const up = await listen();
  const upPort = up.address().port;
  cleanups.push(() => new Promise((r) => up.close(r)));
  const downPort = await freePort();
  const sitesPort = await freePort();
  const agentPort = await freePort();
  const cfg = writeConfig('a.yml', `ingress:
  - hostname: gym.test
    service: http://localhost:${upPort}
  - hostname: down.test
    service: http://127.0.0.1:${downPort}
  - hostname: api.test
    service: http://127.0.0.1:${agentPort}
  - hostname: "*.test"
    service: http://127.0.0.1:${sitesPort}
  - hostname: remote.test
    service: http://example.invalid:80
  - hostname: gym.test
    service: http://localhost:${upPort}
  - service: http_status:404
`);
  const t = createTunnel({ configPath: cfg, sitesPort, agentPort });
  const l = await t.listing();
  assert.strictEqual(l.found, true);
  const by = Object.fromEntries(l.routes.map((r) => [r.hostname, r]));
  assert.strictEqual(l.routes.length, 5, 'duplicate and catch-all entries are dropped');
  assert.deepStrictEqual([by['gym.test'].kind, by['gym.test'].up, by['gym.test'].port], ['app', true, upPort]);
  assert.deepStrictEqual([by['down.test'].kind, by['down.test'].up], ['app', false]);
  assert.deepStrictEqual([by['api.test'].kind, by['api.test'].up], ['agent', false]);
  assert.strictEqual(by['*.test'].kind, 'sites');
  assert.deepStrictEqual([by['remote.test'].kind, by['remote.test'].up], ['app', null], 'non-loopback hosts are never contacted');
});

test('listing handles a missing config file', async () => {
  const t = createTunnel({ configPath: path.join(tmp, 'nope.yml') });
  assert.deepStrictEqual(await t.listing(), { found: false, routes: [] });
});

test('listing reports an oversized config instead of reading it', async () => {
  const cfg = writeConfig('big.yml', 'ingress:\n' + '# x\n'.repeat(70000));
  const l = await createTunnel({ configPath: cfg }).listing();
  assert.strictEqual(l.error, 'config_too_large');
  assert.deepStrictEqual(l.routes, []);
});

test('GET /tunnel/routes needs the token and returns the listing', async () => {
  const TOKEN = 'tt-' + Math.random().toString(16).slice(2);
  const upSrv = await listen();
  cleanups.push(() => new Promise((r) => upSrv.close(r)));
  const cfg = writeConfig('srv.yml', `ingress:\n  - hostname: gym.test\n    service: http://127.0.0.1:${upSrv.address().port}\n  - service: http_status:404\n`);
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_TOKEN: TOKEN, TUNNEL_CONFIG: cfg,
      FILES_ROOT: path.join(tmp, 'srv-files'), DATA_DIR: path.join(tmp, 'srv-data'), SITES_PORT: String(await freePort()),
      TOKEN_FILE: path.join(tmp, 'srv.token'),
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
  const get = (headers) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/tunnel/routes', headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });
  assert.strictEqual((await get({})).status, 401);
  const ok = await get({ Authorization: 'Bearer ' + TOKEN });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.found, true);
  assert.deepStrictEqual(ok.json.routes.map((r) => [r.hostname, r.up]), [['gym.test', true]]);
});

test('sites find their domain from the tunnel wildcard that points at the sites port', () => {
  const { domainFromTunnel } = require('../sites');
  const cfg = path.join(os.tmpdir(), 's21-cfg-' + process.pid + '.yml');
  fs.writeFileSync(cfg, 'tunnel: x\ningress:\n  - hostname: api.example.com\n    service: http://127.0.0.1:8787\n  - hostname: "*.example.com"\n    service: http://127.0.0.1:8790\n  - service: http_status:404\n');
  assert.strictEqual(domainFromTunnel(cfg, 8790), 'example.com');
  assert.strictEqual(domainFromTunnel(cfg, 9999), '', 'a wildcard for another port is not ours');
  assert.strictEqual(domainFromTunnel(path.join(os.tmpdir(), 'missing-cfg.yml'), 8790), '');
  fs.writeFileSync(cfg, 'ingress:\n  - hostname: "*.evil.test"\n    service: http://10.0.0.5:8790\n');
  assert.strictEqual(domainFromTunnel(cfg, 8790), '', 'only this machine counts');
  fs.rmSync(cfg, { force: true });
});
