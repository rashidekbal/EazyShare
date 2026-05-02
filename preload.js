const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App init
  onInit: (cb) => ipcRenderer.on('app:init', (_, data) => cb(data)),

  // Window
  minimize:    () => ipcRenderer.send('win:minimize'),
  maximize:    () => ipcRenderer.send('win:maximize'),
  close:       () => ipcRenderer.send('win:close'),

  // File I/O
  saveFile:    (name, arrayBuffer, deviceName) =>
    ipcRenderer.invoke('file:save', {
      name,
      data: Array.from(new Uint8Array(arrayBuffer)),
      deviceName,
    }),
  openFolder:  (deviceName) => ipcRenderer.invoke('file:open-folder', deviceName),

  // Read a byte range from a file on disk (for persisted transfer resume)
  readFileSlice: (filePath, start, end) =>
    ipcRenderer.invoke('file:read-slice', { filePath, start, end }),

  // Transfer state persistence
  saveTransferState: (transfers) => ipcRenderer.send('state:save', transfers),
  loadTransferStates: ()          => ipcRenderer.invoke('state:load'),
});
