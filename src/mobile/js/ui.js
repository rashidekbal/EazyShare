import { escH, fmtBytes, guessMime } from './utils.js';
import { MY_ID } from './state.js';
import { togglePause, cancelTransfer } from './transfer.js';

export function getDeviceName() {
  let name = localStorage.getItem('eazy_device_name');
  if (!name) {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua))         name = 'iPhone';
    else if (/iPad/.test(ua))      name = 'iPad';
    else if (/Android/.test(ua))   name = 'Android Phone';
    else                           name = 'Mobile';
    name += ' ' + MY_ID.slice(-4);
    localStorage.setItem('eazy_device_name', name);
  }
  return name;
}
export function setDeviceName(name) { localStorage.setItem('eazy_device_name', name); }

export const dom = {
  connDot: document.getElementById('conn-dot'),
  connLabel: document.getElementById('conn-label'),
  statusBar: document.getElementById('status-bar'),
  statusTxt: document.getElementById('status-text'),
  tList: document.getElementById('transfer-list'),
  emptyEl: document.getElementById('empty-state'),
  filePick: document.getElementById('file-pick'),
  folderPick: document.getElementById('folder-pick'),
  devNameEl: document.getElementById('device-name-display'),
  devNameIn: document.getElementById('device-name-input')
};

window.saveDeviceName = function() {
  const val = dom.devNameIn?.value?.trim();
  if (!val) return;
  setDeviceName(val);
  if (dom.devNameEl) dom.devNameEl.textContent = val;
  setStatus('info', 'Device name saved — reconnect for it to take effect');
};

export function setConn(state, label) { dom.connDot.className = 'conn-dot ' + state; dom.connLabel.textContent = label; }
export function setStatus(type, text) {
  dom.statusBar.className = 'status-bar' + (type === 'ok' ? ' ok' : type === 'error' ? ' error' : '');
  dom.statusTxt.textContent = text;
}

window.togglePause = function(id) { togglePause(id); };
window.cancelTransfer = function(id) { cancelTransfer(id); };

export function addItem(id, name, size, dir) {
  dom.emptyEl.style.display = 'none';
  const el = document.createElement('div');
  el.className = 't-item'; el.id = 'ti-' + id;
  el.innerHTML = `
    <div class="t-row">
      <div class="t-ico">${dir === 'send' ? '⬆' : '⬇'}</div>
      <div class="t-info">
        <div class="t-name">${escH(name)}</div>
        <div class="t-size" id="ts-${id}">${fmtBytes(size)} · Waiting…</div>
      </div>
      <div class="t-pct" id="tp-${id}">0%</div>
      <button class="t-x pause-x" id="tbtn-${id}" onclick="togglePause('${id}')" title="Pause">⏸</button>
      <button class="t-x" onclick="cancelTransfer('${id}')">✕</button>
    </div>
    <div class="t-bar-wrap"><div class="t-bar" id="tb-${id}"></div></div>
    <div id="tdl-${id}"></div>`;
  dom.tList.prepend(el);
}

export function updateProg(id, pct, label) {
  const bar = document.getElementById('tb-' + id);
  const pctEl = document.getElementById('tp-' + id);
  const sub   = document.getElementById('ts-' + id);
  if (bar)   bar.style.width   = pct.toFixed(1) + '%';
  if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  if (sub)   sub.textContent   = label;
}
export function updateLabel(id, text) { const el = document.getElementById('ts-' + id); if (el) el.textContent = text; }
export function updPauseBtn(id, isPaused) {
  const btn = document.getElementById('tbtn-' + id); if (!btn) return;
  btn.textContent = isPaused ? '▶' : '⏸'; btn.title = isPaused ? 'Resume' : 'Pause';
  btn.classList.toggle('resuming', isPaused);
}
export function markDoneWithDL(id, blob, name) {
  const bar   = document.getElementById('tb-' + id);
  const pctEl = document.getElementById('tp-' + id);
  const dlDiv = document.getElementById('tdl-' + id);
  if (bar)   { bar.style.width = '100%'; bar.className = 't-bar done'; }
  if (pctEl) { pctEl.textContent = '✓ Saved'; pctEl.className = 't-pct done'; }
  document.querySelectorAll(`#ti-${id} .t-x`).forEach(el => el.remove());
  if (dlDiv) {
    const url = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = name;
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';
    a.className   = 'dl-btn';
    a.textContent = `⬇ ${name}`;
    dlDiv.appendChild(a);
    a.click();
  }
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
export function markSentDone(id) {
  const bar = document.getElementById('tb-' + id); const pctEl = document.getElementById('tp-' + id);
  if (bar)   { bar.style.width = '100%'; bar.className = 't-bar done'; }
  if (pctEl) { pctEl.textContent = '✓ Sent'; pctEl.className = 't-pct done'; }
  document.querySelectorAll(`#ti-${id} .t-x`).forEach(b => b.remove());
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
export function markErr(id, label) {
  const bar = document.getElementById('tb-' + id); const pctEl = document.getElementById('tp-' + id);
  if (bar)   bar.className = 't-bar error';
  if (pctEl) { pctEl.textContent = label; pctEl.className = 't-pct error'; }
  document.querySelectorAll(`#ti-${id} .t-x`).forEach(b => b.remove());
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
export function clearDone() {
  document.querySelectorAll('.t-item[data-done="1"]').forEach(el => {
    const a = el.querySelector('a.dl-btn');
    if (a && a.href) { URL.revokeObjectURL(a.href); }
    el.remove();
  });
  if (!document.querySelector('.t-item')) dom.emptyEl.style.display = '';
}
window.clearDone = clearDone;
