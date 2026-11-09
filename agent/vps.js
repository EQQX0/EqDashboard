// VPS-style slices for the S21 agent. Zero dependencies; Node 18+ built-ins only.
// Each slice is a proot-distro Linux (Debian, Ubuntu or Alpine) running its own sshd on its own port.
// No root, no systemd, no Docker: proot gives a userland you can ssh into, install packages in and run services from.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DISTROS = { debian: 'Debian', ubuntu: 'Ubuntu', alpine: 'Alpine Linux' };
const NAME_RE = /^[a-z]([a-z0-9-]{0,21}[a-z0-9])?$/;
// ssh public key: type, base64 blob, optional short comment. Nothing that could break out of a shell string.
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/]{20,2000}={0,2}( [A-Za-z0-9@._-]{1,60})?$/;
const PORT_BASE = 2201;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function killTree(pid, signal) {
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal); // the whole group: proot and the sshd under it
  } catch { /* already gone */ }
}

function lanHost() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  } catch { /* Android can refuse to list interfaces */ }
  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const fin = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(500, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

const alias = (name) => 's21-' + name;

function setupScript(distro, password, key) {
  const install = distro === 'alpine'
    ? 'apk add --no-cache openssh'
    : 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y openssh-server';
  return [
    'set -e',
    install,
    'mkdir -p /run/sshd /root/.ssh',
    'chmod 700 /root/.ssh',
    'ssh-keygen -A',
    // Alpine locks the root account, and sshd refuses locked accounts even for keys, so root always gets a password.
    `echo 'root:${password}' | chpasswd`,
    key ? `printf '%s\\n' '${key}' > /root/.ssh/authorized_keys` : ':',
    key ? 'chmod 600 /root/.ssh/authorized_keys' : ':',
    'echo s21-setup-done',
    '',
  ].join('\n');
}

function createVps(opts = {}) {
  const env = process.env;
  const DATA_DIR = path.resolve(opts.dataDir || env.DATA_DIR || path.join(__dirname, 'data'));
  const META_FILE = path.join(DATA_DIR, 'vps.json');
  const PROOT = opts.prootCmd || [env.PROOT_DISTRO_BIN || 'proot-distro'];
  const MAX = Number(opts.maxSlices || env.VPS_MAX || 4);
  const MIN_FREE = Number(opts.minFree !== undefined ? opts.minFree : (env.VPS_MIN_FREE_BYTES || 1610612736));
  const BIND = opts.bind || env.VPS_BIND || '0.0.0.0';
  const START_TIMEOUT = Number(opts.startTimeoutMs || 20000);
  const INSTALL_TIMEOUT = Number(opts.installTimeoutMs || 1200000);

  let slices = {};
  let loaded = false;
  let engineOk = null;
  let engineAt = 0;
  const busy = new Set();
  const children = new Map();

  // ---- persistence ---------------------------------------------------------------------

  function init() {
    if (loaded) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      const v = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
      if (v && typeof v.slices === 'object' && v.slices) slices = v.slices;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('vps: metadata unreadable, starting empty:', e.code || e.message);
    }
    for (const s of Object.values(slices)) {
      if (s.status === 'creating') { s.status = 'error'; s.error = 'Interrupted by an agent restart. Delete it and create it again.'; s.step = null; }
      else if (s.status === 'running' && !alive(s.pid)) { s.status = 'stopped'; s.pid = null; }
    }
    loaded = true;
  }

  function save() {
    const tmp = META_FILE + '.tmp-' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, slices }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, META_FILE);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      console.error('vps: could not save metadata:', e.code || e.message);
    }
  }

  // ---- proot-distro ------------------------------------------------------------------------

  // Runs proot-distro and resolves { code, tail } (the last output lines). stdin text is written then closed.
  function runProot(args, { stdin, timeoutMs = 60000 } = {}) {
    return new Promise((resolve) => {
      let child;
      const lines = [];
      let done = false;
      let timer = null;
      const fin = (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, tail: lines.slice(-8).join('\n') }); } };
      try {
        child = spawn(PROOT[0], [...PROOT.slice(1), ...args], { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      } catch { return fin(-1); }
      const take = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { lines.push(l.trim().slice(0, 300)); if (lines.length > 50) lines.shift(); } };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', () => fin(-1));
      child.on('close', (code) => fin(code === null ? -1 : code));
      timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
      timer.unref();
      if (stdin !== undefined) {
        child.stdin.on('error', () => {});
        child.stdin.end(stdin);
      }
    });
  }

  async function engineReady() {
    if (engineOk === true) return true;
    if (engineOk === false && Date.now() - engineAt < 30000) return false;
    engineOk = (await runProot(['list'], { timeoutMs: 15000 })).code === 0;
    engineAt = Date.now();
    return engineOk;
  }

  async function freeBytes() {
    try {
      const s = await fsp.statfs(DATA_DIR);
      return Number(s.bavail) * Number(s.bsize);
    } catch { return null; }
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  const view = (s) => ({
    id: s.name, name: s.name, distro: s.distro, distroLabel: DISTROS[s.distro] || s.distro, port: s.port,
    authMode: s.authMode, status: s.status, step: s.step || null, error: s.error || null,
    createdAt: s.createdAt, startedAt: s.status === 'running' ? s.startedAt || null : null,
  });

  function startScript(s) {
    const flags = [
      `-p ${s.port}`, '-D', '-e',
      '-o PermitRootLogin=yes', `-o PasswordAuthentication=${s.authMode === 'key' ? 'no' : 'yes'}`,
      '-o UsePAM=no', '-o PidFile=/tmp/sshd.pid', '-o MaxAuthTries=3', '-o LoginGraceTime=30',
    ];
    if (BIND !== '0.0.0.0') flags.push(`-o ListenAddress=${BIND}`);
    return `mkdir -p /run/sshd; exec /usr/sbin/sshd ${flags.join(' ')}`;
  }

  async function startSlice(s) {
    let logFd = 'ignore';
    try { logFd = fs.openSync(path.join(DATA_DIR, `vps-${s.name}.log`), 'a'); } catch { /* no log */ }
    let spawnErr = null;
    const child = spawn(PROOT[0], [...PROOT.slice(1), 'login', alias(s.name), '--shared-tmp', '--', '/bin/sh', '-c', startScript(s)], {
      detached: true, stdio: ['ignore', logFd, logFd],
    });
    if (typeof logFd === 'number') fs.closeSync(logFd);
    child.on('error', (e) => { spawnErr = e; });
    child.unref();
    s.pid = child.pid;
    children.set(s.name, child);
    child.on('exit', () => {
      if (children.get(s.name) === child) children.delete(s.name);
      if (slices[s.name] === s && s.pid === child.pid && s.status === 'running') {
        s.status = 'stopped';
        s.pid = null;
        s.error = 'SSH stopped unexpectedly';
        save();
      }
    });
    const end = Date.now() + START_TIMEOUT;
    for (;;) {
      if (await checkPort(s.port)) break;
      if (spawnErr || !alive(child.pid) || Date.now() > end) {
        killTree(child.pid, 'SIGKILL');
        s.pid = null;
        s.status = 'stopped';
        s.error = 'SSH did not start. Check ' + `vps-${s.name}.log` + ' in the agent data folder.';
        save();
        throw new ApiError(500, 'start_failed');
      }
      await sleep(200);
    }
    s.status = 'running';
    s.error = null;
    s.startedAt = new Date().toISOString();
    save();
  }

  async function stopSlice(s) {
    const pid = s.pid;
    s.status = 'stopped';
    s.pid = null;
    s.error = null;
    save();
    if (!pid) return;
    killTree(pid, 'SIGTERM');
    for (let i = 0; i < 25 && alive(pid); i++) await sleep(200);
    if (alive(pid)) killTree(pid, 'SIGKILL');
  }

  // Background job: install the distro, install and configure sshd, then start it.
  async function provision(s, password, key) {
    const fail = async (msg, tail) => {
      await runProot(['remove', alias(s.name)], { timeoutMs: 120000 }).catch(() => {});
      s.status = 'error';
      s.step = null;
      s.error = (msg + (tail ? ': ' + tail.split('\n').pop() : '')).slice(0, 300);
      save();
      busy.delete(s.name);
    };
    try {
      s.step = `Downloading ${DISTROS[s.distro]}`;
      save();
      let r = await runProot(['install', '--override-alias', alias(s.name), s.distro], { timeoutMs: INSTALL_TIMEOUT });
      if (r.code !== 0) return await fail('Could not download the Linux image', r.tail);
      s.step = 'Installing the SSH server';
      save();
      r = await runProot(['login', alias(s.name), '--', '/bin/sh', '-s'], { stdin: setupScript(s.distro, password, key), timeoutMs: INSTALL_TIMEOUT });
      if (r.code !== 0 || !/s21-setup-done/.test(r.tail)) return await fail('Could not set up SSH', r.tail);
      s.step = 'Starting';
      save();
      await startSlice(s).catch(() => {}); // stays "creating" until sshd answers, then running (or stopped with an error)
      s.step = null;
      save();
    } catch (e) {
      await fail('Unexpected error', String(e && e.message));
      return;
    }
    busy.delete(s.name);
  }

  function checkName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new ApiError(400, 'bad_name');
    return name;
  }
  function existing(name) {
    checkName(name);
    if (!slices[name]) throw new ApiError(404, 'not_found');
    return slices[name];
  }
  function lock(name) {
    if (busy.has(name)) throw new ApiError(409, 'busy');
    busy.add(name);
  }

  async function list() {
    const items = [];
    for (const s of Object.values(slices)) {
      if (s.status === 'running' && !alive(s.pid)) { s.status = 'stopped'; s.pid = null; }
      items.push(view(s));
    }
    items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return {
      engine: await engineReady(),
      distros: Object.entries(DISTROS).map(([id, label]) => ({ id, label })),
      host: lanHost(), maxSlices: MAX, freeBytes: await freeBytes(), items,
    };
  }

  async function create(body) {
    const name = checkName(body.name);
    if (typeof body.distro !== 'string' || !DISTROS[body.distro]) throw new ApiError(400, 'bad_distro');
    let key = null;
    if (body.sshKey !== undefined && body.sshKey !== null && String(body.sshKey).trim() !== '') {
      key = String(body.sshKey).trim();
      if (!KEY_RE.test(key)) throw new ApiError(400, 'bad_key');
    }
    if (slices[name]) throw new ApiError(409, 'exists');
    if (Object.keys(slices).length >= MAX) throw new ApiError(409, 'too_many', { max: MAX });
    if (!(await engineReady())) throw new ApiError(503, 'engine_missing', { engine: 'proot-distro' });
    const free = await freeBytes();
    if (free !== null && free < MIN_FREE) throw new ApiError(507, 'low_space', { freeBytes: free });
    const used = new Set(Object.values(slices).map((s) => s.port));
    let port = Number(opts.portBase || env.VPS_PORT_BASE || PORT_BASE);
    while (used.has(port)) port++;
    const password = crypto.randomBytes(15).toString('base64url');
    const s = {
      name, distro: body.distro, port, authMode: key ? 'key' : 'password', status: 'creating', step: 'Starting',
      error: null, pid: null, createdAt: new Date().toISOString(), startedAt: null,
    };
    lock(name);
    slices[name] = s;
    save();
    provision(s, password, key); // runs in the background; the app polls the list
    return { item: view(s), password: key ? null : password };
  }

  async function start(name) {
    const s = existing(name);
    lock(name);
    try {
      if (s.status === 'running') return;
      if (s.status !== 'stopped') throw new ApiError(409, 'wrong_state');
      await startSlice(s);
    } finally { busy.delete(name); }
  }

  async function stop(name) {
    const s = existing(name);
    lock(name);
    try {
      if (s.status === 'creating') throw new ApiError(409, 'wrong_state');
      await stopSlice(s);
    } finally { busy.delete(name); }
  }

  async function resetPassword(name) {
    const s = existing(name);
    if (s.authMode === 'key') throw new ApiError(409, 'key_only');
    if (s.status === 'creating') throw new ApiError(409, 'wrong_state');
    lock(name);
    try {
      const password = crypto.randomBytes(15).toString('base64url');
      const r = await runProot(['login', alias(name), '--', '/bin/sh', '-s'], { stdin: `echo 'root:${password}' | chpasswd\necho s21-setup-done\n`, timeoutMs: 60000 });
      if (r.code !== 0 || !/s21-setup-done/.test(r.tail)) throw new ApiError(500, 'reset_failed');
      return password;
    } finally { busy.delete(name); }
  }

  async function remove(name) {
    const s = existing(name);
    lock(name);
    try {
      if (s.status === 'creating') throw new ApiError(409, 'wrong_state');
      await stopSlice(s);
      const r = await runProot(['remove', alias(name)], { timeoutMs: 300000 });
      if (r.code !== 0 && s.status !== 'error') throw new ApiError(500, 'remove_failed');
      delete slices[name];
      save();
      await fsp.rm(path.join(DATA_DIR, `vps-${name}.log`), { force: true }).catch(() => {});
    } finally { busy.delete(name); }
  }

  // ---- HTTP -----------------------------------------------------------------------------------------

  function readBody(req, limit = 16384) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on('data', (c) => {
        n += c.length;
        if (n > limit) { reject(new ApiError(413, 'too_large')); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
          if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0;
          resolve(v);
        } catch { reject(new ApiError(400, 'bad_request')); }
      });
      req.on('error', () => reject(new ApiError(400, 'bad_request')));
    });
  }

  function wrap(fn) {
    return async (req, res, url) => {
      try {
        init();
        await fn(req, res, url);
      } catch (e) {
        if (e instanceof ApiError) sendJson(res, e.status, { error: e.code, ...e.extra });
        else {
          console.error('vps error:', (e && (e.code || e.message)) || 'unknown');
          sendJson(res, 500, { error: 'internal' });
        }
      }
      if (!req.readableEnded && !req.destroyed) {
        req.resume();
        setTimeout(() => req.destroy(), 10000).unref();
      }
    };
  }

  const routes = {
    'GET /vps/list': wrap(async (req, res) => sendJson(res, 200, await list())),
    'POST /vps/create': wrap(async (req, res) => {
      const out = await create(await readBody(req));
      sendJson(res, 200, { ok: true, ...out });
    }),
    'POST /vps/start': wrap(async (req, res) => { await start((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    'POST /vps/stop': wrap(async (req, res) => { await stop((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    'POST /vps/password': wrap(async (req, res) => {
      sendJson(res, 200, { ok: true, password: await resetPassword((await readBody(req)).id) });
    }),
    'DELETE /vps': wrap(async (req, res, url) => { await remove(url.searchParams.get('id')); sendJson(res, 200, { ok: true }); }),
  };

  // Slices that were running when the agent restarted keep running (detached); re-attach the exit watcher is not
  // possible, so a dead pid is noticed on the next list.
  function stopAll() {
    for (const [name, child] of children) { children.delete(name); try { killTree(child.pid, 'SIGTERM'); } catch { /* gone */ } }
  }

  return { routes, init, list, create, start, stop, remove, resetPassword, stopAll, DATA_DIR };
}

const instance = createVps();

module.exports = { createVps, routes: instance.routes, init: instance.init, KEY_RE, NAME_RE, DISTROS };
