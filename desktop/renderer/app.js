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

// Same glyphs as the Android app.
const ICONS = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  files: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  fileDoc: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  downloads: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  sites: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
  vps: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  pc: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  cpu: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z',
  memory: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zM3 3v18h18V3H3zm16 16H5V5h14v14z',
  battery: 'M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
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
// Dark glass stat card: title + gradient icon tile, monospace value, hint, optional usage bar.
let cardIndex = 0;
function stat({ title, value, hint, tone, icon: ic, grad, pct }) {
  return h('div', { class: 'stat appear', style: `--i:${Math.min(cardIndex++, 8)}` },
    h('div', { class: 'stat-top' }, h('div', { class: 'stat-title' }, title), h('div', { class: 'tile ' + grad }, icon(ic))),
    h('div', { class: 'stat-value' }, value),
    hint ? h('div', { class: 'stat-hint ' + (tone || '') }, hint) : null,
    pct == null ? null : h('div', { class: 'bar' }, h('i', { class: pct > 85 ? 'hot' : '', style: `width:${Math.min(100, Math.max(0, pct))}%` })));
}
// Light glass panel that holds a list or a message.
function panel(...kids) { return h('div', { class: 'glass panel appear' }, ...kids); }
function emptyPanel(title, text) { return h('div', { class: 'glass panel pad empty appear' }, h('h3', {}, title), h('p', {}, text)); }
function empty(msg) { return emptyPanel('Not available', msg); }

/* ---------- screens ---------- */
const screens = {
  async overview() {
    const s = await call({ path: 'status' });
    const memUsed = s.memory.totalBytes - s.memory.freeBytes;
    const load = s.load[0] ?? 0;
    const memPct = (memUsed / s.memory.totalBytes) * 100;
    cardIndex = 0;
    const cards = [
      stat({ title: 'CPU load', value: load.toFixed(2), hint: `${s.load[1] != null ? '5 min avg ' + s.load[1].toFixed(2) : '5 min avg n/a'} · ${s.cpuCores} cores`,
        icon: 'cpu', grad: 'g-red', pct: (load / s.cpuCores) * 100 }),
      stat({ title: 'Memory', value: fmtBytes(memUsed), hint: `${memPct.toFixed(0)}% of ${fmtBytes(s.memory.totalBytes)}`,
        tone: memPct > 85 ? 'warn' : '', icon: 'memory', grad: 'g-violet', pct: memPct }),
    ];
    if (s.storage) {
      const usedPct = (s.storage.usedKb / s.storage.totalKb) * 100;
      cards.push(stat({ title: 'Storage', value: fmtBytes(s.storage.freeKb * 1024), hint: `${usedPct.toFixed(1)}% used of ${fmtBytes(s.storage.totalKb * 1024)}`,
        tone: usedPct > 90 ? 'warn' : '', icon: 'files', grad: 'g-emerald', pct: usedPct }));
    } else cards.push(stat({ title: 'Storage', value: 'n/a', hint: 'Not reported', icon: 'files', grad: 'g-emerald' }));
    if (s.battery) {
      const charging = /^(charging|full)$/i.test(s.battery.status);
      cards.push(stat({ title: 'Battery', value: `${s.battery.percentage}%`,
        hint: `${charging ? 'Charging' : 'On battery'} · ${Number(s.battery.temperature).toFixed(1)}°C`,
        tone: s.battery.temperature >= 40 ? 'warn' : charging ? 'good' : '', icon: 'battery', grad: 'g-amber' }));
    } else cards.push(stat({ title: 'Battery', value: 'n/a', hint: 'Install Termux:API', icon: 'battery', grad: 'g-amber' }));
    cards.push(stat({ title: 'Uptime', value: fmtDur(s.uptimeSec), hint: 'Since last restart', icon: 'clock', grad: 'g-blue' }));
    return h('div', { class: 'grid' }, cards);
  },

  async files() {
    const path = state.filesPath;
    const d = await call({ path: 'files/list', query: { path } });
    const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const mk = h('input', { placeholder: 'New folder name', 'aria-label': 'New folder name' });
    const rows = (d.entries || []).map((e) => h('div', { class: 'row' },
      e.type === 'dir'
        ? h('button', { class: 'linkish', onclick: () => { state.filesPath = path ? `${path}/${e.name}` : e.name; load(); } },
          h('span', { class: 'file-ic' }, icon('files')), h('span', { class: 'name' }, e.name))
        : h('div', { class: 'linkish' }, h('span', { class: 'file-ic' }, icon('fileDoc')), h('span', { class: 'name' }, e.name)),
      h('span', { class: 'size' }, e.type === 'dir' ? '' : fmtBytes(e.size)),
      e.type === 'dir' ? null : h('button', { class: 'btn', onclick: () => act(async () => {
        const r = await window.samsung.saveFile(path ? `${path}/${e.name}` : e.name);
        if (!r.ok && r.error !== 'cancelled') throw new Error(r.error);
      }) }, 'Save'),
      h('button', { class: 'btn danger', onclick: () => confirm(`Delete ${e.name}?`) && act(() => call({ method: 'DELETE', path: 'files', query: { path: path ? `${path}/${e.name}` : e.name } }), 'Deleted') }, 'Delete')));
    return h('div', { class: 'stack', style: 'display:grid;gap:14px' },
      h('div', { class: 'glass bar-tools appear' },
        h('div', { class: 'crumbs' }, '/' + path),
        h('div', { class: 'toolbar' },
          path ? h('button', { class: 'btn', onclick: () => { state.filesPath = up; load(); } }, 'Up') : null,
          mk, h('button', { class: 'btn primary', onclick: () => mk.value.trim() && act(() => call({ method: 'POST', path: 'files/mkdir', body: { path: path ? `${path}/${mk.value.trim()}` : mk.value.trim() } }), 'Folder created') }, 'New folder'))),
      rows.length ? panel(rows) : emptyPanel('This folder is empty', 'Create a folder to get started.'));
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
          h('div', { class: 'meta' }, `${i.status}${i.totalBytes ? ` · ${pct}% of ${fmtBytes(i.totalBytes)}` : ''}${i.speedBps ? ` · ${fmtBytes(i.speedBps)}/s` : ''}${i.error ? ' · ' + i.error : ''}`),
          i.totalBytes ? h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })) : null),
        ['active', 'queued', 'paused'].includes(i.status)
          ? h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: paused ? 'downloads/resume' : 'downloads/pause', body: { id: i.id } })) }, paused ? 'Resume' : 'Pause') : null,
        h('button', { class: 'btn danger', onclick: () => act(() => call({ method: 'DELETE', path: 'downloads', query: { id: i.id } })) }, 'Remove'));
    });
    return h('div', { style: 'display:grid;gap:14px' },
      h('div', { class: 'glass bar-tools appear' }, h('div', { class: 'toolbar' }, url, mode,
        h('button', { class: 'btn primary', onclick: () => url.value.trim() && act(() => call({ method: 'POST', path: 'downloads/add', body: { url: url.value.trim(), mode: mode.value } }), 'Added') }, 'Add'))),
      rows.length ? panel(rows) : emptyPanel('No downloads', 'Paste a link, magnet or video URL above.'));
  },

  async sites() {
    const d = await call({ path: 'sites/list' });
    if (!d.domain) return empty('Sites are off. Set SITES_DOMAIN on the server (see docs/SETUP.md).');
    const rows = (d.sites || []).map((s) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, s.hostname || s.name), h('div', { class: 'meta' }, `${s.files} files · ${fmtBytes(s.bytes)}`)),
      h('span', { class: 'pill ' + (s.enabled ? 'ok' : '') }, s.enabled ? 'on' : 'off'),
      h('button', { class: 'btn', onclick: () => act(async () => {
        const r = await call({ path: 'sites/check', query: { name: s.name } });
        toast(r.reachable ? `Reachable (${r.status})` : `Not reachable${r.error ? ': ' + r.error : ''}`);
      }) }, 'Check')));
    return rows.length ? panel(rows) : emptyPanel('No sites yet', 'Create one in the Android app.');
  },

  async vps() {
    const d = await call({ path: 'vps/list' });
    if (!d.engine) return empty('The VPS engine is not installed on the server (see agent/README-vps.md).');
    const rows = (d.items || []).map((v) => {
      const running = v.status === 'running';
      return h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, v.name || v.id), h('div', { class: 'meta' }, `${v.distroLabel || v.distro} · SSH port ${v.port}${v.step ? ' · ' + v.step : ''}${v.error ? ' · ' + v.error : ''}`)),
        h('span', { class: 'pill ' + (running ? 'ok' : v.status === 'error' ? 'bad' : '') }, v.status),
        h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: running ? 'vps/stop' : 'vps/start', body: { id: v.id } })) }, running ? 'Stop' : 'Start'));
    });
    return rows.length ? panel(rows) : emptyPanel('No VPS slices', 'Create one in the Android app.');
  },

  async pc() {
    const d = await call({ path: 'pc/list' });
    const rows = (d.items || []).map((p) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name || p.ip), h('div', { class: 'meta' }, `${p.ip} · ${p.mac}`)),
      h('span', { class: 'pill ' + (p.online ? 'ok' : '') }, p.online ? 'online' : 'offline'),
      h('button', { class: 'btn', onclick: () => act(() => call({ method: 'POST', path: 'pc/wake', body: { id: p.id } }), 'Wake signal sent') }, 'Turn on'),
      p.sshUser ? h('button', { class: 'btn danger', onclick: () => confirm(`Shut down ${p.name || p.ip}?`) && act(() => call({ method: 'POST', path: 'pc/shutdown', body: { id: p.id } }), 'Shutdown sent') }, 'Shut down') : null));
    return rows.length ? panel(rows) : emptyPanel('No PCs yet', 'Add PCs and set up shutdown in the Android app.');
  },
};

const TITLES = { overview: 'Overview', files: 'Files', downloads: 'Downloads', sites: 'Sites', vps: 'VPS', pc: 'My PC' };
const SUBTITLES = {
  overview: 'Live status of your Samsung server', files: 'Browse and manage files on the server', downloads: 'Links, torrents and videos',
  sites: 'Websites hosted on the phone', vps: 'Linux slices you can SSH into', pc: 'Wake and shut down your PCs',
};
const state = { tab: 'overview', filesPath: '', shown: null, lastOk: 0 };
let timer;

function setChip(kind, text) {
  const c = $('chip'); c.className = 'chip ' + kind; c.textContent = text;
}

async function load() {
  clearTimeout(timer);
  const tab = state.tab;
  $('title').textContent = TITLES[tab];
  $('subtitle').textContent = SUBTITLES[tab];
  for (const b of $('nav').querySelectorAll('button[data-tab]')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (state.shown !== tab && !state.lastOk) setChip('idle', 'Connecting');
  try {
    const el = await screens[tab]();
    if (tab !== state.tab) return;
    // Entrance animation only when the screen changes, not on every refresh.
    $('view').classList.toggle('steady', state.shown === tab);
    state.shown = tab;
    $('view').replaceChildren(el);
    $('banner').hidden = true;
    state.lastOk = Date.now();
    setChip('live', 'Live • updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (e) {
    if (tab !== state.tab) return;
    $('banner').textContent = e.message; $('banner').hidden = false;
    if (state.lastOk) setChip('stale', 'Stale • updated ' + new Date(state.lastOk).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    else setChip('idle', 'Not connected');
  }
  if (tab === 'overview' || tab === 'downloads') timer = setTimeout(load, 5000);
}

function buildNav() {
  const nav = $('nav');
  for (const t of Object.keys(TITLES)) {
    nav.append(h('button', { class: 'tab', type: 'button', 'data-tab': t, 'aria-label': TITLES[t], onclick: () => { state.tab = t; load(); } }, icon(t), h('span', {}, TITLES[t])));
  }
  const out = $('signout');
  out.append(icon('logout'), h('span', {}, 'Sign out'));
  out.setAttribute('aria-label', 'Sign out');
  out.addEventListener('click', async () => { await window.samsung.signOut(); location.reload(); });
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
          $('found').hidden = false; $('manual').hidden = true; clearInterval(poll); poll = null;
        }
      } catch {} finally { looking = false; }
    };
    let poll = setInterval(look, 3000);
    look();
    $('useFound').addEventListener('click', async () => {
      try { await window.samsung.usePair(); location.reload(); }
      catch (e) { $('loginErr').textContent = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
    });
    $('skipFound').addEventListener('click', () => { dismissed = true; $('found').hidden = true; $('manual').hidden = false; if (poll) { clearInterval(poll); poll = null; } });
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
