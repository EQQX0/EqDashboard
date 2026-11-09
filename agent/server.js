// S21 server agent. Zero dependencies; runs on Node.js inside Termux.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const files = require('./files');
const sites = require('./sites');
const tunnel = require('./tunnel');
const downloads = require('./downloads');
const vps = require('./vps');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1'; // cloudflared connects locally
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(__dirname, '.token');

function loadToken() {
  if (process.env.AGENT_TOKEN) return process.env.AGENT_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  const t = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  console.log('Generated new token at', TOKEN_FILE);
  return t;
}
const TOKEN = loadToken();

// Rate limit: 300 requests per minute per IP, 5 failed auths per minute per IP.
const hits = new Map();
const fails = new Map();
function bump(map, ip, limit) {
  const now = Date.now();
  const arr = (map.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  map.set(ip, arr);
  return arr.length > limit;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Slow phone commands (battery can hang for seconds when the Termux:API app is missing)
// run in the background; /status only ever returns the last cached values, so it answers instantly.
let batteryCache = null;
let storageCache = null;
let refreshing = false;

async function refreshSlowStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [battery, df] = await Promise.all([
      run('termux-battery-status', []),
      run('df', ['-k', process.env.STORAGE_PATH || process.env.HOME || '/']),
    ]);
    if (df) {
      const row = df.trim().split('\n').pop().split(/\s+/);
      const s = { totalKb: Number(row[1]), usedKb: Number(row[2]), freeKb: Number(row[3]) };
      if ([s.totalKb, s.usedKb, s.freeKb].every(Number.isFinite)) storageCache = s;
    }
    try { batteryCache = battery ? JSON.parse(battery) : null; } catch { batteryCache = null; /* termux-api missing */ }
  } finally {
    refreshing = false;
  }
}
refreshSlowStatus();
setInterval(refreshSlowStatus, 20000).unref();

async function status() {
  const storage = storageCache;
  const battJson = batteryCache;
  return {
    time: new Date().toISOString(),
    uptimeSec: Math.round(os.uptime()),
    load: os.loadavg(),
    cpuCores: os.cpus().length || os.availableParallelism?.() || 8, // Android reports 0 cpus
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    storage,
    battery: battJson, // percentage, temperature, status, plugged
  };
}

// A handler with 0-1 params returns JSON. A handler declared (req, res, url) writes the response itself.
const routes = {
  'GET /status': status,
  ...files.routes,
  ...sites.routes,
  ...tunnel.routes,
  ...downloads.routes,
  ...vps.routes,
};

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  if (bump(hits, ip, 300)) return send(res, 429, { error: 'rate_limited' });

  const auth = req.headers.authorization || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!ok) {
    if (bump(fails, ip, 5)) return send(res, 429, { error: 'too_many_failures' });
    return send(res, 401, { error: 'unauthorized' });
  }

  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: 'not_found' });
  try {
    if (handler.length >= 2) return await handler(req, res, url);
    send(res, 200, await handler(req, url));
  } catch (e) {
    if (res.headersSent) return res.destroy();
    send(res, 500, { error: 'internal', detail: String(e.message || e) });
  }
});

server.requestTimeout = 0; // large uploads may take longer than the 5 min default
files.init();
try { sites.start(); } catch (e) { console.error('sites failed to start:', e && (e.code || e.message)); }
downloads.start().catch((e) => console.error('downloads failed to start:', e && (e.code || e.message)));
server.listen(PORT, HOST, () => console.log(`agent listening on ${HOST}:${PORT}`));
