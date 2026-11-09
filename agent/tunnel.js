// Read-only view of the Cloudflare Tunnel config. Lists every hostname the tunnel routes and checks
// whether the local app behind it accepts connections. Never writes, never contacts non-loopback hosts.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0']);
const DEFAULT_PORTS = { 'http:': 80, 'https:': 443, 'ssh:': 22, 'tcp:': 0, 'rdp:': 3389, 'smb:': 445 };
const MAX_CONFIG_BYTES = 262144;
const MAX_ROUTES = 100;
const PROBE_TIMEOUT_MS = 1500;

function unquote(v) {
  const s = String(v).trim();
  const m = /^(["'])(.*?)\1/.exec(s);
  if (m) return m[2];
  return s.replace(/\s+#.*$/, '').trim();
}

// Minimal reader for the `ingress:` list of cloudflared's config.yml (no YAML dependency).
// Returns [{ hostname?, path?, service }] in file order; entries without a service are dropped.
function parseIngress(text) {
  const out = [];
  let inIngress = false;
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const top = /^([A-Za-z][\w-]*)\s*:/.exec(raw);
    if (top) { inIngress = top[1] === 'ingress'; cur = null; continue; }
    if (!inIngress) continue;
    let line = raw;
    const dash = /^\s*-\s*(.*)$/.exec(line);
    if (dash) { cur = {}; out.push(cur); line = dash[1]; }
    if (!cur) continue;
    const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv && (kv[1] === 'hostname' || kv[1] === 'service' || kv[1] === 'path')) cur[kv[1]] = unquote(kv[2]);
  }
  return out.filter((e) => e.service);
}

// "http://localhost:8080" -> { host: "localhost", port: 8080 }; null for http_status:404, unix sockets, etc.
function serviceTarget(service) {
  let u;
  try { u = new URL(service); } catch { return null; }
  if (!(u.protocol in DEFAULT_PORTS)) return null;
  const port = u.port ? Number(u.port) : DEFAULT_PORTS[u.protocol];
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: u.hostname, port };
}

function probePort(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.connect({ host, port });
    const fin = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => fin(false));
    sock.once('connect', () => fin(true));
    sock.once('error', () => fin(false));
  });
}

function createTunnel(opts = {}) {
  const configPath = opts.configPath || process.env.TUNNEL_CONFIG || path.join(os.homedir(), '.cloudflared', 'config.yml');
  const sitesPort = Number(opts.sitesPort || process.env.SITES_PORT || 8790);
  const agentPort = Number(opts.agentPort || process.env.PORT || 8787);

  async function listing() {
    let text;
    try {
      const st = await fs.promises.stat(configPath);
      if (st.size > MAX_CONFIG_BYTES) return { found: true, error: 'config_too_large', routes: [] };
      text = await fs.promises.readFile(configPath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return { found: false, routes: [] };
      return { found: false, error: 'unreadable', routes: [] };
    }
    const seen = new Set();
    const entries = [];
    for (const e of parseIngress(text)) {
      if (!e.hostname) continue; // the catch-all rule
      const key = e.hostname + '\n' + e.service;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(e);
      if (entries.length >= MAX_ROUTES) break;
    }
    const routes = await Promise.all(entries.map(async (e) => {
      const target = serviceTarget(e.service);
      const local = !!target && LOOPBACK.has(target.host.toLowerCase());
      let kind = 'app';
      if (local && target.port === sitesPort && e.hostname.startsWith('*.')) kind = 'sites';
      else if (local && target.port === agentPort) kind = 'agent';
      const up = local ? await probePort(target.host === '[::1]' ? '::1' : target.host, target.port) : null;
      return { hostname: e.hostname, service: e.service, port: target ? target.port : null, kind, up };
    }));
    return { found: true, routes };
  }

  return { listing, routes: { 'GET /tunnel/routes': () => listing() }, configPath };
}

const instance = createTunnel();

module.exports = { createTunnel, parseIngress, serviceTarget, probePort, routes: instance.routes };
