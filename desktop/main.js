'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Updater = require('./updater');
const { createApi, normalizeBase, parsePair, httpErrorMessage } = require('./api');
const { findPairFile } = require('./pairscan');
const { allowedOpenHost } = require('./openurl');
const { buildLightsUrl, sameOrigin } = require('./lights-url');
const SitesLogic = require('./renderer/sites-logic');
const ManageLogic = require('./renderer/manage-logic');

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

// The decrypted settings stay in memory; the file is read once and again only after writeCfg.
let cfgMemo = null;

function readCfg() {
  if (cfgMemo) return cfgMemo;
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    let token = '';
    if (c.token) {
      try { token = safeStorage.decryptString(Buffer.from(c.token, 'base64')); } catch { token = ''; }
    }
    cfgMemo = { baseUrl: c.baseUrl || '', token };
  } catch { cfgMemo = { baseUrl: '', token: '' }; }
  return cfgMemo;
}

function writeCfg(baseUrl, token) {
  const enc = token ? safeStorage.encryptString(token).toString('base64') : '';
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify({ baseUrl, token: enc }));
  cfgMemo = { baseUrl, token: token || '' };
}

const api = createApi({ getConfig: () => readCfg() });

let mainWin = null;
let lightsWin = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 760, minHeight: 520,
    backgroundColor: '#B91C1C', icon: path.join(__dirname, 'build', 'icon.png'), title: 'Samsung Server', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin = win;
  win.on('closed', () => { mainWin = null; });
}

// Modal child window for the EqRGB lights remote. No preload, its own session, and it can only stay on the lights origin.
function openLightsWindow(url) {
  const win = new BrowserWindow({
    parent: mainWin || undefined, modal: !!mainWin, width: 420, height: 640, minWidth: 320, minHeight: 420, resizable: true,
    title: 'Lights', autoHideMenuBar: true, backgroundColor: '#1A1013', show: false,
    webPreferences: { partition: 'persist:lights', sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, target) => { if (!sameOrigin(target, url)) e.preventDefault(); });
  win.webContents.on('will-redirect', (e, target) => { if (!sameOrigin(target, url)) e.preventDefault(); });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { lightsWin = null; });
  win.loadURL(url);
  lightsWin = win;
}

app.whenReady().then(() => {
  ipcMain.handle('cfg:get', () => { const c = readCfg(); return { baseUrl: c.baseUrl, signedIn: !!c.token }; });
  ipcMain.handle('cfg:set', (_e, baseUrl, token) => {
    const b = normalizeBase(baseUrl);
    if (!token || !String(token).trim()) throw new Error('Paste your token');
    writeCfg(b, String(token).trim());
    return true;
  });
  ipcMain.handle('cfg:import', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose the pairing file', properties: ['openFile'], filters: [{ name: 'Pairing file', extensions: ['pair'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 4096) throw new Error('That file is too large to be a pairing file');
    const p = parsePair(fs.readFileSync(r.filePaths[0], 'utf8'));
    writeCfg(p.url, p.token);
    return { ok: true };
  });
  const searchDirs = () => [...['downloads', 'desktop', 'documents'].map((n) => app.getPath(n)), path.join(app.getPath('downloads'), 'SamsungServer')];
  // Only reports that a pairing file exists (never the token), so the screen can offer it as a choice.
  // The screen asks every few seconds; scanning three folders each time would stall the window, so reuse a recent answer.
  let scanAt = 0;
  let scanHit = null;
  ipcMain.handle('cfg:find', () => {
    if (Date.now() - scanAt > 5000) { scanHit = findPairFile(searchDirs()); scanAt = Date.now(); }
    const hit = scanHit;
    if (!hit) return { found: false };
    return { found: true, name: path.basename(hit.file), folder: path.basename(path.dirname(hit.file)), host: new URL(hit.url).host };
  });
  // Signs in with the newest pairing file. The file is left where it is.
  ipcMain.handle('cfg:useFound', () => {
    const hit = findPairFile(searchDirs());
    if (!hit) throw new Error('The pairing file is gone');
    writeCfg(hit.url, hit.token);
    return { ok: true };
  });
  ipcMain.handle('cfg:clear', () => { const c = readCfg(); writeCfg(c.baseUrl, ''); return true; });
  ipcMain.handle('api', async (_e, req) => {
    try { return { ok: true, data: await api.call({ method: req.method, path: req.path, query: req.query, body: req.body }) }; } catch (e) { return { ok: false, error: e.message, status: e.status || 0 }; }
  });
  // Picks a .zip and uploads it as the body of sites/deploy. The renderer only supplies the site name.
  ipcMain.handle('sites:deploy', async (_e, name) => {
    name = String(name || '');
    if (SitesLogic.validateSiteName(name)) return { ok: false, error: 'bad_name' };
    const r = await dialog.showOpenDialog({ title: `Choose a zip for ${name}`, properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    const file = r.filePaths[0];
    try {
      const size = fs.statSync(file).size;
      if (size > SitesLogic.MAX_ZIP_BYTES) return { ok: false, error: 'too_large' };
      const data = await api.call({ method: 'POST', path: 'sites/deploy', query: { name }, rawBody: fs.readFileSync(file), contentType: 'application/zip' });
      return { ok: true, data, file: path.basename(file), size };
    } catch (e) { return { ok: false, error: e.code && !e.status && /^E[A-Z]+$/.test(e.code) ? 'file_unreadable' : e.message, status: e.status || 0 }; }
  });
  // Picks a file and streams it to files/upload in the given folder. The renderer only supplies the remote folder.
  ipcMain.handle('files:upload', async (_e, dir) => {
    dir = String(dir == null ? '' : dir);
    if (!ManageLogic.validateRemoteDir(dir)) return { ok: false, error: 'bad_path' };
    const r = await dialog.showOpenDialog({ title: 'Choose a file to upload', properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    const file = r.filePaths[0];
    const name = path.basename(file);
    if (ManageLogic.validateEntryName(name)) return { ok: false, error: 'bad_path' };
    let st;
    try { st = fs.statSync(file); } catch { return { ok: false, error: 'file_unreadable' }; }
    if (!st.isFile()) return { ok: false, error: 'bad_path' };
    if (st.size > ManageLogic.MAX_UPLOAD_BYTES) return { ok: false, error: 'too_large' };
    const send = (overwrite) => api.call({
      method: 'PUT', path: 'files/upload', query: overwrite ? { path: dir, name, overwrite: '1' } : { path: dir, name },
      bodyStream: fs.createReadStream(file), contentLength: st.size,
    });
    try {
      let data;
      try { data = await send(false); } catch (e) {
        if (e.message !== 'exists') throw e;
        const c = await dialog.showMessageBox({ type: 'question', buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1, message: `${name} already exists in this folder.`, detail: 'Replace it with the file you chose?' });
        if (c.response !== 0) return { ok: false, error: 'cancelled' };
        data = await send(true);
      }
      return { ok: true, data, file: name, size: st.size };
    } catch (e) { return { ok: false, error: e.message, status: e.status || 0 }; }
  });
  // Opens the EqRGB lights remote for a PC in an in-app window. The renderer passes only the PC id; the session path comes
  // from the agent and the URL is rebuilt here from the saved server address (see lights-url.js).
  ipcMain.handle('lights:open', async (_e, id) => {
    id = String(id || '');
    if (!/^[a-f0-9]{1,32}$/.test(id)) return { ok: false, error: 'not_found' };
    if (lightsWin && !lightsWin.isDestroyed()) { if (lightsWin.isMinimized()) lightsWin.restore(); lightsWin.focus(); return { ok: true }; }
    try {
      const r = await api.call({ method: 'POST', path: 'pc/lights/session', body: { id } });
      const url = buildLightsUrl(readCfg().baseUrl, String(r.path));
      if (!url) return { ok: false, error: 'no_lights' };
      if (lightsWin && !lightsWin.isDestroyed()) { lightsWin.focus(); return { ok: true }; }
      openLightsWindow(url);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message, status: e.status || 0 }; }
  });
  ipcMain.handle('open:url', async (_e, u) => {
    if (!allowedOpenHost(u, readCfg().baseUrl)) return false;
    await shell.openExternal(new URL(String(u)).toString());
    return true;
  });
  ipcMain.handle('file:save', async (_e, remotePath) => {
    const { baseUrl, token } = readCfg();
    const name = path.basename(String(remotePath));
    const r = await dialog.showSaveDialog({ defaultPath: name });
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
    const url = new URL(normalizeBase(baseUrl) + '/files/download');
    url.searchParams.set('path', remotePath);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) return { ok: false, error: httpErrorMessage(res.status, await res.text().catch(() => '')) };
    await require('stream/promises').pipeline(require('stream').Readable.fromWeb(res.body), fs.createWriteStream(r.filePath));
    shell.showItemInFolder(r.filePath);
    return { ok: true };
  });
  // Windows app self-update. The renderer passes nothing; the release is looked up again here every time.
  const ghJson = async (url) => {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SamsungServerDesktop' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is rate limiting update checks, try again later' : `GitHub answered ${res.status}`);
    return res.json();
  };
  const resolveUpdate = async () => {
    let releases;
    try { releases = await ghJson(Updater.RELEASES_URL); } catch (e) { throw new Error(e.message.startsWith('GitHub') ? e.message : 'Could not reach GitHub'); }
    const pick = Updater.pickRelease(releases, app.getVersion());
    if (!pick) return null;
    let sha256 = pick.sha256;
    if (!sha256) {
      const side = Updater.sha256Asset(pick.asset, pick.release);
      if (side && Updater.isAllowedDownloadUrl(side.browser_download_url)) {
        try {
          const r = await fetch(side.browser_download_url, { headers: { 'User-Agent': 'SamsungServerDesktop' }, signal: AbortSignal.timeout(15000) });
          if (r.ok && Updater.isAllowedFinalHost(r.url)) sha256 = Updater.expectedSha256(pick.asset, pick.release, (await r.text()).slice(0, 1024));
        } catch { /* unverified */ }
      }
    }
    return { ...pick, sha256 };
  };
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const p = await resolveUpdate();
      if (!p) return { ok: true, current, latest: current, notes: '', size: 0, available: false, verified: false };
      return { ok: true, current, latest: p.version, notes: p.notes.slice(0, 4000), size: p.size, available: true, verified: !!p.sha256 };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  let installing = false;
  ipcMain.handle('update:install', async () => {
    if (installing) return { ok: false, error: 'An update is already downloading' };
    installing = true;
    let file = '';
    try {
      const p = await resolveUpdate();
      if (!p) return { ok: false, error: 'No newer version is available' };
      if (!Updater.isAllowedDownloadUrl(p.url)) return { ok: false, error: 'The update is not hosted on github.com, so it was not downloaded' };
      file = path.join(app.getPath('temp'), `Samsung-Server-Setup-${p.version}-${crypto.randomBytes(6).toString('hex')}.exe`);
      const res = await fetch(p.url, { headers: { 'User-Agent': 'SamsungServerDesktop' }, signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!res.ok || !res.body) return { ok: false, error: `Download failed (${res.status})` };
      if (!Updater.isAllowedFinalHost(res.url)) return { ok: false, error: 'The download was redirected to an unexpected host, so it was stopped' };
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      const tap = new (require('stream').Transform)({ transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); } });
      await require('stream/promises').pipeline(require('stream').Readable.fromWeb(res.body), tap, fs.createWriteStream(file));
      if (p.size && bytes !== p.size) { fs.rmSync(file, { force: true }); return { ok: false, error: 'The download is incomplete or the wrong size, so it was deleted' }; }
      if (p.sha256 && hash.digest('hex') !== p.sha256) { fs.rmSync(file, { force: true }); return { ok: false, error: 'The download does not match its checksum, so it was deleted' }; }
      require('child_process').spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 300);
      return { ok: true, verified: !!p.sha256 };
    } catch (e) {
      if (file) try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      return { ok: false, error: 'Update failed: ' + e.message };
    } finally { installing = false; }
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
