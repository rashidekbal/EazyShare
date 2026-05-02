const WebSocket = require('ws');

let wss = null;

// clientId → { ws, type: 'desktop'|'mobile', deviceName }
const clients = new Map();

function startSignalingServer(port) {
  const cooldowns = new Map();
  wss = new WebSocket.Server({ port }, () => {
    console.log(`[WS] Signaling server on port ${port}`);
  });

  wss.on('connection', (ws) => {
    let clientId   = null;
    let clientType = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // ── Registration ──────────────────────────────────────
        if (msg.type === 'register') {
          const now = Date.now();
          if (cooldowns.get(msg.id) && now - cooldowns.get(msg.id) < 2000) {
            console.log(`[WS] Throttling rapid registration for ${msg.id}`);
            return;
          }
          cooldowns.set(msg.id, now);

          if (clientId) return; // Already registered on this socket
          clientId   = msg.id;
          clientType = msg.clientType;
          const deviceName = msg.deviceName || 'Unknown Device';

          // ── Evict stale client with SAME ID but DIFFERENT socket ──
          const existing = clients.get(clientId);
          if (existing && existing.ws !== ws) {
            console.log(`[WS] Evicting stale "${deviceName}" (${clientId}) — socket mismatch`);
            try { existing.ws.terminate(); } catch (_) {}
            clients.delete(clientId);
          }
          
          clients.set(clientId, { ws, type: clientType, deviceName });
          console.log(`[WS] + ${clientType} "${deviceName}" (${clientId})`);

          ws.send(JSON.stringify({ type: 'registered', id: clientId }));

          // Notify opposite peers with deviceName included
          broadcastToOpposite(clientType, {
            type:       'peer-connected',
            peerType:   clientType,
            peerId:     clientId,
            deviceName,
          });
          return;
        }

        // ── Direct targeted message (offer/answer/ICE) ────────
        // All signaling payloads MUST include a target for multi-device support
        if (msg.target) {
          const target = clients.get(msg.target);
          if (target?.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...msg, from: clientId }));
          } else {
            console.warn(`[WS] Target ${msg.target} not found or closed`);
          }
          return;
        }

        // ── Fallback: broadcast to opposite type ──────────────
        // (only used for non-signaling messages like peer status)
        if (clientId && clientType) {
          broadcastToOpposite(clientType, { ...msg, from: clientId });
        }
      } catch (e) {
        console.error('[WS] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      if (!clientId) return;
      const info = clients.get(clientId);
      if (info && info.ws === ws) {
        clients.delete(clientId);
        console.log(`[WS] - ${clientType} "${info?.deviceName}" (${clientId})`);
        broadcastToOpposite(clientType, {
          type:       'peer-disconnected',
          peerType:   clientType,
          peerId:     clientId,
          deviceName: info?.deviceName || 'Unknown',
        });
      }
    });

    ws.on('error', (err) => console.error('[WS] Client error:', err.message));
  });

  wss.on('error', (err) => console.error('[WS] Server error:', err.message));
  return wss;
}

function broadcastToOpposite(senderType, msg) {
  const targetType = senderType === 'desktop' ? 'mobile' : 'desktop';
  const payload    = JSON.stringify(msg);
  for (const [, client] of clients) {
    if (client.type === targetType && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function stopSignalingServer() {
  wss?.close();
  wss = null;
}

module.exports = { startSignalingServer, stopSignalingServer };
