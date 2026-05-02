import { dom, setStatus } from './ui.js';
import { connectSignaling } from './webrtc.js';
import { restoreTransfer, queueFile } from './transfer.js';
import { selectedPeers, peers } from './state.js';

window.electronAPI.onInit(async (cfg) => {
  dom.qrImg.src              = cfg.qrDataUrl;
  dom.urlDisplay.textContent = cfg.httpUrl;
  setStatus('waiting', 'Waiting for phones', 'Scan QR with any phone');
  connectSignaling(cfg.wsUrl);

  if (cfg.savedTransfers?.length) {
    cfg.savedTransfers.forEach(restoreTransfer);
  }
});

document.getElementById('btn-minimize').onclick = () => window.electronAPI.minimize();
document.getElementById('btn-maximize').onclick = () => window.electronAPI.maximize();
document.getElementById('btn-close').onclick    = () => window.electronAPI.close();
document.getElementById('btn-open-folder').onclick = () => window.electronAPI.openFolder();
document.getElementById('btn-clear').onclick    = window.clearDone;

dom.dropZone.onclick = () => { if (selectedPeers.size > 0) dom.fileInput.click(); };
dom.fileInput.onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
dom.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); if (selectedPeers.size > 0) dom.dropZone.classList.add('drag-over'); });
dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('drag-over'));
dom.dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dom.dropZone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

async function handleFiles(files) {
  const ready = [...selectedPeers].filter(id => peers.get(id)?.ready);
  if (ready.length === 0) { alert('Check at least one connected device in the sidebar.'); return; }

  const filePaths = files.map(f => window.electronAPI.getPathForFile(f)).filter(Boolean);
  if (filePaths.length === 0) { alert('Could not read file path. Please try again.'); return; }

  const resolved = await window.electronAPI.resolveDirectories(filePaths);
  resolved.forEach(rf => ready.forEach(peerId => queueFile(rf, peerId)));
}

