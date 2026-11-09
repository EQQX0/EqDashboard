'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('s21', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  signIn: (url, token) => ipcRenderer.invoke('cfg:set', url, token),
  importPair: () => ipcRenderer.invoke('cfg:import'),
  findPair: () => ipcRenderer.invoke('cfg:find'),
  usePair: () => ipcRenderer.invoke('cfg:useFound'),
  signOut: () => ipcRenderer.invoke('cfg:clear'),
  api: (req) => ipcRenderer.invoke('api', req),
  saveFile: (p) => ipcRenderer.invoke('file:save', p),
});
