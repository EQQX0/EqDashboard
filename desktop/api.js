'use strict';
// Talks to the Samsung server agent. Pure Node (fetch), so it is testable without Electron.

const ALLOWED = [
  /^status$/, /^files\/(list|mkdir|rename|download)$/, /^files$/,
  /^downloads(\/(list|add|pause|resume))?$/, /^sites(\/(list|check))?$/,
  /^vps(\/(list|start|stop))?$/, /^pc(\/(list|wake|shutdown))?$/,
];

function normalizeBase(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(u)) throw new Error('The server address must start with https://');
  return u;
}

// Pairing file written by agent/pair.js: {"v":1,"url":"https://...","token":"..."}
function parsePair(text) {
  if (Buffer.byteLength(String(text), 'utf8') > 4096) throw new Error('That file is too large to be a pairing file');
  let o;
  try { o = JSON.parse(String(text).trim().replace(/^﻿/, '')); } catch { throw new Error('That is not a pairing file'); }
  if (!o || typeof o !== 'object' || String(o.v) !== '1') throw new Error('That is not a pairing file');
  const url = normalizeBase(o.url);
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (token.length < 20 || token.length > 200 || /[^!-~]/.test(token)) throw new Error('The token in that file is not valid');
  return { url, token };
}

function allowedPath(p) {
  return typeof p === 'string' && !p.includes('..') && ALLOWED.some((re) => re.test(p));
}

function httpErrorMessage(status, text) {
  if (status === 530) {
    return 'Server unreachable (tunnel offline). Cloudflare has no live connection to your phone. On the phone run: node ~/samsung-server/agent/tunnel-doctor.js --probe'
      + (/1033/.test(String(text || '')) ? ' (error 1033)' : '');
  }
  return `Server answered ${status}`;
}

function createApi({ getConfig, fetchImpl = fetch }) {
  async function call({ method = 'GET', path, query, body }) {
    if (!allowedPath(path)) throw new Error('Request not allowed');
    const { baseUrl, token } = getConfig();
    if (!baseUrl || !token) throw new Error('Not signed in');
    const url = new URL(normalizeBase(baseUrl) + '/' + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers, signal: AbortSignal.timeout(20000) };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(url, init);
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try { code = JSON.parse(text).error || ''; } catch {}
      const e = new Error(res.status === 401 ? 'Wrong token' : res.status === 429 ? 'Too many requests, wait a moment' : code || httpErrorMessage(res.status, text));
      e.status = res.status;
      throw e;
    }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  return { call };
}

module.exports = { createApi, normalizeBase, allowedPath, parsePair, httpErrorMessage };
