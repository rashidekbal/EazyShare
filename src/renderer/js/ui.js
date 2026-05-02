import { escH, fmtBytes } from './utils.js';
import { peers, selectedPeers } from './state.js';
import { togglePause, cancelTransfer } from './transfer.js';

export const dom = {
  qrImg: document.getElementById('qr-img'),
  urlDisplay: document.getElementById('url-display'),
  statusDot: document.getElementById('status-dot'),
  statusTitle: document.getElementById('status-title'),
  statusSub: document.getElementById('status-sub'),
  dropZone: document.getElementById('drop-zone'),
  dropTitle: document.getElementById('drop-title'),
  fileInput: document.getElementById('file-input'),
  tList: document.getElementById('transfer-list'),
  emptyState: document.getElementById('empty-state'),
  devList: document.getElementById('devices-list'),
  noDevices: document.getElementById('no-devices'),
  activeHint: document.getElementById('active-hint'),
};

export function setStatus(state, title, sub) {
  dom.statusDot.className    = 'status-dot ' + state;
  dom.statusTitle.textContent = title;
  dom.statusSub.textContent   = sub;
}

export function updateSendHint() {
  const readySelected = [...selectedPeers].filter(id => peers.get(id)?.ready);
  if (readySelected.length === 0) {
    dom.dropZone.classList.add('disabled');
    dom.activeHint.textContent = 'Check one or more devices below to start sending';
    dom.activeHint.classList.remove('has-device');
    dom.dropTitle.textContent  = 'Drop files to send';
  } else {
    dom.dropZone.classList.remove('disabled');
    const names = readySelected.map(id => peers.get(id)?.deviceName || id).join(', ');
    dom.activeHint.textContent = `→ Sending to: ${names}`;
    dom.activeHint.classList.add('has-device');
    dom.dropTitle.textContent  = readySelected.length === 1
      ? `Drop files to send to ${peers.get(readySelected[0])?.deviceName}`
      : `Drop files — broadcast to ${readySelected.length} devices`;
  }
}

window.toggleDeviceSelect = function(peerId) {
  const chk  = document.getElementById('dchk-' + peerId);
  const card = document.getElementById('dc-'   + peerId);
  if (chk?.checked) {
    selectedPeers.add(peerId);
    card?.classList.add('selected');
  } else {
    selectedPeers.delete(peerId);
    card?.classList.remove('selected');
  }
  updateSendHint();
};

export function addDeviceCard(peerId, deviceName) {
  if (document.getElementById('dc-' + peerId)) return;
  dom.noDevices.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'device-card';
  el.id        = 'dc-' + peerId;
  el.innerHTML = `
    <label class="dev-check-wrap" title="Select to send">
      <input type="checkbox" class="dev-chk" id="dchk-${peerId}"
        onchange="toggleDeviceSelect('${peerId}')" />
      <span class="dev-chk-box"></span>
    </label>
    <div class="dev-info" onclick="document.getElementById('dchk-${peerId}').click()">
      <div class="dev-dot" id="dd-${peerId}"></div>
      <div class="dev-name-col">
        <div class="dev-name">${escH(deviceName)}</div>
        <div class="dev-status" id="ds-${peerId}">Connecting…</div>
      </div>
    </div>
    <button class="dev-folder-btn" onclick="event.stopPropagation();window.electronAPI.openFolder('${escH(deviceName).replace(/'/g, "\\'")}')" title="Open folder">📁</button>
  `;
  dom.devList.appendChild(el);
}

export function updateDeviceCard(peerId, online) {
  const dot    = document.getElementById('dd-' + peerId);
  const status = document.getElementById('ds-' + peerId);
  const card   = document.getElementById('dc-' + peerId);
  if (dot)    dot.className      = 'dev-dot' + (online ? '' : ' offline');
  if (status) status.textContent = online ? 'Ready ✓' : 'Offline';
  if (card)   card.classList.toggle('offline', !online);
  if (online && selectedPeers.has(peerId)) updateSendHint();
}

window.togglePause = function(id) { togglePause(id); };
window.cancelTransfer = function(id) { cancelTransfer(id); };

export function addTransferItem(id, name, size, dir, devName, initialPct = 0) {
  dom.emptyState.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'transfer-item'; el.id = 'ti-' + id;
  const isRestored = initialPct > 0;
  el.innerHTML = `
    <div class="t-icon">${dir === 'send' ? '⬆' : '⬇'}</div>
    <div class="t-info">
      <div class="t-name">${escH(name)}</div>
      <div class="t-meta">
        <span class="t-badge ${dir}">${dir === 'send' ? escH(devName) || 'Sending' : escH(devName) || 'Receiving'}</span>
        <span>${fmtBytes(size)}</span>
        <span class="t-speed" id="tm-${id}">${isRestored ? `⏸ Resumed — ${fmtBytes(Math.min(initialPct/100*size, size))} ready` : 'Waiting…'}</span>
      </div>
      <div class="t-progress-wrap"><div class="t-progress-bar" id="tp-${id}" style="width:${initialPct.toFixed(1)}%"></div></div>
    </div>
    <div class="t-right">
      <div class="t-status prog" id="ts-${id}">${initialPct.toFixed(0)}%</div>
      <button class="t-pause-btn" id="tbtn-${id}" onclick="togglePause('${id}')" title="Pause">⏸</button>
      <button class="t-cancel" onclick="cancelTransfer('${id}')" title="Cancel">✕</button>
    </div>`;
  dom.tList.prepend(el);
}

export function updateProgress(id, pct, label) {
  const bar = document.getElementById('tp-' + id);
  const meta = document.getElementById('tm-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  bar.style.width    = pct.toFixed(1) + '%';
  if (meta) meta.textContent   = label;
  if (stat) stat.textContent   = pct.toFixed(0) + '%';
}
export function updateLabel(id, label, cls = 'prog') {
  const meta = document.getElementById('tm-' + id);
  const stat = document.getElementById('ts-' + id);
  if (meta) meta.textContent = label;
  if (stat) stat.className   = 't-status ' + cls;
}
export function updatePauseBtn(id, isPaused) {
  const btn = document.getElementById('tbtn-' + id);
  if (!btn) return;
  btn.textContent = isPaused ? '▶' : '⏸';
  btn.title       = isPaused ? 'Resume' : 'Pause';
  btn.classList.toggle('resuming', isPaused);
}
export function markDone(id, label) {
  const bar = document.getElementById('tp-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  { bar.style.width = '100%'; bar.className = 't-progress-bar done'; }
  if (stat) { stat.textContent = label; stat.className = 't-status done'; }
  document.querySelector(`#ti-${id} .t-pause-btn`)?.remove();
  document.querySelector(`#ti-${id} .t-cancel`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
export function markError(id, label) {
  const bar = document.getElementById('tp-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  bar.className = 't-progress-bar error';
  if (stat) { stat.textContent = label; stat.className = 't-status error'; }
  document.querySelector(`#ti-${id} .t-pause-btn`)?.remove();
  document.querySelector(`#ti-${id} .t-cancel`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
export function clearDone() {
  document.querySelectorAll('.transfer-item[data-done="1"]').forEach(el => el.remove());
  if (!document.querySelector('.transfer-item')) dom.emptyState.style.display = '';
}
window.clearDone = clearDone;
