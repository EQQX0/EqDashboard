// Agent self-update. Zero dependencies; Node 18+ built-ins only.
// Checks the newest GitHub release for a samsung-agent-X.Y.Z.zip asset, downloads it from GitHub only,
// checks every .js file parses, copies the files over the running agent and restarts it.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { extract } = require('./zip');

// samsung-agent-X.Y.Z.zip is the name now; s21-agent-X.Y.Z.zip is the old name that agents before 0.11.2 look for.
const ASSET_RE = /^(?:samsung|s21)-agent-(\d+\.\d+\.\d+)\.zip$/;
const MAX_ZIP = 8 * 1024 * 1024;
const COPY_RULES = [
  { dir: 'agent', test: (n) => /^[\w-]+\.js$/.test(n) || n === 'package.json' || /^README-[\w-]+\.md$/.test(n), to: '.' },
  { dir: 'termux', test: (n) => /^[\w.-]+\.sh$/.test(n), to: '../termux' },
];

class ApiError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

function sendJson(res, code, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

const hostOk = (h) => h === 'api.github.com' || h === 'github.com' || h.endsWith('.githubusercontent.com');

function createSelfUpdate(opts = {}) {
  const env = process.env;
  const AGENT_DIR = path.resolve(opts.agentDir || __dirname);
  // Where releases come from: AGENT_UPDATE_REPO, else package.json "repository" ("owner/name"). Forks change that one line.
  let pkgRepo = '';
  try { pkgRepo = String(JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'package.json'), 'utf8')).repository || ''); } catch { /* none */ }
  const REPO = String(opts.repo || env.AGENT_UPDATE_REPO || pkgRepo).trim();
  const API = opts.apiBase || env.AGENT_UPDATE_API || 'https://api.github.com';
  const insecureTest = !!opts.allowAnyHost; // tests only: talk to a local http server
  let running = false;

  const restart = opts.restart || (() => {
    // Wait for this process to release the port, then start the new code. The watchdog is the backstop.
    const log = path.join(AGENT_DIR, '..', 'agent.log');
    const child = spawn('sh', ['-c', `sleep 2; cd "${AGENT_DIR}" && exec node server.js >> "${log}" 2>&1`], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => process.exit(0), 400).unref();
  });

  function currentVersion() {
    try { return String(JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'package.json'), 'utf8')).version); } catch { return '0.0.0'; }
  }

  function get(urlStr, { max, accept, hops = 0 }) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(urlStr); } catch { return reject(new ApiError(502, 'bad_url')); }
      const secure = url.protocol === 'https:';
      if (!insecureTest && (!secure || !hostOk(url.hostname))) return reject(new ApiError(502, 'untrusted_host'));
      const lib = secure ? https : http;
      const req = lib.get(url, { headers: { 'User-Agent': 'samsung-agent', Accept: accept || '*/*' }, timeout: 20000 }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
          r.resume();
          if (hops >= 4) return reject(new ApiError(502, 'too_many_redirects'));
          return resolve(get(new URL(r.headers.location, url).toString(), { max, accept, hops: hops + 1 }));
        }
        if (r.statusCode !== 200) {
          r.resume();
          return reject(new ApiError(502, r.statusCode === 403 || r.statusCode === 429 ? 'rate_limited' : 'github_error', { http: r.statusCode }));
        }
        const chunks = [];
        let n = 0;
        r.on('data', (c) => {
          n += c.length;
          if (n > max) { req.destroy(); reject(new ApiError(502, 'too_large')); return; }
          chunks.push(c);
        });
        r.on('end', () => resolve(Buffer.concat(chunks)));
        r.on('error', () => reject(new ApiError(502, 'network')));
      });
      req.on('timeout', () => { req.destroy(); reject(new ApiError(502, 'network')); });
      req.on('error', () => reject(new ApiError(502, 'network')));
    });
  }

  async function latest() {
    if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new ApiError(503, 'not_configured');
    const body = await get(`${API}/repos/${REPO}/releases/latest`, { max: 1024 * 1024, accept: 'application/vnd.github+json' });
    let rel;
    try { rel = JSON.parse(body.toString('utf8')); } catch { throw new ApiError(502, 'github_error'); }
    for (const a of Array.isArray(rel.assets) ? rel.assets : []) {
      const m = ASSET_RE.exec(String(a.name || ''));
      if (m) {
        return {
          version: m[1], url: String(a.browser_download_url || ''), size: Number(a.size) || 0,
          digest: /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || ''))?.[1]?.toLowerCase() || null,
          notes: String(rel.body || '').slice(0, 500),
        };
      }
    }
    return null;
  }

  async function check() {
    const current = currentVersion();
    const l = await latest();
    if (!l) return { current, latest: null, available: false };
    return { current, latest: l.version, available: cmpVersion(current, l.version) < 0, size: l.size, notes: l.notes };
  }

  function syntaxOk(file) {
    return new Promise((resolve) => execFile(process.execPath, ['--check', file], { timeout: 15000 }, (err) => resolve(!err)));
  }

  async function apply() {
    if (running) throw new ApiError(409, 'busy');
    running = true;
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 's21-upd-'));
    try {
      const current = currentVersion();
      const l = await latest();
      if (!l || cmpVersion(current, l.version) >= 0) return { updated: false, current };
      const zipBuf = await get(l.url, { max: MAX_ZIP });
      if (l.digest && crypto.createHash('sha256').update(zipBuf).digest('hex') !== l.digest) throw new ApiError(502, 'bad_checksum');
      const zipPath = path.join(work, 'agent.zip');
      const stage = path.join(work, 'stage');
      await fsp.writeFile(zipPath, zipBuf);
      await fsp.mkdir(stage);
      try { await extract(zipPath, stage); } catch { throw new ApiError(502, 'bad_archive'); }

      const plan = [];
      for (const rule of COPY_RULES) {
        let names = [];
        try { names = await fsp.readdir(path.join(stage, rule.dir)); } catch { /* folder absent */ }
        for (const n of names.filter(rule.test)) {
          const src = path.join(stage, rule.dir, n);
          if (!(await fsp.stat(src)).isFile()) continue;
          plan.push({ src, dest: path.resolve(AGENT_DIR, rule.to, n), name: `${rule.dir}/${n}` });
        }
      }
      const pkg = plan.find((p) => p.name === 'agent/package.json');
      if (!plan.some((p) => p.name === 'agent/server.js') || !pkg) throw new ApiError(502, 'bad_archive');
      let newVersion;
      try { newVersion = JSON.parse(await fsp.readFile(pkg.src, 'utf8')).version; } catch { throw new ApiError(502, 'bad_archive'); }
      if (newVersion !== l.version) throw new ApiError(502, 'bad_archive');
      for (const p of plan.filter((x) => x.name.endsWith('.js'))) {
        if (!(await syntaxOk(p.src))) throw new ApiError(502, 'bad_archive', { file: p.name });
      }

      // Keep the previous agent files so a bad release can be rolled back by hand.
      const backup = path.resolve(AGENT_DIR, '..', 'agent-backup');
      await fsp.mkdir(backup, { recursive: true });
      for (const p of plan) {
        await fsp.copyFile(p.dest, path.join(backup, path.basename(p.dest))).catch(() => {});
        await fsp.mkdir(path.dirname(p.dest), { recursive: true });
        const tmp = p.dest + '.new';
        await fsp.copyFile(p.src, tmp);
        await fsp.rename(tmp, p.dest);
      }
      return { updated: true, from: current, to: l.version, restarting: true };
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      running = false;
    }
  }

  function wrap(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof ApiError) sendJson(res, e.status, { error: e.code, ...e.extra });
        else {
          console.error('selfupdate error:', (e && (e.code || e.message)) || 'unknown');
          sendJson(res, 500, { error: 'internal' });
        }
      }
      if (!req.readableEnded && !req.destroyed) req.resume();
    };
  }

  const routes = {
    'GET /agent/update': wrap(async (req, res) => sendJson(res, 200, await check())),
    'POST /agent/update': wrap(async (req, res) => {
      const out = await apply();
      sendJson(res, 200, { ok: true, ...out });
      if (out.updated) res.once('finish', () => restart());
    }),
  };

  return { routes, check, apply, currentVersion };
}

const instance = createSelfUpdate();
module.exports = { createSelfUpdate, routes: instance.routes, cmpVersion };
