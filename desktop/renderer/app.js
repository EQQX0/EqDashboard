'use strict';
const $ = (id) => document.getElementById(id);

// Build elements without innerHTML so server text can never become markup.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM is allowed by the CSP, a style attribute is not
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

const ICONS = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  files: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z',
  downloads: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  sites: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 17.9A8 8 0 0 1 4.1 13H8c.1 2.5.8 4.7 3 6.9zM4.1 11A8 8 0 0 1 11 4.1C9 6.3 8.1 8.5 8 11H4.1zM13 4.1A8 8 0 0 1 19.9 11H16c-.1-2.5-.9-4.7-3-6.9zM16 13h3.9A8 8 0 0 1 13 19.9c2.1-2.2 2.9-4.4 3-6.9z',
  vps: 'M4 4h16v6H4V4zm0 10h16v6H4v-6zm3-8v2h2V6H7zm0 10v2h2v-2H7z',
  pc: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]); s.append(p);
  return s;
}

function fmtBytes(n) {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
}
function fmtDur(s) {
  s = Number(s) || 0;
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function call(req) {
  const r = await window.samsung.api(req);
  if (r.ok) return r.data;
  if (r.status === 401) { await window.samsung.signOut(); location.reload(); }
  throw new Error(r.error);
}
// Run an action, show errors as toasts, then redraw.
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); }
  load();
}
function stat(label, value, pct) {
  return h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value),
    pct == null ? null : h('div', { class: 'bar' }, h('i', { class: pct > 85 ? 'hot' : '', style: `width:${Math.min(100, Math.max(0, pct))}%` })));
}
function empty(msg) { return h('div', { class: 'card muted' }, msg); }

/* ---------- screens ---------- */
const screens = {
  async overview() {
    const s = await call({ path: 'status' });
    const memUsed = s.memory.totalBytes - s.memory.freeBytes;
    const cards = [
      stat('Uptime', fmtDur(s.uptimeSec)),
      stat('CPU load (1 min)', (s.load[0] ?? 0).toFixed(2), ((s.load[0] ?? 0) / s.cpuCores) * 100),
      stat('Memory', `${fmtBytes(memUsed)} / ${fmtBytes(s.memory.totalBytes)}`, (memUsed / s.memory.totalBytes) * 100),
    ];
    if (s.storage) cards.push(stat('Storage', `${fmtBytes(s.storage.usedKb * 1024)} / ${fmtBytes(s.storage.totalKb * 1024)}`, (s.storage.usedKb / s.storage.totalKb) * 100));
    if (s.battery) cards.push(stat('Battery', `${s.battery.percentage}%  ${s.battery.temperature.toFixed(1)}°C`, s.battery.percentage), stat('Charging', `${s.battery.status} (${s.battery.plugged})`));
    return h('div', { class: 'grid' }, cards);
  },

  async files() {
    const path = state.filesPath;
    const d = await call({ path: 'files/list', query: { path } });
    const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const mk = h('input', { placeholder: 'New folder name', 'aria-label': 'New folder name' });
    const rows = (d.entries || []).map((e) => h('div', { class: 'row' },
      e.type === 'dir'
        ? h('button', { class: 'btn grow', style: 'text-align:left', onclick: () => { state.filesPath = path ? `${path}/${e.name}` : e.name; load(); } }, '📁 ' + e.name)
        : h('div', { class: 'grow name' }, e.name),
      h('span', { class: 'muted' }, e.type === 'dir' ? '' : fmtBytes(e.size)),
      e.type === 'dir' ? null : h('button', { class: 'btn', onclick: () => act(async () => {
        const r = await window.samsung.saveFile(path ? `${path}/${e.name}` : e.name);
        if (!r.ok && r.error !== 'cancelled') throw new Error(r.error);
      }) }, 'Save'),
      h('button', { class: 'btn danger', onclick: () => confirm(`Delete ${e.name}?`) && act(() => call({ method: 'DELETE', path: 'files', query: { path: path ? `${path}/${e.name}` : e.name } }), 'Deleted') }, 'Delete')));
    return h('div', {},
      h('div', { class: 'crumbs' }, '/' + path),
      h('div', { class: 'toolbar', style: 'margin-bottom:12px' },
        path ? h('button', { class: 'btn', onclick: () => { state.filesPath = up; load(); } }, 'Up') : null,
        mk, h('button', { class: 'btn primary', onclick: () => mk.value.trim() && act(() => call({ method: 'POST', path: 'files/mkdir', body: { path: path ? `${path}/${mk.value.trim()}` : mk.value.trim() } }), 'Folder created') }, 'New folder')),
      h('div', { class: 'card' }, rows.length ? rows : h('span', { class: 'muted' }, 'Empty folder')));
  },

  async downloads() {
    const d = await call({ path: 'downloads/list' });
    const url = h('input', { placeholder: 'Link, magnet or video URL', 'aria-label': 'Download link' });
    const mode = h('select', { 'aria-label': 'Mode' }, h('option', { value: 'auto' }, 'Auto'), h('option', { value: 'direct' }, 'Direct'), h('option', { value: 'torrent' }, 'Torrent'), h('option', { value: 'video' }, 'Video'));
    const rows = (d.items || []).map((i) => {
      const pct = i.totalBytes ? Math.round((i.doneBytes / i.totalBytes) * 100) : 0;
      const paused = i.status === 'paused';
      return h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, i.name || i.source),
          h('div', { class: 'muted' }, `${i.status}${i.totalBytes ? ` · ${pct}% of ${fmtBytes(i.totalBytes)}` : ''}${i.speedBps ? ` · ${fmtBytes(i.speedBps)}/s` : ''}${i.error ? ' · ' + i.error : ''}`),
          i.totalBytes ? h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })) : null),
        ['active', 'queued', 'paused'].includes(i.status)
          ? h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: paused ? 'downloads/resume' : 'downloads/pause', body: { id: i.id } })) }, paused ? 'Resume' : 'Pause') : null,
        h('button', { class: 'btn danger', onclick: () => act(() => call({ method: 'DELETE', path: 'downloads', query: { id: i.id } })) }, 'Remove'));
    });
    return h('div', {},
      h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, url, mode,
        h('button', { class: 'btn primary', onclick: () => url.value.trim() && act(() => call({ method: 'POST', path: 'downloads/add', body: { url: url.value.trim(), mode: mode.value } }), 'Added') }, 'Add')),
      h('div', { class: 'card' }, rows.length ? rows : h('span', { class: 'muted' }, 'No downloads')));
  },

  async sites() {
    const d = await call({ path: 'sites/list' });
    if (!d.domain) return empty('Sites are off. Set SITES_DOMAIN on the server (see docs/SETUP.md).');
    const rows = (d.sites || []).map((s) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, s.hostname || s.name), h('div', { class: 'muted' }, `${s.files} files · ${fmtBytes(s.bytes)}`)),
      h('span', { class: 'pill ' + (s.enabled ? 'ok' : '') }, s.enabled ? 'on' : 'off'),
      h('button', { class: 'btn', onclick: () => act(async () => {
        const r = await call({ path: 'sites/check', query: { name: s.name } });
        toast(r.reachable ? `Reachable (${r.status})` : `Not reachable${r.error ? ': ' + r.error : ''}`);
      }) }, 'Check')));
    return h('div', { class: 'card' }, rows.length ? rows : h('span', { class: 'muted' }, 'No sites yet'));
  },

  async vps() {
    const d = await call({ path: 'vps/list' });
    if (!d.engine) return empty('The VPS engine is not installed on the server (see agent/README-vps.md).');
    const rows = (d.items || []).map((v) => {
      const running = v.status === 'running';
      return h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, v.name || v.id), h('div', { class: 'muted' }, `${v.distroLabel || v.distro} · SSH port ${v.port}${v.step ? ' · ' + v.step : ''}${v.error ? ' · ' + v.error : ''}`)),
        h('span', { class: 'pill ' + (running ? 'ok' : v.status === 'error' ? 'bad' : '') }, v.status),
        h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: running ? 'vps/stop' : 'vps/start', body: { id: v.id } })) }, running ? 'Stop' : 'Start'));
    });
    return h('div', { class: 'card' }, rows.length ? rows : h('span', { class: 'muted' }, 'No VPS slices'));
  },

  async pc() {
    const d = await call({ path: 'pc/list' });
    const rows = (d.items || []).map((p) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name || p.ip), h('div', { class: 'muted' }, `${p.ip} · ${p.mac}`)),
      h('span', { class: 'pill ' + (p.online ? 'ok' : '') }, p.online ? 'online' : 'offline'),
      h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: 'pc/wake', body: { id: p.id } }), 'Wake signal sent') }, 'Turn on'),
      p.sshUser ? h('button', { class: 'btn danger', onclick: () => confirm(`Shut down ${p.name || p.ip}?`) && act(() => call({ method: 'POST', path: 'pc/shutdown', body: { id: p.id } }), 'Shutdown sent') }, 'Shut down') : null));
    return h('div', {}, h('div', { class: 'card' }, rows.length ? rows : h('span', { class: 'muted' }, 'No PCs yet')),
      h('p', { class: 'muted' }, 'Add PCs and set up shutdown in the Android app.'));
  },
};

const TITLES = { overview: 'Overview', files: 'Files', downloads: 'Downloads', sites: 'Sites', vps: 'VPS', pc: 'My PC' };
const state = { tab: 'overview', filesPath: '' };
let timer;

async function load() {
  clearTimeout(timer);
  $('title').textContent = TITLES[state.tab];
  for (const b of $('nav').querySelectorAll('button[data-tab]')) {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const tab = state.tab;
  try {
    const el = await screens[tab]();
    if (tab !== state.tab) return;
    $('view').replaceChildren(el);
    $('banner').hidden = true;
    $('stamp').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    if (tab !== state.tab) return;
    $('banner').textContent = e.message; $('banner').hidden = false;
  }
  if (tab === 'overview' || tab === 'downloads') timer = setTimeout(load, 5000);
}

function buildNav() {
  const nav = $('nav');
  for (const t of Object.keys(TITLES)) {
    nav.append(h('button', { 'data-tab': t, onclick: () => { state.tab = t; load(); } }, icon(t), h('span', {}, TITLES[t])));
  }
  nav.append(h('div', { class: 'spacer' }), h('button', { onclick: async () => { await window.samsung.signOut(); location.reload(); } }, h('span', {}, 'Sign out')));
}

async function boot() {
  const cfg = await window.samsung.getConfig();
  if (!cfg.signedIn) {
    $('login').hidden = false; $('url').value = cfg.baseUrl || '';
    // Look for a pairing file once, then only until one is found or the person chooses to type. One check at a time.
    let looking = false, dismissed = false;
    const look = async () => {
      if (looking || dismissed) return;
      looking = true;
      try {
        const r = await window.samsung.findPair();
        if (r.found) {
          $('foundText').textContent = `Found ${r.name} in ${r.folder} for ${r.host}.`;
          $('found').hidden = false; clearInterval(poll); poll = null;
        }
      } catch {} finally { looking = false; }
    };
    let poll = setInterval(look, 3000);
    look();
    $('useFound').addEventListener('click', async () => {
      try { await window.samsung.usePair(); location.reload(); }
      catch (e) { $('loginErr').textContent = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
    });
    $('skipFound').addEventListener('click', () => { dismissed = true; $('found').hidden = true; if (poll) { clearInterval(poll); poll = null; } });
    $('importBtn').addEventListener('click', async () => {
      try { const r = await window.samsung.importPair(); if (r.ok) location.reload(); }
      catch (e) { $('loginErr').textContent = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
    });
    $('loginForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await window.samsung.signIn($('url').value, $('token').value); location.reload(); }
      catch (e) { $('loginErr').textContent = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
    });
    return;
  }
  $('shell').hidden = false; buildNav();
  $('refresh').addEventListener('click', load);
  load();
}
boot();
