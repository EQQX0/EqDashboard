#!/usr/bin/env node
'use strict';
// tunnel-doctor: diagnose (and optionally repair) the cloudflared route for api.<domain>.
// Plain Node, no dependencies. Never reads agent/.token and never prints the cert API token.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------- pure helpers ----------

function readConfig(text) {
  const out = { tunnel: null, credentialsFile: null, hostnames: [], services: [] };
  if (typeof text !== 'string') return out;
  const strip = (v) => v.trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  for (const raw of text.split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^tunnel:\s*(.+)$/))) out.tunnel = strip(m[1]);
    else if ((m = raw.match(/^credentials-file:\s*(.+)$/))) out.credentialsFile = strip(m[1]);
    else if ((m = raw.match(/^\s*-?\s*hostname:\s*(.+)$/))) out.hostnames.push(strip(m[1]));
    else if ((m = raw.match(/^\s*-?\s*service:\s*(.+)$/))) out.services.push(strip(m[1]));
  }
  return out;
}

function decodeCert(pem) {
  if (typeof pem !== 'string') return null;
  const m = pem.match(/-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]*?)-----END ARGO TUNNEL TOKEN-----/);
  if (!m) return null;
  try {
    const j = JSON.parse(Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
    if (!j || typeof j !== 'object') return null;
    return { zoneID: j.zoneID || null, accountID: j.accountID || null, apiToken: j.apiToken || null };
  } catch (_) { return null; }
}

function readCreds(text) {
  try {
    const j = JSON.parse(text);
    return { accountTag: j.AccountTag || null, tunnelId: j.TunnelID || null };
  } catch (_) { return null; }
}

function parseRouteOutput(text, host) {
  const t = String(text || '');
  const patterns = [
    [/Added CNAME\s+(\S+)\s+which will route/i, 'created'],
    [/(\S+)\s+updated to route to your tunnel/i, 'updated'],
    [/(\S+)\s+is already configured to route/i, 'unchanged'],
  ];
  for (const [re, state] of patterns) {
    const m = t.match(re);
    if (m) {
      const name = m[1].replace(/[.,]+$/, '');
      return { state, name, zoneMismatch: !!host && name !== host && name.startsWith(host + '.') };
    }
  }
  return { state: 'error', name: null, zoneMismatch: false };
}

function ensureIngress(text, host, port = 8787) {
  if (typeof text !== 'string') return null;
  if (readConfig(text).hostnames.includes(host)) return null;
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*-\s*service:\s*http_status:404\s*$/.test(l));
  if (idx < 0) return null;
  lines.splice(idx, 0, `  - hostname: ${host}`, `    service: http://127.0.0.1:${port}`);
  return lines.join(nl);
}

function classifyProbe(status, body) {
  const b = String(body || '');
  if (status === 200 || status === 401) return 'ok';
  if (status === 530) return /1033/.test(b) ? 'tunnel_offline' : 'cloudflare_530';
  if (status === 404) return 'no_ingress';
  if (status === 502 || status === 504) return 'agent_down';
  if (status === 0) return 'dns';
  return 'other';
}

// ---------- IO helpers ----------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout || 30000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '') + String(stderr || '') });
    });
  });
}

async function timedJson(fetchImpl, url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetchImpl(url, Object.assign({ signal: ctl.signal }, opts || {}));
    return await r.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

async function probe(baseUrl, opts) {
  const o = Object.assign({ fetchImpl: globalThis.fetch, tries: 12, delayMs: 5000 }, opts || {});
  let last = { kind: 'dns', status: 0 };
  for (let i = 0; i < o.tries; i++) {
    let status = 0, body = '';
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await o.fetchImpl(baseUrl.replace(/\/+$/, '') + '/status', { signal: ctl.signal });
      status = r.status;
      body = await r.text();
    } catch (_) { status = 0; } finally { clearTimeout(t); }
    last = { kind: classifyProbe(status, body), status };
    if (last.kind === 'ok') break;
    if (i < o.tries - 1) await sleep(o.delayMs);
  }
  return last;
}

// ---------- CLI ----------

const HELP = `Usage: node tunnel-doctor.js [options]

Checks the cloudflared tunnel setup for api.<domain> and prints
OK:/PROBLEM:/FIX:/INFO: lines. Exit 0 = all OK, 2 = a problem was found, 1 = usage error.

Options:
  --domain D      Domain (default: first api.* hostname in config.yml)
  --config PATH   cloudflared config (default: ~/.cloudflared/config.yml)
  --fix-ingress   Add api.<D> -> http://127.0.0.1:8787 to config.yml (backs up to config.yml.bak,
                  validates, restores on failure)
  --route         Run: cloudflared tunnel route dns --overwrite-dns <tunnelId> api.<D>
  --probe         GET https://api.<D>/status (no auth), up to 12 tries, 5 s apart
  --help          Show this help
`;

function parseArgs(argv) {
  const a = { domain: null, config: null, fixIngress: false, route: false, probe: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--help' || x === '-h') a.help = true;
    else if (x === '--fix-ingress') a.fixIngress = true;
    else if (x === '--route') a.route = true;
    else if (x === '--probe') a.probe = true;
    else if (x === '--domain' && argv[i + 1]) a.domain = argv[++i];
    else if (x === '--config' && argv[i + 1]) a.config = argv[++i];
    else return null;
  }
  return a;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) { process.stderr.write(HELP); return 1; }
  if (args.help) { process.stdout.write(HELP); return 0; }

  let problems = 0;
  const say = (l) => process.stdout.write(l + '\n');
  const ok = (m) => say('OK: ' + m);
  const info = (m) => say('INFO: ' + m);
  const problem = (m, fixes) => { problems++; say('PROBLEM: ' + m); for (const f of [].concat(fixes)) say('FIX: ' + f); };

  const cfDir = args.config ? path.dirname(args.config) : path.join(os.homedir(), '.cloudflared');
  const cfgPath = args.config || path.join(cfDir, 'config.yml');
  let cfgText = null;
  try { cfgText = fs.readFileSync(cfgPath, 'utf8'); } catch (_) {}
  if (cfgText === null) {
    problem('cloudflared config not found: ' + cfgPath, 'bash termux/tunnel-setup.sh');
    return 2;
  }
  const cfg = readConfig(cfgText);
  ok('config read: ' + cfgPath);

  let domain = args.domain;
  if (!domain) {
    const h = cfg.hostnames.find((x) => /^api\./.test(x));
    if (h) domain = h.replace(/^api\./, '');
  }
  if (!domain) {
    problem('no domain: pass --domain or add an api.<domain> hostname to ' + cfgPath, 'node agent/tunnel-doctor.js --domain example.com --fix-ingress');
    return 2;
  }
  const apiHost = 'api.' + domain;

  // credentials
  let creds = null;
  let credsPath = cfg.credentialsFile;
  if (!credsPath && cfg.tunnel) credsPath = path.join(cfDir, cfg.tunnel + '.json');
  if (credsPath && !path.isAbsolute(credsPath)) credsPath = path.join(cfDir, credsPath);
  if (!cfg.tunnel) {
    problem('config.yml has no tunnel: line', 'bash termux/tunnel-setup.sh');
  }
  if (credsPath && fs.existsSync(credsPath)) {
    ok('credentials file exists');
    try { creds = readCreds(fs.readFileSync(credsPath, 'utf8')); } catch (_) {}
  } else {
    problem('credentials file missing: ' + (credsPath || '(not set)'), 'bash termux/tunnel-setup.sh');
  }
  const tunnelId = (creds && creds.tunnelId) || (cfg.tunnel && UUID_RE.test(cfg.tunnel) ? cfg.tunnel : null);
  if (creds && creds.tunnelId && cfg.tunnel) {
    if (creds.tunnelId.toLowerCase() === cfg.tunnel.toLowerCase()) ok('config tunnel matches credentials TunnelID');
    else problem('config tunnel (' + cfg.tunnel + ') differs from credentials TunnelID (' + creds.tunnelId + ')',
      'Set "tunnel: ' + creds.tunnelId + '" in ' + cfgPath);
  }

  // cert
  let cert = null;
  const certPath = path.join(cfDir, 'cert.pem');
  if (fs.existsSync(certPath)) {
    try { cert = decodeCert(fs.readFileSync(certPath, 'utf8')); } catch (_) {}
    ok('cert.pem exists');
    if (cert && creds && cert.accountID && creds.accountTag) {
      if (cert.accountID === creds.accountTag) ok('cert account matches tunnel credentials account');
      else problem('cert.pem belongs to a different Cloudflare account than the tunnel credentials', 'cloudflared tunnel login');
    }
  } else {
    problem('cert.pem missing: ' + certPath, 'cloudflared tunnel login');
  }

  // ingress
  if (cfg.hostnames.includes(apiHost)) ok('ingress has ' + apiHost);
  else if (args.fixIngress) {
    const next = ensureIngress(cfgText, apiHost);
    if (next === null) {
      problem('cannot add ingress for ' + apiHost + ': no "- service: http_status:404" catch-all found in ' + cfgPath,
        'Add to ingress: "  - hostname: ' + apiHost + '" and "    service: http://127.0.0.1:8787" before the catch-all');
    } else {
      const bak = cfgPath + '.bak';
      fs.copyFileSync(cfgPath, bak);
      fs.writeFileSync(cfgPath, next);
      const v = await run('cloudflared', ['tunnel', '--config', cfgPath, 'ingress', 'validate'], 30000);
      if (v.ok) { ok('added ingress for ' + apiHost + ' (backup: ' + bak + ')'); cfgText = next; }
      else {
        fs.copyFileSync(bak, cfgPath);
        problem('ingress validate failed; restored ' + cfgPath + ' from backup', 'cloudflared tunnel --config ' + cfgPath + ' ingress validate');
      }
    }
  } else {
    problem('ingress is missing ' + apiHost, 'node agent/tunnel-doctor.js --domain ' + domain + ' --fix-ingress');
  }

  // route
  const routeCmd = 'cloudflared tunnel route dns --overwrite-dns ' + (tunnelId || '<tunnelId>') + ' ' + apiHost;
  if (args.route) {
    if (!tunnelId) problem('cannot route: tunnel id unknown', 'bash termux/tunnel-setup.sh');
    else {
      const r = await run('cloudflared', ['tunnel', 'route', 'dns', '--overwrite-dns', tunnelId, apiHost], 30000);
      const p = parseRouteOutput(r.out, apiHost);
      if (p.state === 'error') problem('route dns failed: ' + r.out.trim().split(/\r?\n/).slice(-1)[0], [routeCmd, 'cloudflared tunnel login']);
      else if (p.zoneMismatch) problem('DNS record was created as ' + p.name + ' (wrong zone: cert is for another zone)',
        ['cloudflared tunnel login', 'Pick the zone ' + domain + ' when authorizing, then run: ' + routeCmd]);
      else ok('route dns ' + p.state + ': ' + p.name);
    }
  }

  // best-effort: zone status and nameservers
  if (cert && cert.zoneID && cert.apiToken && typeof globalThis.fetch === 'function') {
    const z = await timedJson(globalThis.fetch, 'https://api.cloudflare.com/client/v4/zones/' + encodeURIComponent(cert.zoneID),
      { headers: { authorization: 'Bearer ' + cert.apiToken } });
    if (z && z.success && z.result) {
      const r = z.result;
      if (r.name === domain) ok('cert zone is ' + domain);
      else problem('cert.pem is for zone ' + r.name + ', not ' + domain, 'cloudflared tunnel login');
      if (r.status === 'active') ok('zone ' + domain + ' is active');
      else problem('zone ' + domain + ' status is ' + r.status + ' (not active)', 'Set the registrar nameservers to: ' + (r.name_servers || []).join(', '));
      const d = await timedJson(globalThis.fetch, 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(domain) + '&type=NS',
        { headers: { accept: 'application/dns-json' } });
      if (d && Array.isArray(d.Answer) && Array.isArray(r.name_servers) && r.name_servers.length) {
        const live = d.Answer.filter((a) => a.type === 2).map((a) => String(a.data).replace(/\.$/, '').toLowerCase());
        const want = r.name_servers.map((s) => s.toLowerCase());
        if (live.length && !live.every((n) => want.includes(n))) {
          problem('public nameservers (' + live.join(', ') + ') differ from this zone (' + want.join(', ') + '): another copy of the zone may be active',
            'Set the registrar nameservers to: ' + want.join(', '));
        } else if (live.length) ok('public nameservers match the zone');
      }
    }
  }

  // best-effort: other tunnels with no connections (suggest only, never delete)
  const tl = await run('cloudflared', ['tunnel', 'list', '-o', 'json'], 5000);
  if (tl.ok) {
    try {
      const list = JSON.parse(tl.out.slice(tl.out.indexOf('[')));
      for (const t of list) {
        if (tunnelId && t.id === tunnelId) continue;
        if (!t.connections || t.connections.length === 0) {
          info('tunnel "' + t.name + '" has 0 connections; if unused, remove it with: cloudflared tunnel delete ' + t.name);
        }
      }
    } catch (_) {}
  }

  // probe
  if (args.probe) {
    const res = await probe('https://' + apiHost);
    if (res.kind === 'ok') ok('https://' + apiHost + '/status answered ' + res.status);
    else if (res.kind === 'tunnel_offline') {
      problem('https://' + apiHost + ' returns 530/1033: Cloudflare sees no live connector for this tunnel', [
        routeCmd,
        'cloudflared tunnel login',
        'In the Cloudflare dashboard, DNS > api must be CNAME ' + (tunnelId || '<tunnelId>') + '.cfargotunnel.com, Proxied; remove any api record pointing at another tunnel and any Pending copy of the zone.',
      ]);
    } else if (res.kind === 'cloudflare_530') problem('https://' + apiHost + ' returns 530', routeCmd);
    else if (res.kind === 'no_ingress') problem('https://' + apiHost + ' returns 404: no ingress rule matched', 'node agent/tunnel-doctor.js --domain ' + domain + ' --fix-ingress');
    else if (res.kind === 'agent_down') problem('https://' + apiHost + ' returns ' + res.status + ': tunnel is up but the agent is not answering', 'node agent/server.js');
    else if (res.kind === 'dns') problem('could not reach https://' + apiHost + ' (DNS or network failure)', routeCmd);
    else problem('https://' + apiHost + ' returned HTTP ' + res.status, 'curl -i https://' + apiHost + '/status');
  }

  return problems ? 2 : 0;
}

module.exports = { readConfig, decodeCert, readCreds, parseRouteOutput, ensureIngress, classifyProbe, probe, parseArgs, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write('tunnel-doctor: ' + (e && e.message) + '\n'); process.exit(1); });
}
