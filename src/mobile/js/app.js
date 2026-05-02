import { dom, getDeviceName, setStatus, setConn, addItem, updateProg } from './ui.js';
import { connectSignaling } from './webrtc.js';
import { sendFile, resumePendingFile } from './transfer.js';
import { outgoing } from './state.js';

function handleSelectedFiles(files) {
  files.forEach(file => {
    const fileName = file.webkitRelativePath || file.name;
    const pendingId = [...outgoing.entries()].find(([id, t]) => !t.file && t.name === fileName && t.size === file.size)?.[0];
    if (pendingId) {
      resumePendingFile(pendingId, file);
    } else {
      sendFile(file);
    }
  });
}

dom.filePick.addEventListener('change', (e) => {
  handleSelectedFiles([...e.target.files]);
  e.target.value = '';
});
dom.folderPick.addEventListener('change', (e) => {
  handleSelectedFiles([...e.target.files]);
  e.target.value = '';
});

function loadPendingOutgoings() {
  const saved = JSON.parse(localStorage.getItem('eazy_outgoing') || '[]');
  saved.forEach(s => {
    outgoing.set(s.id, { file: null, name: s.name, size: s.size, totalChunks: s.totalChunks, nextChunk: 0, ackedCount: 0, paused: true, streaming: false, cancelled: false });
    addItem(s.id, s.name, s.size, 'send');
    updateProg(s.id, 0, '⚠ Select this file again to resume');
  });
}

window.onerror = (m, s, l, c, e) => {
  setStatus('error', 'FATAL: ' + m);
  console.error('[FATAL]', m, 'at', s, ':', l);
};

(async function boot() {
  loadPendingOutgoings();
  const name = getDeviceName();
  if (dom.devNameEl) dom.devNameEl.textContent = name;
  if (dom.devNameIn) dom.devNameIn.value       = name;

  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    connectSignaling(cfg.wsUrl);
  } catch {
    setStatus('error', '❌ Cannot reach PC — same Wi-Fi?');
    setConn('error', 'Unreachable');
  }
})();
