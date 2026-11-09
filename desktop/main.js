'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createApi, normalizeBase } = require('./api');

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function readCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    let token = '';
    if (c.token) {
      try { token = safeStorage.decryptString(Buffer.from(c.token, 'base64')); } catch { token = ''; }
    }
    return { baseUrl: c.baseUrl || '', token };
  } catch { return { baseUrl: '', token: '' }; }
}

function writeCfg(baseUrl, token) {
  const enc = token ? safeStorage.encryptString(token).toString('base64') : '';
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify({ baseUrl, token: enc }));
}

let cache = readCfg;
const api = createApi({ getConfig: () => cache() });

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 760, minHeight: 520,
    backgroundColor: '#0F172A', title: 'Samsung Server', autoHideMenuBar: true,
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
    if (!res.ok || !res.body) return { ok: false, error: `Server answered ${res.status}` };
    await require('stream/promises').pipeline(require('stream').Readable.fromWeb(res.body), fs.createWriteStream(r.filePath));
    shell.showItemInFolder(r.filePath);
    return { ok: true };
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
