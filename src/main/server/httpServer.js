const express = require('express');
const path    = require('path');

let server = null;

/**
 * Starts the HTTP server that:
 *  - Serves the mobile web app (src/mobile/)
 *  - Exposes /api/config so the mobile app knows the WS URL
 */
function startHttpServer(port, localIP, wsPort) {
  const app = express();

  // Serve mobile SPA
  app.use(express.static(path.join(__dirname, '../../mobile')));

  // Config endpoint — mobile fetches this to get the signaling WS URL
  app.get('/api/config', (_req, res) => {
    res.json({ wsUrl: `ws://${localIP}:${wsPort}`, version: '1.0.0' });
  });

  server = app.listen(port, '0.0.0.0', () => {
    console.log(`[HTTP] Mobile UI → http://${localIP}:${port}`);
  });

  server.on('error', (err) => console.error('[HTTP] Error:', err.message));
  return server;
}

function stopHttpServer() {
  server?.close();
  server = null;
}

module.exports = { startHttpServer, stopHttpServer };
