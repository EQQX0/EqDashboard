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
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
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

// Toast stack: toast(msg) is an info toast, toast(msg, 'success' | 'error') picks the kind.
// Queue rules (coalescing, max 3, durations) live in toast-logic.js; this part only touches the DOM.
const TOAST_ICONS = {
  success: ['M20 6 9 17l-5-5'],
  error: ['M12 8v4', 'M12 16h.01', 'M12 3 2 20h20L12 3z'],
  info: ['M12 16v-4', 'M12 8h.01', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
};
function toastSvg(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  for (const d of TOAST_ICONS[name]) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); s.append(p);
  }
  return s;
}
const toasts = new Map(); // id -> { el, timer, remaining, started, hover, focus }
let toastList = [], toastSeq = 0;
const toastDeps = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (x) => clearTimeout(x), now: () => Date.now() };
function toastArm(t, id) { ToastLogic.armToast(t, () => dismissToast(id), toastDeps); }
function toastPause(t) { ToastLogic.pauseToast(t, toastDeps); }
function dismissToast(id) {
  const t = toasts.get(id);
  if (!t) return;
  toasts.delete(id); clearTimeout(t.timer);
  toastList = ToastLogic.removeToast(toastList, id);
  t.el.classList.add('out'); t.el.classList.remove('in');
  // Timeout, not transitionend: with reduced motion no transition runs and the event never fires.
  setTimeout(() => t.el.remove(), 160);
}
function toast(msg, kind) {
  msg = String(msg);
  const id = ++toastSeq;
  const r = ToastLogic.pushToast(toastList, { id, msg, kind });
  toastList = r.list;
  if (r.coalesced != null) { // same message again: keep the toast, restart its timer
    const t = toasts.get(r.coalesced);
    if (t) { t.remaining = ToastLogic.durationFor(t.kind); toastArm(t, r.coalesced); }
    return;
  }
  const k = ToastLogic.normKind(kind);
  const x = h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss' }, toastSvg('close'));
  const el = h('div', { class: 'toast ' + k, role: k === 'error' ? 'alert' : null },
    h('span', { class: 'toast-ic' }, toastSvg(k)), h('p', { class: 'toast-msg' }, msg), x);
  const t = { el, kind: k, timer: null, remaining: ToastLogic.durationFor(k), started: 0, hover: false, focus: false };
  toasts.set(id, t);
  x.addEventListener('click', () => dismissToast(id));
  el.addEventListener('mouseenter', () => { t.hover = true; toastPause(t); });
  el.addEventListener('mouseleave', () => { t.hover = false; toastArm(t, id); });
  el.addEventListener('focusin', () => { t.focus = true; toastPause(t); });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) { t.focus = false; toastArm(t, id); } });
  $('toasts').append(el);
  void el.offsetWidth; // commit the start state so the enter transition runs
  el.classList.add('in');
  toastArm(t, id);
  for (const old of r.dropped) dismissToast(old);
}
// Escape closes the newest toast, unless a dialog is open (it owns Escape) or something already handled the key.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  const id = ToastLogic.newestId(toastList);
  if (id != null) dismissToast(id);
});

// The toast stack is a manual popover, so it lives in the top layer. Showing it again puts it above any dialog opened since.
function raiseToasts() {
  const el = $('toasts');
  if (!el || typeof el.showPopover !== 'function') return;
  try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch {}
}
raiseToasts();

async function call(req) {
  const r = await window.samsung.api(req);
  if (r.ok) return r.data;
  if (r.status === 401) { await window.samsung.signOut(); location.reload(); }
  throw new Error(r.error);
}
// Run an action, show errors as toasts, then redraw.
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg, 'success'); } catch (e) { toast(e.message, 'error'); }
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

/* ---------- site dialogs ---------- */
// A native <dialog> gives focus trapping and Escape for free. It lives on body so list redraws do not close it.
function openDialog(title, ...kids) {
  const dlg = h('dialog', { class: 'glass modal', 'aria-label': title }, h('h3', {}, title), ...kids);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  raiseToasts(); // the toast layer was opened earlier, so it sits under this dialog until it is re-shown
  return dlg;
}
function newSiteDialog(domain) {
  const SL = window.SitesLogic;
  const input = h('input', { id: 'siteName', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'siteHelp siteAddr', placeholder: 'my-blog' });
  const spa = h('input', { type: 'checkbox', id: 'siteSpa' });
  const err = h('div', { class: 'err', id: 'siteHelp', role: 'alert' });
  const addr = h('div', { class: 'crumbs', id: 'siteAddr' }, 'Address: ' + SL.siteAddress('', domain));
  const create = h('button', { class: 'btn primary touch', type: 'submit' }, 'Create');
  const cancel = h('button', { class: 'btn touch', type: 'button' }, 'Cancel');
  const form = h('form', {}, h('label', { for: 'siteName' }, 'Site name'), input, err, addr,
    h('label', { class: 'check', for: 'siteSpa' }, spa, 'Single-page app (serve index.html for unknown paths)'),
    h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, cancel, create));
  const dlg = openDialog('New site', form);
  cancel.addEventListener('click', () => dlg.close());
  let touched = false;
  const refresh = () => {
    const e = touched ? SL.validateSiteName(input.value) : '';
    err.textContent = e; input.setAttribute('aria-invalid', e ? 'true' : 'false');
    addr.textContent = 'Address: ' + SL.siteAddress(input.value, domain);
  };
  input.addEventListener('input', () => { touched = true; refresh(); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); touched = true;
    const name = input.value.trim();
    if (SL.validateSiteName(name)) { refresh(); input.focus(); return; }
    create.disabled = true; create.textContent = 'Creating...';
    try {
      await call({ method: 'POST', path: 'sites/create', body: { name, spa: spa.checked } });
      dlg.close(); toast(`Created ${name}.${domain}`, 'success'); load();
    } catch (e) {
      err.textContent = SL.siteErrorText(e.message, 'Could not create the site');
      create.disabled = false; create.textContent = 'Create'; input.focus();
    }
  });
  input.focus();
}
function deleteSiteDialog(name, siteAct) {
  const del = h('button', { class: 'btn primary touch', type: 'button' }, 'Move to trash');
  const cancel = h('button', { class: 'btn touch', type: 'button' }, 'Cancel');
  const dlg = openDialog(`Move ${name} to trash?`,
    h('p', { class: 'muted' }, 'The site goes offline now. Its files are kept in the server trash folder, so they can be restored.'),
    h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, cancel, del));
  cancel.addEventListener('click', () => dlg.close());
  del.addEventListener('click', () => { dlg.close(); siteAct(() => call({ method: 'DELETE', path: 'sites', query: { name } }), `Moved ${name} to trash`); });
  cancel.focus();
}

/* ---------- shared dialogs for Files, VPS and My PC ---------- */
// Confirm before anything destructive. Cancel has the focus so Enter does not confirm by accident.
function confirmDialog(title, text, label, onConfirm) {
  const ok = h('button', { class: 'btn primary touch', type: 'button' }, label);
  const cancel = h('button', { class: 'btn touch', type: 'button' }, 'Cancel');
  const dlg = openDialog(title, h('p', { class: 'muted' }, text),
    h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, cancel, ok));
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', () => { dlg.close(); onConfirm(); });
  cancel.focus();
}
// Shows a secret once (a new VPS password) with a Copy button.
function secretDialog(title, text, secret) {
  const box = h('input', { readonly: true, value: secret, 'aria-label': 'Password', class: 'mono', spellcheck: 'false' });
  const copy = h('button', { class: 'btn touch', type: 'button' }, 'Copy');
  const done = h('button', { class: 'btn primary touch', type: 'button' }, 'Done');
  const dlg = openDialog(title, h('p', { class: 'muted' }, text), box,
    h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, copy, done));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(secret); toast('Copied', 'success'); } catch { box.select(); toast('Select the text and copy it'); }
  });
  done.addEventListener('click', () => dlg.close());
  box.select();
}
// A labelled field with its own error line. validate() returns '' or the message.
function field(id, label, input, validate, help) {
  input.id = id;
  const err = h('div', { class: 'err', id: id + 'Err', role: 'alert' });
  input.setAttribute('aria-describedby', id + 'Err');
  const show = (on) => { const e = on ? validate(input.value) : ''; err.textContent = e; input.setAttribute('aria-invalid', e ? 'true' : 'false'); return e; };
  input.addEventListener('input', () => { if (input.dataset.touched) show(true); });
  input.addEventListener('blur', () => { input.dataset.touched = '1'; show(true); });
  return {
    el: h('div', {}, h('label', { for: id }, label), input, err, help ? h('div', { class: 'crumbs' }, help) : null),
    check: () => { input.dataset.touched = '1'; return show(true); },
    input,
  };
}
// Builds a dialog around fields. submit(dlg) performs the request and throws an Error whose message is already worded.
function formDialog({ title, intro, fields, label, busy, submit }) {
  const formErr = h('div', { class: 'err', role: 'alert' });
  const go = h('button', { class: 'btn primary touch', type: 'submit' }, label);
  const cancel = h('button', { class: 'btn touch', type: 'button' }, 'Cancel');
  const form = h('form', { novalidate: true }, intro ? h('p', { class: 'muted' }, intro) : null, ...fields.map((f) => f.el), formErr,
    h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, cancel, go));
  const dlg = openDialog(title, form);
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bad = fields.filter((f) => f.check());
    if (bad.length) { bad[0].input.focus(); return; }
    go.disabled = true; go.textContent = busy; formErr.textContent = '';
    try { await submit(dlg); } catch (e) { formErr.textContent = e.message; go.disabled = false; go.textContent = label; }
  });
  const first = fields.find((f) => f.input.tagName !== 'SELECT') || fields[0];
  if (first) first.input.focus();
  return dlg;
}

function newVpsDialog(distros) {
  const ML = window.ManageLogic;
  const list = distros && distros.length ? distros : [{ id: 'debian', label: 'Debian' }, { id: 'ubuntu', label: 'Ubuntu' }, { id: 'alpine', label: 'Alpine Linux' }];
  const name = field('vpsName', 'Name', h('input', { autocomplete: 'off', spellcheck: 'false', placeholder: 'dev1' }), ML.validateVpsName);
  const distro = field('vpsDistro', 'Linux', h('select', {}, list.map((d) => h('option', { value: d.id }, d.label || d.id))), () => '');
  const key = field('vpsKey', 'SSH public key (optional)', h('textarea', { rows: '3', spellcheck: 'false', placeholder: 'ssh-ed25519 AAAA...' }), ML.validateSshKey,
    'With a key the slice only accepts key logins. Leave it empty to get a password.');
  formDialog({
    title: 'New VPS slice', label: 'Create', busy: 'Creating...', fields: [name, distro, key],
    submit: async (dlg) => {
      const n = name.input.value.trim(), k = key.input.value.trim();
      let r;
      try {
        r = await call({ method: 'POST', path: 'vps/create', body: Object.assign({ name: n, distro: distro.input.value }, k ? { sshKey: k } : {}) });
      } catch (e) { throw new Error(ML.vpsErrorText(e.message, 'Could not create the slice')); }
      dlg.close(); load();
      if (r.password) secretDialog('Root password', `Save it now, it is shown once. ${n} is being set up and starts by itself.`, r.password);
      else toast(`${n} is being set up. Log in with your SSH key`, 'success');
    },
  });
}

function addPcDialog() {
  const ML = window.ManageLogic;
  const name = field('pcName', 'Name', h('input', { autocomplete: 'off', placeholder: 'Gaming PC' }), ML.validatePcName);
  const mac = field('pcMac', 'MAC address', h('input', { autocomplete: 'off', spellcheck: 'false', placeholder: 'AA:BB:CC:DD:EE:FF' }), ML.validateMac);
  const ip = field('pcIp', 'Local IP address', h('input', { autocomplete: 'off', inputmode: 'decimal', placeholder: '192.168.1.20' }), ML.validateIp);
  const user = field('pcUser', 'Windows user (optional, needed to shut down)', h('input', { autocomplete: 'off', spellcheck: 'false' }), (v) => ML.validatePcUser(v, false));
  const port = field('pcPort', 'SSH port (optional)', h('input', { autocomplete: 'off', inputmode: 'numeric', placeholder: '22' }), ML.validatePort);
  formDialog({
    title: 'Add a PC', label: 'Add', busy: 'Adding...', fields: [name, mac, ip, user, port],
    submit: async (dlg) => {
      const body = { name: name.input.value.trim(), mac: ML.normMac(mac.input.value), ip: ip.input.value.trim(), sshUser: user.input.value.trim() };
      if (port.input.value.trim()) body.sshPort = Number(port.input.value.trim());
      try { await call({ method: 'POST', path: 'pc/add', body }); } catch (e) { throw new Error(ML.pcErrorText(e.message, 'Could not add the PC')); }
      dlg.close(); toast(`Added ${body.name}`, 'success'); load();
    },
  });
}

function setUserDialog(p) {
  const ML = window.ManageLogic;
  const user = field('pcUser', 'Windows user name', h('input', { autocomplete: 'off', spellcheck: 'false', value: p.sshUser || '' }), (v) => ML.validatePcUser(v, true));
  formDialog({
    title: `Windows user for ${p.name || p.ip}`, label: 'Save', busy: 'Saving...', fields: [user],
    submit: async (dlg) => {
      try { await call({ method: 'POST', path: 'pc/user', body: { id: p.id, sshUser: user.input.value.trim() } }); } catch (e) { throw new Error(ML.pcErrorText(e.message, 'Could not save')); }
      dlg.close(); toast('Windows user saved', 'success'); load();
    },
  });
}

// Shutdown setup: the server's public SSH key goes into the PC's authorized_keys, then a Windows user is set.
function shutdownSetupDialog(p) {
  const key = h('textarea', { readonly: true, rows: '3', class: 'mono', 'aria-label': 'Server public key', spellcheck: 'false' }, 'Loading the server key...');
  const copy = h('button', { class: 'btn touch', type: 'button', disabled: true }, 'Copy key');
  const user = h('button', { class: 'btn touch', type: 'button' }, 'Set Windows user');
  const done = h('button', { class: 'btn primary touch', type: 'button' }, 'Done');
  const dlg = openDialog(`Shut down setup for ${p.name || p.ip}`,
    h('p', { class: 'muted' }, "On the PC, turn on OpenSSH Server and add this key to the user's authorized_keys (for an administrator account: C:\\ProgramData\\ssh\\administrators_authorized_keys). Then set the Windows user here."),
    key, h('div', { class: 'toolbar', style: 'margin-top:16px;justify-content:flex-end' }, copy, user, done));
  let text = '';
  call({ method: 'POST', path: 'pc/key', body: {} }).then((r) => {
    text = r.key || ''; key.value = text || 'No key available'; copy.disabled = !text;
  }).catch((e) => { key.value = window.ManageLogic.pcErrorText(e.message, 'Could not get the key'); });
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Key copied', 'success'); } catch { key.select(); toast('Select the text and copy it'); } });
  user.addEventListener('click', () => { dlg.close(); setUserDialog(p); });
  done.addEventListener('click', () => dlg.close());
}

function lightsDialog(p) {
  const ML = window.ManageLogic;
  const url = field('pcLights', 'EqRGB phone-remote link', h('input', { autocomplete: 'off', spellcheck: 'false', placeholder: `http://${p.ip}:47822/?t=...` }), (v) => ML.validateLightsUrl(v, p.ip),
    p.hasLights ? 'A link is saved. Paste a new one to replace it, or save it empty to remove it.' : 'Copy it from EqRGB on the PC.');
  formDialog({
    title: `Lights for ${p.name || p.ip}`, label: 'Save', busy: 'Saving...', fields: [url],
    submit: async (dlg) => {
      try { await call({ method: 'POST', path: 'pc/lights', body: { id: p.id, url: url.input.value.trim() } }); } catch (e) { throw new Error(ML.pcErrorText(e.message, 'Could not save')); }
      dlg.close(); toast(url.input.value.trim() ? 'Lights link saved' : 'Lights link removed', 'success'); load();
    },
  });
}

function renameDialog(dir, entry) {
  const ML = window.ManageLogic;
  const name = field('renameTo', 'New name', h('input', { autocomplete: 'off', spellcheck: 'false', value: entry.name }),
    (v) => ML.validateEntryName(v) || (v === entry.name ? 'Choose a different name' : ''));
  formDialog({
    title: `Rename ${entry.name}`, label: 'Rename', busy: 'Renaming...', fields: [name],
    submit: async (d) => {
      try { await call({ method: 'POST', path: 'files/rename', body: { from: ML.joinPath(dir, entry.name), to: ML.joinPath(dir, name.input.value) } }); } catch (e) { throw new Error(ML.filesErrorText(e.message, 'Could not rename')); }
      d.close(); toast('Renamed', 'success'); load();
    },
  });
  name.input.select();
}

/* ---------- agent update ---------- */
// Checking asks GitHub through the agent, so it only runs on a click, never on the 5 second refresh.
function agentUpdatePanel() {
  const ML = window.ManageLogic;
  const u = state.agentUpdate;
  const run = (fn) => async () => { state.agentUpdate = { busy: true }; load(); try { state.agentUpdate = await fn(); } catch (e) { state.agentUpdate = { error: ML.updateErrorText(e.message, 'Update failed') }; } load(); };
  const check = run(async () => ({ info: await call({ path: 'agent/update' }) }));
  const apply = () => confirmDialog('Update the server agent?', 'The agent downloads the newest release and restarts. The app is unreachable for a few seconds.', 'Update',
    run(async () => {
      const r = await call({ method: 'POST', path: 'agent/update', body: {} });
      return { done: r.updated ? `Updated ${r.from} to ${r.to}. The agent is restarting` : 'Already up to date' };
    }));
  let text = 'Check whether a newer agent is available.';
  if (u && u.busy) text = 'Working, keep this window open...';
  else if (u && u.error) text = u.error;
  else if (u && u.done) text = u.done;
  else if (u && u.info) text = ML.updateSummary(u.info);
  const busy = !!(u && u.busy);
  return h('div', { class: 'glass bar-tools appear' }, h('div', { class: 'toolbar' },
    h('div', { class: 'grow', style: 'flex:1' }, h('div', { class: 'name' }, 'Server agent'), h('div', { class: 'meta', role: 'status' }, text)),
    h('button', { class: 'btn touch', type: 'button', disabled: busy, onclick: check }, 'Check for update'),
    u && u.info && u.info.available ? h('button', { class: 'btn primary touch', type: 'button', disabled: busy, onclick: apply }, 'Update now') : null));
}

/* ---------- Windows app update ---------- */
// Checks GitHub from the main process. The renderer never supplies a URL or a path.
function winUpdatePanel() {
  const u = state.winUpdate;
  const busy = !!(u && u.busy);
  const info = u && u.info;
  const setState = (v) => { state.winUpdate = v; load(); };
  const check = async () => {
    setState({ busy: 'check' });
    try {
      const r = await window.samsung.checkUpdate();
      if (!r.ok) { setState({ error: r.error }); toast(r.error, 'error'); return; }
      setState({ info: r });
    } catch (e) { const m = 'Could not check for updates'; setState({ error: m }); toast(m, 'error'); }
  };
  const install = async () => {
    setState({ busy: 'install', info });
    try {
      const r = await window.samsung.installUpdate();
      if (!r.ok) { setState({ error: r.error, info }); toast(r.error, 'error'); return; }
      setState({ done: 'Installer started. The app is closing...', info });
    } catch (e) { const m = 'Update failed'; setState({ error: m, info }); toast(m, 'error'); }
  };
  const ask = () => confirmDialog(`Install version ${info.latest}?`,
    `The installer is downloaded (${fmtBytes(info.size)}), ${info.verified ? 'checked against its checksum' : 'but its checksum is not published, so it cannot be verified'}, and then started. This app closes while it installs.`,
    'Download and install', install);
  let text = 'Check whether a newer version is available.';
  if (busy) text = u.busy === 'install' ? 'Downloading the installer, keep this window open...' : 'Checking...';
  else if (u && u.error) text = u.error;
  else if (u && u.done) text = u.done;
  else if (info) text = info.available ? `Version ${info.latest} is available (you have ${info.current}).` : `You are up to date (${info.current}).`;
  const available = !!(info && info.available);
  return h('div', { class: 'glass bar-tools appear' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow', style: 'flex:1' },
        h('div', { class: 'name' }, 'Windows app update ', available ? h('span', { class: 'chip live' }, 'Update available') : null),
        h('div', { class: 'meta', role: 'status' }, text)),
      h('button', { class: 'btn touch', type: 'button', disabled: busy, onclick: check }, busy === 'check' ? 'Checking...' : 'Check for update'),
      available ? h('button', { class: 'btn primary touch', type: 'button', disabled: busy, onclick: ask }, busy === 'install' ? 'Installing...' : 'Download and install') : null),
    available && info.notes ? h('pre', { class: 'meta', style: 'white-space:pre-wrap;margin:10px 0 0;max-height:160px;overflow:auto;font-family:inherit' }, info.notes) : null,
    available && !info.verified ? h('div', { class: 'meta', style: 'margin-top:6px' }, 'Unverified: no checksum is published for this installer.') : null);
}

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
    return h('div', { style: 'display:grid;gap:14px' }, h('div', { class: 'grid' }, cards), agentUpdatePanel(), winUpdatePanel());
  },

  async files() {
    if (state.filesView === 'trash') return trashView();
    const ML = window.ManageLogic;
    const path = state.filesPath;
    const d = await call({ path: 'files/list', query: { path } });
    const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const mk = h('input', { placeholder: 'New folder name', 'aria-label': 'New folder name' });
    const mkFolder = () => {
      const n = mk.value.trim();
      const bad = ML.validateEntryName(n);
      if (bad) { toast(bad, 'error'); return; }
      act(async () => { try { await call({ method: 'POST', path: 'files/mkdir', body: { path: ML.joinPath(path, n) } }); } catch (e) { throw new Error(ML.filesErrorText(e.message)); } }, 'Folder created');
    };
    const uploading = state.uploading;
    const upload = async () => {
      state.uploading = true; load();
      let msg = '', kind = 'error';
      try {
        const r = await window.samsung.uploadFile(path);
        if (r.ok) { msg = `Uploaded ${r.file} (${fmtBytes(r.size)})`; kind = 'success'; }
        else if (r.error !== 'cancelled') msg = ML.filesErrorText(r.error, 'Upload failed');
      } catch (e) { msg = String(e.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
      state.uploading = false;
      if (msg) toast(msg, kind);
      load();
    };
    const rows = (d.entries || []).map((e) => h('div', { class: 'row' },
      e.type === 'dir'
        ? h('button', { class: 'linkish', onclick: () => { state.filesPath = ML.joinPath(path, e.name); load(); } },
          h('span', { class: 'file-ic' }, icon('files')), h('span', { class: 'name' }, e.name))
        : h('div', { class: 'linkish' }, h('span', { class: 'file-ic' }, icon('fileDoc')), h('span', { class: 'name' }, e.name)),
      h('span', { class: 'size' }, e.type === 'dir' ? '' : fmtBytes(e.size)),
      e.type === 'dir' ? null : h('button', { class: 'btn', 'aria-label': `Save ${e.name}`, onclick: () => act(async () => {
        const r = await window.samsung.saveFile(ML.joinPath(path, e.name));
        if (!r.ok && r.error !== 'cancelled') throw new Error(r.error);
      }) }, 'Save'),
      h('button', { class: 'btn', 'aria-label': `Rename ${e.name}`, onclick: () => renameDialog(path, e) }, 'Rename'),
      h('button', { class: 'btn danger', 'aria-label': `Delete ${e.name}`, onclick: () => confirmDialog(`Delete ${e.name}?`,
        'It moves to the recycle bin (kept 30 days) and can be restored from there.', 'Move to recycle bin',
        () => act(() => call({ method: 'DELETE', path: 'files', query: { path: ML.joinPath(path, e.name) } }), 'Moved to recycle bin (kept 30 days)')) }, 'Delete')));
    return h('div', { class: 'stack', style: 'display:grid;gap:14px' },
      h('div', { class: 'glass bar-tools appear' },
        h('div', { class: 'crumbs' }, '/' + path),
        h('div', { class: 'toolbar' },
          path ? h('button', { class: 'btn', onclick: () => { state.filesPath = up; load(); } }, 'Up') : null,
          h('button', { class: 'btn', type: 'button', disabled: !!uploading, onclick: upload }, uploading ? 'Uploading...' : 'Upload file'),
          h('button', { class: 'btn with-ic', type: 'button', onclick: () => { state.filesView = 'trash'; load(); } }, icon('trash'), 'Recycle bin'),
          mk, h('button', { class: 'btn primary', onclick: mkFolder }, 'New folder')),
        uploading ? h('div', { class: 'meta' }, 'Uploading, keep this window open...') : null),
      rows.length ? panel(rows) : emptyPanel('This folder is empty', 'Upload a file or create a folder to get started.'));
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
    // Apps routed through the tunnel but not managed here (gym, downloader...). Older agents answer 404, so ignore errors.
    let others = [];
    try {
      const t = await call({ path: 'tunnel/routes' });
      others = (t.routes || []).filter((r) => r.kind === 'app' && !String(r.hostname).startsWith('*.'));
    } catch (e) { if (/not allowed/i.test(String(e && e.message))) throw e; /* otherwise an older agent: hide */ }
    const parts = [];
    if (!d.domain) {
      parts.push(emptyPanel('Sites are off', 'Set SITES_DOMAIN on the server (see docs/SETUP.md).'));
    } else {
      const SL = window.SitesLogic;
      const newBtn = () => h('button', { class: 'btn primary touch', type: 'button', onclick: () => newSiteDialog(d.domain) }, 'New site');
      const siteAct = (fn, okMsg) => act(async () => { try { await fn(); } catch (e) { throw new Error(SL.siteErrorText(e.message)); } }, okMsg);
      const rows = (d.sites || []).map((s) => {
        const host = s.hostname || `${s.name}.${d.domain}`;
        const busy = state.deploying === s.name;
        const B = (label, extra, fn) => h('button', Object.assign({ class: 'btn touch', type: 'button', disabled: !!state.deploying, onclick: fn }, extra), label);
        return h('div', { class: 'row site' },
          h('div', { class: 'grow' },
            h('div', { class: 'name' }, host),
            h('div', { class: 'meta' }, busy ? 'Uploading zip, keep this window open...' : `${s.files} files · ${fmtBytes(s.bytes)}${s.spa ? ' · single-page mode' : ''}`)),
          h('span', { class: 'pill ' + (s.enabled ? 'ok' : '') }, s.enabled ? 'On' : 'Off'),
          h('div', { class: 'actions' },
            B('Open', { 'aria-label': `Open ${host} in browser` }, () => window.samsung.openUrl('https://' + host)),
            B('Check', { 'aria-label': `Check ${host} is reachable` }, () => act(async () => {
              const r = await call({ path: 'sites/check', query: { name: s.name } });
              toast(r.reachable ? `Reachable (${r.status})` : `Not reachable${r.error ? ': ' + r.error : ''}`, r.reachable ? 'success' : 'error');
            })),
            B(busy ? 'Uploading...' : 'Deploy zip', { 'aria-label': `Deploy a zip to ${host}` }, async () => {
              state.deploying = s.name; load();
              let msg = '', kind = 'error';
              try {
                const r = await window.samsung.deploySite(s.name);
                if (r.ok) kind = 'success';
                if (r.ok) msg = `Deployed ${r.data.files ?? ''} files${r.data.bytes != null ? ' (' + fmtBytes(r.data.bytes) + ')' : ''} to ${s.name}`.replace('Deployed  files', 'Deployed');
                else if (r.error !== 'cancelled') msg = SL.siteErrorText(r.error, 'Deploy failed');
              } catch (e) { msg = SL.siteErrorText(String(e.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), 'Deploy failed'); }
              state.deploying = null;
              if (msg) toast(msg, kind);
              load();
            }),
            B(s.enabled ? 'Turn off' : 'Turn on', { 'aria-label': `${s.enabled ? 'Turn off' : 'Turn on'} ${host}` },
              () => siteAct(() => call({ method: 'POST', path: 'sites/update', body: { name: s.name, enabled: !s.enabled } }), `${s.name} ${s.enabled ? 'turned off' : 'turned on'}`)),
            B(s.spa ? 'Single-page: on' : 'Single-page: off', { 'aria-pressed': s.spa ? 'true' : 'false', 'aria-label': `Single-page mode for ${host}` },
              () => siteAct(() => call({ method: 'POST', path: 'sites/update', body: { name: s.name, spa: !s.spa } }), `Single-page mode ${s.spa ? 'off' : 'on'} for ${s.name}`)),
            B('Delete', { class: 'btn touch danger', 'aria-label': `Delete ${host}` }, () => deleteSiteDialog(s.name, siteAct))));
      });
      parts.push(h('div', { class: 'glass bar-tools appear' }, h('div', { class: 'toolbar' },
        h('div', { class: 'grow meta', style: 'flex:1' }, `Sites appear at <name>.${d.domain}`), newBtn())));
      parts.push(rows.length ? panel(rows) : h('div', { class: 'glass panel pad empty appear' },
        h('h3', {}, 'No sites yet'),
        h('p', {}, `Create a site, then deploy a zip of your files to it. It will be live at name.${d.domain}.`),
        h('div', { style: 'margin-top:14px' }, newBtn())));
    }
    if (others.length) {
      parts.push(h('div', { class: 'meta', style: 'margin-top:6px' }, 'Other apps on your tunnel (status only)'));
      parts.push(panel(others.map((r) => h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, r.hostname), h('div', { class: 'meta' }, r.port ? `Local port ${r.port}` : r.service)),
        h('span', { class: 'pill ' + (r.up ? 'ok' : '') }, r.up === true ? 'Running' : r.up === false ? 'Not running' : 'Unknown'),
        h('button', { class: 'btn', onclick: () => window.samsung.openUrl('https://' + r.hostname) }, 'Open')))));
    }
    return h('div', { style: 'display:grid;gap:14px' }, ...parts);
  },

  async vps() {
    const ML = window.ManageLogic;
    const d = await call({ path: 'vps/list' });
    if (!d.engine) return empty('The VPS engine is not installed on the server (see agent/README-vps.md).');
    const items = d.items || [];
    const full = items.length >= (d.maxSlices || 4);
    const vact = (fn, okMsg) => act(async () => { try { await fn(); } catch (e) { throw new Error(ML.vpsErrorText(e.message)); } }, okMsg);
    const newBtn = () => h('button', { class: 'btn primary touch', type: 'button', disabled: full, onclick: () => newVpsDialog(d.distros) }, 'New slice');
    const rows = items.map((v) => {
      const running = v.status === 'running';
      const creating = v.status === 'creating';
      const label = v.name || v.id;
      const resetPw = () => confirmDialog(`Change the password for ${label}?`, 'A new root password is made and the old one stops working. It is shown once.', 'Change password',
        () => vact(async () => {
          const r = await call({ method: 'POST', path: 'vps/password', body: { id: v.id } });
          secretDialog('New root password', `Save it now, it is shown once. It replaces the old password for ${label}.`, r.password);
        }));
      return h('div', { class: 'row site' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, label),
          h('div', { class: 'meta' }, `${v.distroLabel || v.distro} · SSH port ${v.port}${v.authMode === 'key' ? ' · key only' : ''}${v.step ? ' · ' + v.step : ''}${v.error ? ' · ' + v.error : ''}`)),
        h('span', { class: 'pill ' + (running ? 'ok' : v.status === 'error' ? 'bad' : '') }, v.status),
        h('div', { class: 'actions' },
          h('button', { class: 'btn touch', type: 'button', disabled: creating, 'aria-label': `${running ? 'Stop' : 'Start'} ${label}`,
            onclick: () => vact(() => call({ method: 'POST', path: running ? 'vps/stop' : 'vps/start', body: { id: v.id } }), `${label} ${running ? 'stopped' : 'started'}`) }, running ? 'Stop' : 'Start'),
          v.authMode === 'key' ? null : h('button', { class: 'btn touch', type: 'button', disabled: creating, 'aria-label': `Change password of ${label}`, onclick: resetPw }, 'Change password')));
    });
    const head = h('div', { class: 'glass bar-tools appear' }, h('div', { class: 'toolbar' },
      h('div', { class: 'grow meta', style: 'flex:1' }, `${items.length} of ${d.maxSlices || 4} slices${d.host ? ' · host ' + d.host : ''}${d.freeBytes != null ? ' · ' + fmtBytes(d.freeBytes) + ' free' : ''}`), newBtn()));
    return h('div', { style: 'display:grid;gap:14px' }, head,
      rows.length ? panel(rows) : emptyPanel('No VPS slices', 'Create a slice to get your own Linux you can SSH into.'));
  },

  async pc() {
    const ML = window.ManageLogic;
    const d = await call({ path: 'pc/list' });
    const items = d.items || [];
    const pact = (fn, okMsg) => act(async () => { try { await fn(); } catch (e) { throw new Error(ML.pcErrorText(e.message)); } }, okMsg);
    const addBtn = () => h('button', { class: 'btn primary touch', type: 'button', disabled: items.length >= (d.maxPcs || 8), onclick: addPcDialog }, 'Add PC');
    const rows = items.map((p) => {
      const label = p.name || p.ip;
      const B = (text, extra, fn) => h('button', Object.assign({ class: 'btn touch', type: 'button', onclick: fn }, extra), text);
      return h('div', { class: 'row site' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, label),
          h('div', { class: 'meta' }, `${p.ip} · ${p.mac}${p.sshUser ? ' · user ' + p.sshUser : ''}`)),
        h('span', { class: 'pill ' + (p.online ? 'ok' : '') }, p.online ? 'online' : 'offline'),
        h('div', { class: 'actions' },
          B('Turn on', { 'aria-label': `Turn on ${label}` }, () => pact(() => call({ method: 'POST', path: 'pc/wake', body: { id: p.id } }), 'Wake signal sent')),
          p.sshUser ? B('Shut down', { class: 'btn touch danger', 'aria-label': `Shut down ${label}` }, () => confirmDialog(`Shut down ${label}?`,
            'The PC shuts down now. Anything unsaved on it is lost.', 'Shut down',
            () => pact(() => call({ method: 'POST', path: 'pc/shutdown', body: { id: p.id } }), 'Shutdown sent'))) : null,
          B(p.sshUser ? 'Shutdown setup' : 'Set up shutdown', { 'aria-label': `Shutdown setup for ${label}` }, () => shutdownSetupDialog(p)),
          B('Windows user', { 'aria-label': `Set the Windows user for ${label}` }, () => setUserDialog(p)),
          p.hasLights ? B('Open lights', { 'aria-label': `Open the lights remote for ${label}` }, () => pact(async () => {
            const r = await window.samsung.openLights(p.id);
            if (!r.ok) throw new Error(r.error);
          })) : null,
          B(p.hasLights ? 'Lights link' : 'Set up lights', { 'aria-label': `Lights link for ${label}` }, () => lightsDialog(p))));
    });
    const head = h('div', { class: 'glass bar-tools appear' }, h('div', { class: 'toolbar' },
      h('div', { class: 'grow meta', style: 'flex:1' }, `${items.length} of ${d.maxPcs || 8} PCs`), addBtn()));
    return h('div', { style: 'display:grid;gap:14px' }, head,
      rows.length ? panel(rows) : emptyPanel('No PCs yet', 'Add a PC to wake it from here, then set up shutdown.'));
  },
};

/* ---------- Recycle bin (Files sub-view) ---------- */
function trashView() {
  const TL = window.TrashLogic;
  const box = h('div', { style: 'display:grid;gap:14px' });
  const back = h('button', { class: 'btn with-ic touch', type: 'button', onclick: () => { state.filesView = 'files'; load(); } }, icon('back'), 'Back to Files');
  const head = (note, extra) => h('div', { class: 'glass bar-tools appear' },
    h('div', { class: 'toolbar' }, back, h('h2', { class: 'trash-title' }, 'Recycle bin'), extra || null),
    h('p', { class: 'meta trash-note' }, note));
  const restore = async (item, body) => {
    const ML = window.ManageLogic;
    try {
      const r = await call({ method: 'POST', path: 'files/trash/restore', body: Object.assign({ id: item.id }, body) });
      toast(`Restored to ${r.path}`, 'success');
    } catch (e) {
      if (e.message === 'exists' && !body) {
        const kind = item.isDir ? 'folder' : 'file';
        confirmDialog(`Replace existing ${kind}?`,
          `A ${kind} named "${item.name}" already exists. Replacing it moves it to the recycle bin and restores this one.`, 'Replace', () => restore(item, { overwrite: true }));
        return;
      }
      if (e.message === 'exists' && !body.replaceType) {
        confirmDialog('Replace anyway?', 'One is a folder and the other a file. Replace anyway?', 'Replace', () => restore(item, { overwrite: true, replaceType: true }));
        return;
      }
      toast(ML.filesErrorText(e.message, 'Could not restore'), 'error');
    }
    load();
  };
  const draw = async () => {
    box.replaceChildren(head('Loading...'), h('div', { class: 'glass panel pad empty appear', role: 'status', 'aria-busy': 'true' },
      h('h3', {}, 'Loading recycle bin...')));
    let d;
    try { d = await call({ path: 'files/trash' }); } catch (e) {
      box.replaceChildren(head(''), h('div', { class: 'glass panel pad empty appear', role: 'alert' },
        h('h3', {}, 'Could not load the recycle bin'), h('p', {}, e.message),
        h('button', { class: 'btn primary touch', type: 'button', style: 'margin-top:12px', onclick: draw }, 'Try again')));
      return;
    }
    const now = Date.now();
    const items = (d.items || []).map((it) => TL.rowModel(it, now));
    const rows = items.map((m) => h('div', { class: 'row trash-row' },
      h('span', { class: 'file-ic' }, icon(m.isDir ? 'files' : 'fileDoc')),
      h('div', { class: 'grow' },
        h('div', { class: 'name', title: m.name }, m.name),
        h('div', { class: 'meta' }, [m.size == null ? 'Folder' : fmtBytes(m.size), m.deletedText, m.folder ? 'from ' + m.folder : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'meta left' + (m.urgent ? ' urgent' : '') }, m.leftText)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn touch', type: 'button', 'aria-label': `Restore ${m.name}`, onclick: () => restore(m, null) }, 'Restore'),
        h('button', { class: 'btn touch danger', type: 'button', 'aria-label': `Delete ${m.name} forever`, onclick: () => confirmDialog(`Delete ${m.name} forever?`,
          'It is removed from the server for good. This cannot be undone.', 'Delete forever',
          () => act(async () => { try { await call({ method: 'POST', path: 'files/trash/delete', body: { id: m.id } }); } catch (e) { throw new Error(window.ManageLogic.filesErrorText(e.message, 'Could not delete')); } }, 'Deleted forever')) }, 'Delete forever'))));
    const emptyBtn = items.length ? h('button', { class: 'btn touch danger', type: 'button', style: 'margin-left:auto', onclick: () => confirmDialog('Empty the recycle bin?',
      `All ${items.length} ${items.length === 1 ? 'item' : 'items'} will be deleted forever. This cannot be undone.`, 'Empty recycle bin',
      () => act(async () => { let r; try { r = await call({ method: 'POST', path: 'files/trash/empty' }); } catch (e) { throw new Error(window.ManageLogic.filesErrorText(e.message, 'Could not empty the recycle bin')); } toast(`Removed ${r.removed ?? items.length} ${(r.removed ?? items.length) === 1 ? 'item' : 'items'} forever`, 'success'); })) }, 'Empty recycle bin') : null;
    box.replaceChildren(head(TL.headerText(d.days), emptyBtn), items.length ? panel(rows) : emptyPanel('Recycle bin is empty', 'Files you delete in the Files tab show up here.'));
  };
  draw();
  return box;
}

const TITLES = { overview: 'Overview', files: 'Files', downloads: 'Downloads', sites: 'Sites', vps: 'VPS', pc: 'My PC' };
const SUBTITLES = {
  overview: 'Live status of your Samsung server', files: 'Browse and manage files on the server', downloads: 'Links, torrents and videos',
  sites: 'Websites hosted on the phone', vps: 'Linux slices you can SSH into', pc: 'Wake, shut down and light up your PCs',
};
const state = { tab: 'overview', filesPath: '', filesView: 'files', shown: null, lastOk: 0, deploying: null, uploading: false, agentUpdate: null, winUpdate: null, appVersion: '' };
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
      $('foundErr').textContent = '';
      try { await window.samsung.usePair(); location.reload(); }
      catch (e) { $('foundErr').textContent = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }
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
  // One quiet check at startup: no dialog, no error toast. A found update shows as a badge on Overview.
  window.samsung.checkUpdate().then((r) => { if (r && r.ok && !state.winUpdate) { state.winUpdate = { info: r }; if (state.tab === 'overview') load(); } }).catch(() => {});
}
boot();
