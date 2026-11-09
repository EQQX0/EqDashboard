// Relays the EqRGB phone remote (a small web page on the PC, port 47822) through the agent, so a phone
// that is away from home can use it over the tunnel. The app asks for a session with its bearer token and
// opens /pc/lights/r/<session>/ ; the 128-bit session id in the path is the only credential on this route.
// The PC's own token never leaves the Samsung server: the agent adds it as a cookie on the way in.
'use strict';
const http = require('http');
const crypto = require('crypto');

const PREFIX = '/pc/lights/r/';
const SESSION_RE = /^\/pc\/lights\/r\/([0-9a-f]{32})(\/.*)?$/;
const MAX_SESSIONS = 30;
const MAX_REWRITE = 2 * 1024 * 1024; // pages and JSON are buffered to rewrite them; anything bigger is refused
const MAX_UPLOAD = 300 * 1024 * 1024; // same limit as EqRGB's own /upload
const GET_EXACT = new Set(['/', '/logo.png', '/favicon.ico', '/apple-touch-icon.png', '/api/poll']);
const GET_PREFIX = ['/preview/', '/staged/', '/profiles/'];

function send(res, code, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Rewrites the page's root-absolute paths ("/api/x", url(/logo.png)) to live under [prefix]. */
function rewriteHtml(text, prefix) {
  return text
    .replace(/(["'`])\/(?=[A-Za-z])/g, (m, q) => `${q}${prefix}/`)
    .replace(/url\(\s*\/(?=[A-Za-z])/g, `url(${prefix}/`);
}

/** Picture links in EqRGB's JSON ("/profiles/ab.jpg?v=1") get the same prefix. */
function rewriteJson(text, prefix) {
  return text.replace(/"\/(preview|staged|profiles)\//g, (m, d) => `"${prefix}/${d}/`);
}

function createRelay(opts) {
  const getPc = opts.getPc; // id -> { ip, lightsUrl } or throws
  const ttlMs = opts.ttlMs || 8 * 3600 * 1000;
  const host = opts.host; // tests: reach a fake EqRGB on loopback instead of the PC's address
  const sessions = new Map();

  function prune() {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.exp <= now) sessions.delete(k);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }

  /** Makes a session for a PC that has a saved link; returns the path to open. */
  function open(pcId) {
    const p = getPc(pcId);
    if (!p.lightsUrl) return null;
    prune();
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { pcId, exp: Date.now() + ttlMs });
    return `${PREFIX}${sid}/`;
  }

  /** Handles a request under /pc/lights/r/. Returns false when the path is not ours. */
  function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const m = SESSION_RE.exec(url.pathname);
    if (!m) { if (!url.pathname.startsWith(PREFIX)) return false; send(res, 404, { error: 'not_found' }); return true; }
    const sess = sessions.get(m[1]);
    if (!sess || sess.exp <= Date.now()) { send(res, 404, { error: 'session_expired' }); return true; }
    const prefix = `${PREFIX}${m[1]}`;
    if (m[2] === undefined) { res.writeHead(301, { Location: `${prefix}/`, 'Cache-Control': 'no-store' }); res.end(); return true; }
    const rest = m[2];
    // The path goes to the PC as written, so encoded slashes or dots must not slip past the allowlist below.
    if (/%(2e|2f|5c)|\\|\.\./i.test(rest)) { send(res, 404, { error: 'not_found' }); req.resume(); return true; }

    const isPost = req.method === 'POST';
    const allowed = isPost
      ? rest.startsWith('/api/') || rest === '/upload'
      : req.method === 'GET' && (GET_EXACT.has(rest) || GET_PREFIX.some((s) => rest.startsWith(s)));
    if (!allowed) { send(res, req.method === 'GET' || isPost ? 404 : 405, { error: 'not_found' }); req.resume(); return true; }

    let pc;
    let link;
    try {
      pc = getPc(sess.pcId);
      link = new URL(pc.lightsUrl);
    } catch { sessions.delete(m[1]); send(res, 404, { error: 'session_expired' }); req.resume(); return true; }
    const token = link.searchParams.get('t');
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_UPLOAD) { send(res, 413, { error: 'too_large' }); req.resume(); return true; }

    const headers = { Host: `${pc.ip}:${link.port || 80}`, Cookie: `rgbt=${token}` };
    for (const h of ['content-type', 'content-length', 'range', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    const up = http.request({
      host: host || pc.ip, port: Number(link.port || 80), method: req.method, path: rest + url.search, headers,
      timeout: rest === '/upload' ? 600000 : 20000,
    }, (ur) => {
      const type = String(ur.headers['content-type'] || '');
      const rewrite = /^text\/html/i.test(type) ? rewriteHtml : /^application\/json/i.test(type) ? rewriteJson : null;
      const out = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
      for (const h of ['content-type', 'content-range', 'accept-ranges']) if (ur.headers[h]) out[h] = ur.headers[h];
      if (!rewrite) {
        if (ur.headers['content-length']) out['content-length'] = ur.headers['content-length'];
        res.writeHead(ur.statusCode || 502, out);
        ur.pipe(res);
        return;
      }
      const chunks = [];
      let n = 0;
      ur.on('data', (c) => {
        n += c.length;
        if (n > MAX_REWRITE) { ur.destroy(); send(res, 502, { error: 'bad_gateway' }); return; }
        chunks.push(c);
      });
      ur.on('end', () => {
        if (res.headersSent) return;
        const body = Buffer.from(rewrite(Buffer.concat(chunks).toString('utf8'), prefix), 'utf8');
        out['content-length'] = body.length;
        res.writeHead(ur.statusCode || 502, out);
        res.end(body);
      });
      ur.on('error', () => send(res, 502, { error: 'bad_gateway' }));
    });
    up.on('timeout', () => up.destroy());
    up.on('error', () => send(res, 502, { error: 'pc_unreachable' }));
    res.on('close', () => up.destroy());
    req.pipe(up);
    return true;
  }

  return { open, handle, size: () => sessions.size };
}

module.exports = { createRelay, rewriteHtml, rewriteJson, PREFIX };
