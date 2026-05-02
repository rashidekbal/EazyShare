const { exec }   = require('child_process');
const { dialog } = require('electron');

const RULE_HTTP = 'eazyShare-HTTP';
const RULE_WS   = 'eazyShare-WS';
const PORT_HTTP = 7523;
const PORT_WS   = 7524;

/**
 * Check if firewall rules exist, and add them if not.
 * Shows a permission dialog before requesting elevation.
 */
async function ensureFirewallRules() {
  const exists = await rulesExist();
  if (exists) {
    console.log('[Firewall] Rules already present');
    return;
  }

  const { response } = await dialog.showMessageBox({
    type:    'question',
    title:   'Firewall Permission Required',
    message: 'eazyShare needs to open ports for LAN file sharing',
    detail:  `Ports ${PORT_HTTP} (HTTP) and ${PORT_WS} (WebSocket) must be allowed through Windows Firewall so your phone can connect.\n\nClick "Add Rules" to continue — Windows will ask for administrator permission.`,
    buttons: ['Add Rules', 'Skip (may not work on other devices)'],
    defaultId: 0,
    cancelId:  1,
    icon: require('path').join(__dirname, '../../assets/icon.png'),
  });

  if (response === 0) {
    addFirewallRules();
  } else {
    console.log('[Firewall] User skipped rule creation');
  }
}

function rulesExist() {
  return new Promise((resolve) => {
    exec(`netsh advfirewall firewall show rule name="${RULE_HTTP}"`, (err, stdout) => {
      resolve(!err && stdout.includes(RULE_HTTP));
    });
  });
}

function addFirewallRules() {
  // Build a PowerShell one-liner that runs two netsh commands as admin
  const cmds = [
    `netsh advfirewall firewall add rule name="${RULE_HTTP}" dir=in action=allow protocol=TCP localport=${PORT_HTTP}`,
    `netsh advfirewall firewall add rule name="${RULE_WS}"   dir=in action=allow protocol=TCP localport=${PORT_WS}`,
  ].join(' ; ');

  // Start-Process with RunAs verb triggers the UAC elevation prompt
  const ps = `Start-Process powershell -ArgumentList '-NoProfile -Command \\"${cmds}\\"' -Verb RunAs -Wait`;

  exec(`powershell -Command "${ps}"`, (err) => {
    if (err) {
      console.error('[Firewall] Failed to add rules:', err.message);
    } else {
      console.log('[Firewall] Rules added successfully');
    }
  });
}

/**
 * Remove firewall rules (call on uninstall / cleanup).
 */
function removeFirewallRules() {
  exec(`netsh advfirewall firewall delete rule name="${RULE_HTTP}"`);
  exec(`netsh advfirewall firewall delete rule name="${RULE_WS}"`);
}

module.exports = { ensureFirewallRules, removeFirewallRules };
