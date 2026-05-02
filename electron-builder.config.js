/**
 * electron-builder configuration for eazyShare
 */
module.exports = {
  appId:       'com.eazyshare.app',
  productName: 'eazyShare',
  copyright:   'Copyright © 2026 eazyShare',

  directories: {
    output: 'dist',
  },

  files: [
    'src/**/*',
    'preload.js',
    '!src/**/*.map',
    '!node_modules/**/{test,tests,spec,specs}/**',
  ],

  // ── Windows ──────────────────────────────────────────────
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: 'src/assets/icon.ico',
    requestedExecutionLevel: 'asInvoker',
  },

  // ── NSIS Installer ────────────────────────────────────────
  nsis: {
    oneClick:                          false,
    allowToChangeInstallationDirectory: true,
    allowElevation:                    true,
    createDesktopShortcut:             true,
    createStartMenuShortcut:           true,
    shortcutName:                      'eazyShare',
    runAfterFinish:                    true,
    include: 'installer.nsh',
  },
};

