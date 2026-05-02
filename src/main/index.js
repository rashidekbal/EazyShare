const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const { startHttpServer }      = require('./server/httpServer');
const { startSignalingServer } = require('./server/signalingServer');
const { getLocalIP }           = require('./network/ipDetector');
const { generateQRCode }       = require('./utils/qrGenerator');
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
    icon: path.join(__dirname, process.platform === 'win32' ? '../assets/icon.ico' : '../assets/icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', () => {
    app.isQuitting = true;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  await createWindow();
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
    app.isQuitting = true;
    app.quit();
  });

  // ── File: save received file into per-device folder ──────
  ipcMain.handle('file:save', (_, { name, data, deviceName }) => {
    const safeName   = sanitizeName(deviceName || 'Unknown Device');
    const baseDir    = path.join(app.getPath('downloads'), 'EazyShare', safeName);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    // Secure against path traversal attacks (e.g. ../../windows/system32)
    const normalizedName = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
    let filePath = path.join(baseDir, normalizedName);

    // Ensure nested directories exist for the file
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });

    let counter  = 1;
    const ext    = path.extname(normalizedName);
    const base   = path.basename(normalizedName, ext);
    while (fs.existsSync(filePath)) {
      filePath = path.join(fileDir, `${base} (${counter++})${ext}`);
    }

    fs.writeFileSync(filePath, Buffer.from(data));
    shell.showItemInFolder(filePath);
    return filePath;
  });

  // ── File: recursively resolve directories into flat file list ──
  ipcMain.handle('file:resolve-directories', async (_, filePaths) => {
    const results = [];
    async function scan(itemPath, relativeTo) {
      const stat = await fs.promises.stat(itemPath).catch(() => null);
      if (!stat) return;
      if (stat.isDirectory()) {
        const children = await fs.promises.readdir(itemPath);
        for (const child of children) {
          await scan(path.join(itemPath, child), relativeTo);
        }
      } else {
        // Compute relative path for preserving folder structure on receiver end
        let relativePath = path.relative(relativeTo, itemPath);
        if (!relativePath) relativePath = path.basename(itemPath);
        relativePath = relativePath.replace(/\\/g, '/');

        results.push({
          name: relativePath,
          size: stat.size,
          path: itemPath
        });
      }
    }

    for (const p of filePaths) {
      const stat = await fs.promises.stat(p).catch(() => null);
      if (stat && stat.isDirectory()) {
        const base = path.dirname(p);
        await scan(p, base);
      } else if (stat) {
        results.push({
          name: path.basename(p),
          size: stat.size,
          path: p
        });
      }
    }
    return results;
  });

  // ── Incoming Transfers Persistence ────────────────────────
  const incomingHandles = new Map();

  ipcMain.handle('file:incoming-init', async (_, { name, size, deviceName }) => {
    const safeName   = sanitizeName(deviceName || 'Unknown Device');
    const baseDir    = path.join(app.getPath('downloads'), 'EazyShare', safeName);
    const normalizedName = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
    
    const tempPath = path.join(baseDir, `${normalizedName}.${size}.eazydownload`);
    const fileDir = path.dirname(tempPath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });

    // Close existing handle if any to prevent leaks/conflicts during resume
    if (incomingHandles.has(tempPath)) {
      try { fs.closeSync(incomingHandles.get(tempPath)); } catch {}
      incomingHandles.delete(tempPath);
    }

    let existingSize = 0;
    if (fs.existsSync(tempPath)) {
      existingSize = fs.statSync(tempPath).size;
    } else {
      fs.writeFileSync(tempPath, Buffer.alloc(0));
    }
    
    const receivedChunks = Math.floor(existingSize / 65536);
    const safeSize = receivedChunks * 65536;
    if (existingSize > safeSize) fs.truncateSync(tempPath, safeSize);

    const fd = fs.openSync(tempPath, 'r+');
    incomingHandles.set(tempPath, fd);

    return { tempPath, receivedChunks };
  });

  ipcMain.handle('file:incoming-write', (_, { tempPath, data, index }) => {
    const fd = incomingHandles.get(tempPath);
    if (fd !== undefined) {
      fs.writeSync(fd, Buffer.from(data), 0, data.length, index * 65536);
    }
  });

  ipcMain.handle('file:incoming-commit', async (_, { tempPath, name, deviceName }) => {
    const fd = incomingHandles.get(tempPath);
    if (fd !== undefined) {
      fs.closeSync(fd);
      incomingHandles.delete(tempPath);
    }

    const safeName   = sanitizeName(deviceName || 'Unknown Device');
    const baseDir    = path.join(app.getPath('downloads'), 'EazyShare', safeName);
    const normalizedName = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
    let finalPath = path.join(baseDir, normalizedName);

    let counter  = 1;
    const ext    = path.extname(normalizedName);
    const base   = path.basename(normalizedName, ext);
    const fileDir = path.dirname(finalPath);

    while (fs.existsSync(finalPath)) {
      finalPath = path.join(fileDir, `${base} (${counter++})${ext}`);
    }

    if (fs.existsSync(tempPath)) fs.renameSync(tempPath, finalPath);
    shell.showItemInFolder(finalPath);
    return finalPath;
  });

  ipcMain.handle('file:incoming-cancel', (_, tempPath) => {
    const fd = incomingHandles.get(tempPath);
    if (fd !== undefined) {
      fs.closeSync(fd);
      incomingHandles.delete(tempPath);
    }
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
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
