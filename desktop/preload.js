'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('samsung', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  signIn: (url, token) => ipcRenderer.invoke('cfg:set', url, token),
  importPair: () => ipcRenderer.invoke('cfg:import'),
  findPair: () => ipcRenderer.invoke('cfg:find'),
  usePair: () => ipcRenderer.invoke('cfg:useFound'),
  signOut: () => ipcRenderer.invoke('cfg:clear'),
  api: (req) => ipcRenderer.invoke('api', req),
  saveFile: (p) => ipcRenderer.invoke('file:save', p),
  deploySite: (name) => ipcRenderer.invoke('sites:deploy', name),
  uploadFile: (dir) => ipcRenderer.invoke('files:upload', dir),
  openLights: (id) => ipcRenderer.invoke('lights:open', id),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUrl:(u) => ipcRenderer.invoke('open:url', u),
});
