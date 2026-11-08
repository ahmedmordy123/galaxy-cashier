'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isElectron: true,
  selectBackupFolder: () => ipcRenderer.invoke('select-backup-folder'),
})
