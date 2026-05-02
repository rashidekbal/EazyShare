const { Tray, Menu, nativeImage, app, shell } = require('electron');
const path = require('path');

let tray = null;

/**
 * Creates the system tray icon and context menu.
 * @param {BrowserWindow} mainWindow
 */
function createTray(mainWindow) {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('eazyShare — LAN File Sharing');

  buildMenu(mainWindow);

  // Double-click tray icon → show window
  tray.on('double-click', () => showWindow(mainWindow));

  return tray;
}

function buildMenu(mainWindow) {
  const menu = Menu.buildFromTemplate([
    {
      label: '🟢 eazyShare',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => showWindow(mainWindow),
    },
    {
      label: 'Open Downloads Folder',
      click: () => {
        const dir = require('path').join(app.getPath('downloads'), 'EazyShare');
        const fs  = require('fs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        shell.openPath(dir);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit eazyShare',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function showWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Show a tray balloon notification (Windows only).
 */
function notify(title, content) {
  if (tray && process.platform === 'win32') {
    tray.displayBalloon({ iconType: 'info', title, content });
  }
}

function destroyTray() {
  tray?.destroy();
  tray = null;
}

module.exports = { createTray, notify, destroyTray };
