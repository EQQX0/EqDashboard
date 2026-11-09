'use strict';
const crypto = require('node:crypto');

const WINDOW_MS = 60000;
const MAX_FAILS = 5;
const MAX_REQS = 60;
const fails = new Map();
const reqs = new Map();

function prune(map, ip, now) {
  const arr = (map.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  map.set(ip, arr);
  if (map.size > 5000) {
    for (const [k, v] of map) if (!v.length || now - v[v.length - 1] >= WINDOW_MS) map.delete(k);
  }
  return arr;
}

function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function send(res, code, error) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json({ error });
}

function tokenMatches(token, expectedHex) {
  const got = crypto.createHash('sha256').update(token, 'utf8').digest();
  const want = Buffer.from(String(expectedHex).trim().toLowerCase(), 'hex');
  if (want.length !== got.length) return false;
  return crypto.timingSafeEqual(got, want);
}

// Returns true if the request may proceed; otherwise a response was sent.
function guard(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    send(res, 405, 'method_not_allowed');
    return false;
  }
  if (!process.env.TOKEN_SHA256 || !process.env.GITHUB_TOKEN) {
    send(res, 503, 'not_configured');
    return false;
  }
  const now = Date.now();
  const ip = clientIp(req);
  const f = prune(fails, ip, now);
  if (f.length >= MAX_FAILS) {
    send(res, 429, 'too_many_failures');
    return false;
  }
  const r = prune(reqs, ip, now);
  if (r.length >= MAX_REQS) {
    send(res, 429, 'too_many_requests');
    return false;
  }
  r.push(now);
  const h = req.headers.authorization;
  const m = typeof h === 'string' ? /^Bearer (.+)$/.exec(h) : null;
  if (!m || !tokenMatches(m[1], process.env.TOKEN_SHA256)) {
    f.push(now);
    send(res, 401, 'unauthorized');
    return false;
  }
  return true;
}

function _reset() {
  fails.clear();
  reqs.clear();
}

module.exports = { guard, send, tokenMatches, _reset };
