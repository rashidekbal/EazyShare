const os = require('os');

/**
 * Returns the best LAN IPv4 address.
 * Priority: Wi-Fi → Ethernet → any non-internal
 */
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  const priorityNames = ['Wi-Fi', 'WLAN', 'wlan0', 'en0', 'Ethernet', 'eth0'];

  for (const name of priorityNames) {
    const iface = ifaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }

  // Fallback: first non-internal IPv4
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name]) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }

  return '127.0.0.1';
}

module.exports = { getLocalIP };
