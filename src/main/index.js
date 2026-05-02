const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const { startHttpServer }      = require('./server/httpServer');
const { startSignalingServer } = require('./server/signalingServer');
const { getLocalIP }           = require('./network/ipDetector');
const { generateQRCode }       = require('./utils/qrGenerator');
const { createTray, notify }   = require('./tray');
const { ensureFirewallRules }  = require('./firewall');
const {
  saveTransferState,
  loadTransferStates,
  readFileSlice,
} = require('./persistence');

const PORT_HTTP = 7523;
const PORT_WS   = 7524;

let mainWindow;
app.isQuitting = false;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1200,
    height:    740,
    minWidth:  900,
    minHeight: 600,
    frame:     false,
    backgroundColor: '#09090f',
    show:      false,
    icon:      path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      notify('eazyShare is still running', 'Double-click the tray icon to reopen.');
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  await createWindow();
  createTray(mainWindow);
  ensureFirewallRules().catch(err => console.warn('[Firewall]', err.message));

  const localIP = getLocalIP();
  const httpUrl = `http://${localIP}:${PORT_HTTP}`;
  const wsUrl   = `ws://${localIP}:${PORT_WS}`;

  startHttpServer(PORT_HTTP, localIP, PORT_WS);
  startSignalingServer(PORT_WS);

  const qrDataUrl      = await generateQRCode(httpUrl);
  const savedTransfers = loadTransferStates();

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('app:init', {
      httpUrl, wsUrl, localIP, qrDataUrl, savedTransfers,
    });
  });

  // ── Window controls ─────────────────────────────────────
  ipcMain.on('win:minimize', () => mainWindow.minimize());
  ipcMain.on('win:maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('win:close', () => {
    mainWindow.hide();
    notify('eazyShare is still running', 'Double-click the tray icon to reopen.');
  });

  // ── File: save received file into per-device folder ──────
  ipcMain.handle('file:save', (_, { name, data, deviceName }) => {
    const safeName   = sanitizeName(deviceName || 'Unknown Device');
    const dir        = path.join(app.getPath('downloads'), 'EazyShare', safeName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let filePath = path.join(dir, name);
    let counter  = 1;
    const ext    = path.extname(name);
    const base   = path.basename(name, ext);
    while (fs.existsSync(filePath)) {
      filePath = path.join(dir, `${base} (${counter++})${ext}`);
    }

    fs.writeFileSync(filePath, Buffer.from(data));
    shell.showItemInFolder(filePath);
    notify(`File from ${deviceName || 'Phone'} ✅`, `${name} saved`);
    return filePath;
  });

  // ── File: open device-specific folder ───────────────────
  ipcMain.handle('file:open-folder', (_, deviceName) => {
    const safeName = sanitizeName(deviceName || '');
    const dir = safeName
      ? path.join(app.getPath('downloads'), 'EazyShare', safeName)
      : path.join(app.getPath('downloads'), 'EazyShare');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  // ── File: read a slice for resumed/persisted transfers ───
  ipcMain.handle('file:read-slice', (_, { filePath, start, end }) => {
    try { return readFileSlice(filePath, start, end); }
    catch (e) { console.error('[IPC] read-slice error:', e.message); return null; }
  });

  // ── Persistence: save/load transfer state ────────────────
  ipcMain.on('state:save', (_, transfers) => saveTransferState(transfers));
  ipcMain.handle('state:load', () => loadTransferStates());
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});
app.on('activate', () => { if (mainWindow) mainWindow.show(); });

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'Unknown';
}
