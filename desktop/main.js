'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createApi, normalizeBase, parsePair, httpErrorMessage } = require('./api');
const { findPairFile } = require('./pairscan');

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 760, minHeight: 520,
    backgroundColor: '#B91C1C', icon: path.join(__dirname, 'build', 'icon.png'), title: 'Samsung Server', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
    try { return { ok: true, data: await api.call(req) }; } catch (e) { return { ok: false, error: e.message, status: e.status || 0 }; }
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
  createWindow();
});

app.on('window-all-closed', () => app.quit());
