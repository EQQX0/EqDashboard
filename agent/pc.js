// Wake-on-LAN and remote shutdown for PCs on the same network. Zero dependencies; Node 18+ built-ins only.
// Turn on: UDP "magic packet" broadcast. Turn off: the agent runs `ssh user@pc` with its own key; the PC's
// authorized_keys entry forces the shutdown command, so that key can do nothing else.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const MAC_RE = /^([0-9a-f]{2})([:-]?)([0-9a-f]{2})(?:\2[0-9a-f]{2}){4}$/i;
const USER_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_PCS = 8;

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

function normMac(s) {
  const hex = String(s).replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!MAC_RE.test(String(s).trim()) || hex.length !== 12) return null;
  return hex.match(/../g).join(':');
}

function isPrivateV4(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 6 bytes of FF then the MAC sixteen times. */
function magicPacket(mac) {
  const m = Buffer.from(mac.replace(/:/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
}

function createPc(opts = {}) {
  const env = process.env;
  const DATA_DIR = path.resolve(opts.dataDir || env.DATA_DIR || path.join(__dirname, 'data'));
  const FILE = path.join(DATA_DIR, 'pcs.json');
  const KEY = path.join(DATA_DIR, 'pc_key');
  const KNOWN = path.join(DATA_DIR, 'pc_known_hosts');
  const SSH = opts.sshCmd || [env.SSH_BIN || 'ssh'];
  const KEYGEN = opts.keygenCmd || [env.SSH_KEYGEN_BIN || 'ssh-keygen'];
  const PROBE_PORTS = opts.probePorts || (env.PC_PROBE_PORTS || '3389,445,135,22').split(',').map(Number).filter(Boolean);
  const allowAnyIp = !!opts.allowAnyIp; // tests use loopback
  const SEND_TO = opts.sendTo; // tests: [{ address, port }] replaces the real broadcast list
  const COOLDOWN = Number(opts.cooldownMs !== undefined ? opts.cooldownMs : 3000);

  let pcs = {};
  let loaded = false;
  const last = new Map();

  function init() {
    if (loaded) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (v && typeof v.pcs === 'object' && v.pcs) pcs = v.pcs;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('pc: data unreadable, starting empty:', e.code || e.message);
    }
    loaded = true;
  }

  function save() {
    const tmp = FILE + '.tmp-' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, pcs }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, FILE);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      console.error('pc: could not save:', e.code || e.message);
    }
  }

  function probe(ip) {
    const one = (port) => new Promise((resolve) => {
      const s = net.connect({ host: ip, port });
      const fin = (v) => { s.destroy(); resolve(v); };
      s.setTimeout(700, () => fin(false));
      s.once('connect', () => fin(true));
      s.once('error', (e) => fin(e.code === 'ECONNREFUSED')); // a refusal still means the machine is up
    });
    return Promise.all(PROBE_PORTS.map(one)).then((r) => r.some(Boolean));
  }

  const view = (p, online) => ({ id: p.id, name: p.name, mac: p.mac, ip: p.ip, sshUser: p.sshUser, sshPort: p.sshPort, online });

  async function list() {
    const items = await Promise.all(Object.values(pcs).map(async (p) => view(p, await probe(p.ip))));
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { items, maxPcs: MAX_PCS, key: await publicKey().catch(() => null) };
  }

  async function add(body) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 40) throw new ApiError(400, 'bad_name');
    const mac = normMac(body.mac);
    if (!mac) throw new ApiError(400, 'bad_mac');
    const ip = String(body.ip || '').trim();
    if (!(allowAnyIp ? net.isIPv4(ip) : isPrivateV4(ip))) throw new ApiError(400, 'bad_ip');
    const sshUser = String(body.sshUser || '').trim();
    if (sshUser && !USER_RE.test(sshUser)) throw new ApiError(400, 'bad_user');
    const sshPort = body.sshPort === undefined || body.sshPort === null || body.sshPort === '' ? 22 : Number(body.sshPort);
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new ApiError(400, 'bad_port');
    if (Object.keys(pcs).length >= MAX_PCS) throw new ApiError(409, 'too_many', { max: MAX_PCS });
    if (Object.values(pcs).some((p) => p.mac === mac)) throw new ApiError(409, 'exists');
    const id = crypto.randomBytes(6).toString('hex');
    pcs[id] = { id, name, mac, ip, sshUser, sshPort, createdAt: new Date().toISOString() };
    save();
    return view(pcs[id], await probe(ip));
  }

  function existing(id) {
    if (typeof id !== 'string' || !pcs[id]) throw new ApiError(404, 'not_found');
    return pcs[id];
  }

  function setUser(id, user) {
    const p = existing(id);
    const sshUser = String(user || '').trim();
    if (!USER_RE.test(sshUser)) throw new ApiError(400, 'bad_user');
    p.sshUser = sshUser;
    save();
    return view(p, false);
  }

  function remove(id) {
    existing(id);
    delete pcs[id];
    save();
  }

  function cool(id) {
    const now = Date.now();
    if (now - (last.get(id) || 0) < COOLDOWN) throw new ApiError(429, 'too_fast');
    last.set(id, now);
  }

  function targets(ip) {
    if (SEND_TO) return SEND_TO;
    const t = [{ address: '255.255.255.255', port: 9 }, { address: '255.255.255.255', port: 7 }];
    const parts = ip.split('.');
    if (parts.length === 4) { const b = `${parts[0]}.${parts[1]}.${parts[2]}.255`; t.push({ address: b, port: 9 }, { address: b, port: 7 }); }
    return t;
  }

  async function wake(id) {
    const p = existing(id);
    cool(id + ':wake');
    const packet = magicPacket(p.mac);
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => {});
    try {
      await new Promise((resolve, reject) => sock.bind(0, () => { try { sock.setBroadcast(true); resolve(); } catch (e) { reject(e); } }));
      let sent = 0;
      for (let round = 0; round < 3; round++) {
        for (const t of targets(p.ip)) {
          await new Promise((resolve) => sock.send(packet, t.port, t.address, (err) => { if (!err) sent++; resolve(); }));
        }
        if (round < 2) await new Promise((r) => setTimeout(r, 120));
      }
      if (sent === 0) throw new ApiError(502, 'send_failed');
    } finally {
      try { sock.close(); } catch { /* closed */ }
    }
  }

  function run(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
      execFile(cmd[0], [...cmd.slice(1), ...args], { timeout: timeoutMs }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(stderr || stdout || '').trim().split('\n').pop() }));
    });
  }

  async function ensureKey() {
    if (fs.existsSync(KEY) && fs.existsSync(KEY + '.pub')) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const r = await run(KEYGEN, ['-t', 'ed25519', '-N', '', '-f', KEY, '-C', 's21-agent'], 20000);
    if (r.code !== 0 || !fs.existsSync(KEY + '.pub')) throw new ApiError(503, 'ssh_missing');
  }

  async function publicKey() {
    if (!fs.existsSync(KEY + '.pub')) return null;
    return (await fsp.readFile(KEY + '.pub', 'utf8')).trim().split('\n')[0];
  }

  async function shutdown(id) {
    const p = existing(id);
    if (!p.sshUser) throw new ApiError(409, 'no_ssh_user');
    cool(id + ':off');
    await ensureKey();
    const r = await run(SSH, [
      '-i', KEY, '-p', String(p.sshPort), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${KNOWN}`, '-o', 'ConnectTimeout=6',
      `${p.sshUser}@${p.ip}`, 'shutdown',
    ], 20000);
    if (r.code === 0) return;
    if (/permission denied|publickey/i.test(r.out)) throw new ApiError(502, 'auth_failed');
    if (/refused|timed out|no route|unreachable|connection closed/i.test(r.out)) throw new ApiError(502, 'unreachable');
    if (r.code === -1 && /ENOENT/i.test(r.out)) throw new ApiError(503, 'ssh_missing');
    throw new ApiError(502, 'ssh_failed');
  }

  function readBody(req, limit = 4096) {
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
          console.error('pc error:', (e && (e.code || e.message)) || 'unknown');
          sendJson(res, 500, { error: 'internal' });
        }
      }
      if (!req.readableEnded && !req.destroyed) req.resume();
    };
  }

  const routes = {
    'GET /pc/list': wrap(async (req, res) => sendJson(res, 200, await list())),
    'POST /pc/add': wrap(async (req, res) => sendJson(res, 200, { ok: true, item: await add(await readBody(req)) })),
    'POST /pc/user': wrap(async (req, res) => {
      const b = await readBody(req);
      sendJson(res, 200, { ok: true, item: setUser(b.id, b.sshUser) });
    }),
    'POST /pc/wake': wrap(async (req, res) => { await wake((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    'POST /pc/shutdown': wrap(async (req, res) => { await shutdown((await readBody(req)).id); sendJson(res, 200, { ok: true }); }),
    // Creates the agent's SSH key on first use and returns the public half for the PC's authorized_keys.
    'POST /pc/key': wrap(async (req, res) => { await ensureKey(); sendJson(res, 200, { ok: true, key: await publicKey() }); }),
    'DELETE /pc': wrap(async (req, res, url) => { remove(url.searchParams.get('id')); sendJson(res, 200, { ok: true }); }),
  };

  return { routes, init, list, add, setUser, remove, wake, shutdown, ensureKey, publicKey };
}

const instance = createPc();
module.exports = { createPc, routes: instance.routes, normMac, isPrivateV4, magicPacket };
