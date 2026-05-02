const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App init
  onInit: (cb) => ipcRenderer.on('app:init', (_, data) => cb(data)),

  // Window
  minimize:    () => ipcRenderer.send('win:minimize'),
  maximize:    () => ipcRenderer.send('win:maximize'),
  close:       () => ipcRenderer.send('win:close'),

  // File I/O
  saveFile:    (name, uint8Array, deviceName) =>
    ipcRenderer.invoke('file:save', {
      name,
      data: uint8Array,
      deviceName,
    }),
  openFolder:  (deviceName) => ipcRenderer.invoke('file:open-folder', deviceName),
  
  // Incoming Transfers
  incomingInit:   (info) => ipcRenderer.invoke('file:incoming-init', info),
  incomingWrite:  (info) => ipcRenderer.invoke('file:incoming-write', info),
  incomingCommit: (info) => ipcRenderer.invoke('file:incoming-commit', info),
  incomingCancel: (tempPath) => ipcRenderer.invoke('file:incoming-cancel', tempPath),

  // Read a byte range from a file on disk (for persisted transfer resume)
  readFileSlice: (filePath, start, end) =>
    ipcRenderer.invoke('file:read-slice', { filePath, start, end }),

  // Transfer state persistence
  saveTransferState: (transfers) => ipcRenderer.send('state:save', transfers),
  loadTransferStates: ()          => ipcRenderer.invoke('state:load'),

  // Directories resolution
  resolveDirectories: (filePaths) => ipcRenderer.invoke('file:resolve-directories', filePaths),

  // Get absolute filesystem path from a File object (Electron 26+ replacement for file.path)
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
