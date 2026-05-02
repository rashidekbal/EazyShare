/**
 * electron-builder configuration for eazyShare
 */
module.exports = {
  appId:       'com.eazyshare.app',
  productName: 'eazyShare',
  copyright:   'Copyright © 2026 eazyShare',

  directories: {
    output: 'dist',
    buildResources: 'assets',
  },

  files: [
    'src/**/*',
    'preload.js',
    '!src/**/*.map',
    '!node_modules/**/{test,tests,spec,specs}/**',
  ],

  extraResources: [
    { from: 'assets/', to: 'assets/', filter: ['**/*'] },
  ],

  // ── Windows ──────────────────────────────────────────────
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: 'assets/icon.ico',
    requestedExecutionLevel: 'asInvoker', // UAC only when needed (firewall dialog)
  },

  // ── NSIS Installer ────────────────────────────────────────
  nsis: {
    oneClick:                          false,
    allowToChangeInstallationDirectory: true,
    allowElevation:                    true,
    installerIcon:                     'assets/icon.ico',
    uninstallerIcon:                   'assets/icon.ico',
    installerHeader:                   'assets/icon.png',
    createDesktopShortcut:             true,
    createStartMenuShortcut:           true,
    shortcutName:                      'eazyShare',
    runAfterFinish:                    true,

    // Custom installer pages / script
    include: 'installer.nsh',
  },
};
