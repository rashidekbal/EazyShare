// ── Constants ─────────────────────────────────────────────
const CHUNK_SIZE   = 65536;
const MAX_BUFFERED = 1024 * 1024 * 4;
const MY_ID        = 'desktop-' + Math.random().toString(36).slice(2, 9);

// ── Multi-device state ────────────────────────────────────
// peerId → { pc, dc, deviceName, ready }
const peers = new Map();
const selectedPeers = new Set(); // checked device IDs for multi-send

// Transfers
const outgoing = new Map(); // id → { file, filePath, totalChunks, nextChunk, paused, streaming, done, cancelled, startTime, targetPeerId }
const incoming = new Map(); // id → { name, size, total, chunks[], sourcePeerId, deviceName }

let wsRef = null;

// ── DOM ───────────────────────────────────────────────────
const qrImg      = document.getElementById('qr-img');
const urlDisplay = document.getElementById('url-display');
const statusDot  = document.getElementById('status-dot');
const statusTitle= document.getElementById('status-title');
const statusSub  = document.getElementById('status-sub');
const dropZone   = document.getElementById('drop-zone');
const dropTitle  = document.getElementById('drop-title');
const fileInput  = document.getElementById('file-input');
const tList      = document.getElementById('transfer-list');
const emptyState = document.getElementById('empty-state');
const devList    = document.getElementById('devices-list');
const noDevices  = document.getElementById('no-devices');
const activeHint = document.getElementById('active-hint');

// ── Init ──────────────────────────────────────────────────
window.electronAPI.onInit(async (cfg) => {
  qrImg.src              = cfg.qrDataUrl;
  urlDisplay.textContent = cfg.httpUrl;
  setStatus('waiting', 'Waiting for phones', 'Scan QR with any phone');
  connectSignaling(cfg.wsUrl);

  // Restore persisted transfers
  if (cfg.savedTransfers?.length) {
    cfg.savedTransfers.forEach(restoreTransfer);
  }
});

// ── Window controls ───────────────────────────────────────
document.getElementById('btn-minimize').onclick = () => window.electronAPI.minimize();
document.getElementById('btn-maximize').onclick = () => window.electronAPI.maximize();
document.getElementById('btn-close').onclick    = () => window.electronAPI.close();
document.getElementById('btn-open-folder').onclick = () => window.electronAPI.openFolder();
document.getElementById('btn-clear').onclick    = clearDone;

// ── Drop zone ─────────────────────────────────────────────
dropZone.onclick = () => { if (selectedPeers.size > 0) fileInput.click(); };
fileInput.onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); if (selectedPeers.size > 0) dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

function handleFiles(files) {
  const ready = [...selectedPeers].filter(id => peers.get(id)?.ready);
  if (ready.length === 0) { alert('Check at least one connected device in the sidebar.'); return; }
  files.forEach(f => ready.forEach(peerId => queueFile(f, peerId)));
}

// ── Signaling ─────────────────────────────────────────────
function connectSignaling(wsUrl) {
  const ws = new WebSocket(wsUrl);
  wsRef = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type: 'register', id: MY_ID, clientType: 'desktop' }));
  ws.onmessage = async (e) => handleSignaling(JSON.parse(e.data), ws);
  ws.onclose = () => { setStatus('error', 'Server disconnected', 'Reconnecting…'); setTimeout(() => connectSignaling(wsUrl), 3000); };
  ws.onerror = () => setStatus('error', 'Connection error', 'Check network');
}

async function handleSignaling(msg, ws) {
  switch (msg.type) {
    case 'peer-connected':
      if (msg.peerType === 'mobile') {
        setStatus('connected', `${msg.deviceName} connecting…`, 'Setting up channel');
        await initPeer(msg.peerId, msg.deviceName, ws);
      }
      break;
    case 'peer-disconnected':
      if (msg.peerType === 'mobile') onPeerDisconnect(msg.peerId);
      break;
    case 'answer': {
      const p = peers.get(msg.from);
      if (p?.pc) await p.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      break;
    }
    case 'ice-candidate': {
      const p = peers.get(msg.from);
      if (p?.pc && msg.candidate) await p.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      break;
    }
  }
}

// ── Per-peer WebRTC ───────────────────────────────────────
async function initPeer(peerId, deviceName, ws) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('eazyshare', { ordered: true });

  peers.set(peerId, { pc, dc, deviceName, ready: false, ws });
  addDeviceCard(peerId, deviceName);
  setupDC(dc, peerId, deviceName);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate, target: peerId }));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') onPeerDisconnect(peerId);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, target: peerId }));
}

function setupDC(dc, peerId, deviceName) {
  dc.onopen = () => {
    const p = peers.get(peerId);
    if (p) p.ready = true;
    updateDeviceCard(peerId, true);
    setStatus('ready', `${peers.size} device(s) connected`, 'Select a device to send files');

    // Auto-check if this is the only device
    if (peers.size === 1) {
      const chk = document.getElementById('dchk-' + peerId);
      if (chk) { chk.checked = true; selectedPeers.add(peerId); updateSendHint(); }
    }

    // Re-announce persisted transfers for this device
    for (const [id, t] of outgoing) {
      if (!t.done && !t.cancelled && t.targetPeerId === peerId) {
        dc.send(JSON.stringify({ type: 'file-start', id, name: t.name, size: t.size, totalChunks: t.totalChunks, isResume: true }));
        updateLabel(id, '🔄 Reconnected — waiting for device…', 'prog');
      }
    }
  };
  dc.onclose  = () => onPeerDisconnect(peerId);
  dc.onmessage = (e) => handleData(e.data, peerId, deviceName);
}

function onPeerDisconnect(peerId) {
  if (!peers.has(peerId)) return;

  // Mark in-progress transfers for this device as disconnected
  for (const [id, t] of outgoing) {
    if (t.targetPeerId === peerId && !t.done && !t.cancelled) {
      t.streaming = false;
      updateLabel(id, '⏸ Device disconnected', 'warn');
    }
  }

  // Remove peer state
  peers.delete(peerId);
  selectedPeers.delete(peerId);

  // Remove device card from sidebar
  document.getElementById('dc-' + peerId)?.remove();

  // Show placeholder if no devices remain
  if (devList.querySelectorAll('.device-card').length === 0) {
    noDevices.style.display = '';
  }

  updateSendHint();

  const connectedCount = [...peers.values()].filter(p => p.ready).length;
  setStatus(
    connectedCount > 0 ? 'ready'   : 'waiting',
    connectedCount > 0 ? `${connectedCount} device(s) connected` : 'Waiting for phones',
    connectedCount > 0 ? 'Check devices to send' : 'Scan QR with your phone'
  );
}

// ── Incoming data handler ─────────────────────────────────
function handleData(raw, peerId, deviceName) {
  const msg = JSON.parse(raw);
  const peer = peers.get(peerId);
  const dc   = peer?.dc;

  switch (msg.type) {
    case 'file-start': {
      if (!incoming.has(msg.id)) {
        incoming.set(msg.id, { name: msg.name, size: msg.size, total: msg.totalChunks, chunks: [], sourcePeerId: peerId, deviceName });
        addTransferItem(msg.id, msg.name, msg.size, 'receive', deviceName);
      }
      const received = incoming.get(msg.id).chunks.filter(Boolean).length;
      dc?.send(JSON.stringify({ type: 'file-resume-request', id: msg.id, fromChunk: received }));
      break;
    }
    case 'file-chunk': {
      const t = incoming.get(msg.id);
      if (!t) return;
      t.chunks[msg.index] = base64ToU8(msg.data);
      const done = t.chunks.filter(Boolean).length;
      updateProgress(msg.id, (done / t.total) * 100, `${fmtBytes(done * CHUNK_SIZE)} / ${fmtBytes(t.size)}`);
      dc?.send(JSON.stringify({ type: 'file-ack', id: msg.id, index: msg.index }));
      break;
    }
    case 'file-done': {
      const t = incoming.get(msg.id);
      if (!t) return;
      const merged = mergeChunks(t.chunks);
      window.electronAPI.saveFile(t.name, merged.buffer, t.deviceName).then(p => markDone(msg.id, p ? '✓ Saved' : '✓ Done'));
      incoming.delete(msg.id);
      break;
    }
    case 'file-cancel':
      incoming.delete(msg.id); markError(msg.id, '✕ Cancelled'); break;

    case 'file-resume-request': {
      const t = outgoing.get(msg.id);
      if (!t || t.done || t.cancelled) return;
      t.nextChunk = msg.fromChunk || 0;
      if (t.paused) { updateLabel(msg.id, `⏸ Paused — click ▶ to resume`, 'warn'); updatePauseBtn(msg.id, true); }
      else streamChunks(msg.id, t.nextChunk);
      break;
    }
    case 'file-ack': {
      const t = outgoing.get(msg.id); if (!t) return;
      t.ackedCount = (t.ackedCount || 0) + 1;
      // Single source of truth for outgoing progress ─ ACK-based only, every 5 ACKs
      if (t.ackedCount % 5 === 0 || t.ackedCount === t.totalChunks) {
        const elapsed      = (Date.now() - (t.speedStart || t.startTime)) / 1000 || 1;
        const ackedDelta   = t.ackedCount - (t.speedStartAcked || 0);
        const speed        = Math.max(0, (ackedDelta * CHUNK_SIZE) / elapsed);
        const confirmedBytes = Math.min(t.ackedCount * CHUNK_SIZE, t.size);
        updateProgress(msg.id,
          (t.ackedCount / t.totalChunks) * 100,
          `${fmtSpeed(speed)} · ${fmtBytes(confirmedBytes)} / ${fmtBytes(t.size)}`);
      }
      break;
    }
  }
}

// ── Queue & stream ────────────────────────────────────────
async function queueFile(file, peerId) {
  const id = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const peer = peers.get(peerId);

  outgoing.set(id, {
    file, filePath: file.path || null, name: file.name, size: file.size,
    totalChunks, nextChunk: 0,
    ackedCount: 0, speedStartAcked: 0, speedStart: Date.now(),  // for accurate speed after resume
    streaming: false, paused: false, done: false, cancelled: false,
    startTime: Date.now(), targetPeerId: peerId,
  });

  addTransferItem(id, file.name, file.size, 'send', peer?.deviceName);
  saveState();

  peer.dc.send(JSON.stringify({ type: 'file-start', id, name: file.name, size: file.size, totalChunks, isResume: false }));
}

function restoreTransfer(saved) {
  outgoing.set(saved.id, { ...saved, file: null, ackedCount: 0, streaming: false, paused: true, done: false, cancelled: false, startTime: Date.now() });
  addTransferItem(saved.id, saved.name, saved.size, 'send', saved.deviceName, true);
}

async function streamChunks(id, fromChunk = 0) {
  const state = outgoing.get(id);
  if (!state || state.streaming) return;
  state.streaming = true; state.paused = false;
  // Reset speed baseline on each (re)start so speed reflects current session only
  state.speedStart      = Date.now();
  state.speedStartAcked = state.ackedCount || 0;
  if (fromChunk === 0) state.startTime = Date.now();

  const peer = peers.get(state.targetPeerId);
  const dc   = peer?.dc;

  let buf;
  if (state.file) {
    buf = await state.file.arrayBuffer();
  } else if (state.filePath) {
    buf = null;
  } else {
    updateLabel(id, '✕ File no longer available', 'error'); return;
  }

  for (let i = fromChunk; i < state.totalChunks; i++) {
    state.nextChunk = i;
    if (!outgoing.has(id) || state.cancelled) return;
    if (state.paused) { state.streaming = false; return; }  // UI already updated by pauseTransfer
    if (!dc || dc.readyState !== 'open') { state.streaming = false; updateLabel(id, '⏸ Device disconnected', 'warn'); return; }

    while (dc.bufferedAmount > MAX_BUFFERED) {
      await sleep(50);
      if (state.paused || state.cancelled || dc.readyState !== 'open') { state.streaming = false; return; }
    }

    let slice;
    if (buf) {
      slice = buf.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    } else {
      const arr = await window.electronAPI.readFileSlice(state.filePath, i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, state.size));
      if (!arr) { updateLabel(id, '✕ File read error', 'error'); state.streaming = false; return; }
      slice = new Uint8Array(arr).buffer;
    }

    dc.send(JSON.stringify({ type: 'file-chunk', id, index: i, total: state.totalChunks, data: u8ToBase64(new Uint8Array(slice)) }));
    // NOTE: progress is updated exclusively via file-ack for consistency
  }

  dc.send(JSON.stringify({ type: 'file-done', id }));
  state.done = true; state.streaming = false;
  markDone(id, '✓ Sent');
  saveState();
}

// ── Pause / Resume / Cancel ───────────────────────────────
function pauseTransfer(id) {
  const t = outgoing.get(id);
  if (!t || t.done || t.cancelled) return;
  t.paused = true;
  updatePauseBtn(id, true);
  // Freeze bar at last confirmed (ACK'd) byte — no jumping on pause
  const confirmedBytes = Math.min((t.ackedCount || 0) * CHUNK_SIZE, t.size);
  const confirmedPct   = t.totalChunks > 0 ? ((t.ackedCount || 0) / t.totalChunks) * 100 : 0;
  updateProgress(id, confirmedPct, `⏸ Paused — ${fmtBytes(confirmedBytes)} / ${fmtBytes(t.size)}`);
}
function resumeTransfer(id) {
  const t = outgoing.get(id);
  if (!t || t.done || t.cancelled) return;
  const peer = peers.get(t.targetPeerId);
  if (!peer?.ready) { updateLabel(id, '⚠ Device offline', 'warn'); return; }
  t.paused = false; updatePauseBtn(id, false);
  // Speed baseline resets inside streamChunks at start of each session
  updateLabel(id, `▶ Resuming from ${fmtBytes(t.nextChunk * CHUNK_SIZE)}…`, 'prog');
  streamChunks(id, t.nextChunk);
}
function togglePause(id) {
  const t = outgoing.get(id);
  if (!t) return;
  (t.paused || !t.streaming) ? resumeTransfer(id) : pauseTransfer(id);
}
function cancelTransfer(id) {
  const t = outgoing.get(id);
  if (t) { t.cancelled = true; outgoing.delete(id); }
  incoming.delete(id);
  const peer = t && peers.get(t.targetPeerId);
  if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-cancel', id }));
  markError(id, '✕ Cancelled');
  saveState();
}

// ── Device UI ─────────────────────────────────────────────
function addDeviceCard(peerId, deviceName) {
  noDevices.style.display = 'none';
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
    <button class="dev-folder-btn" onclick="event.stopPropagation();window.electronAPI.openFolder('${escH(deviceName)}')" title="Open folder">📁</button>
  `;
  devList.appendChild(el);
}

function toggleDeviceSelect(peerId) {
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
}

function updateDeviceCard(peerId, online) {
  const dot    = document.getElementById('dd-' + peerId);
  const status = document.getElementById('ds-' + peerId);
  const card   = document.getElementById('dc-' + peerId);
  if (dot)    dot.className      = 'dev-dot' + (online ? '' : ' offline');
  if (status) status.textContent = online ? 'Ready ✓' : 'Offline';
  if (card)   card.classList.toggle('offline', !online);
  // If came back online and was selected, re-enable send hint
  if (online && selectedPeers.has(peerId)) updateSendHint();
}

function updateSendHint() {
  const readySelected = [...selectedPeers].filter(id => peers.get(id)?.ready);
  if (readySelected.length === 0) {
    dropZone.classList.add('disabled');
    activeHint.textContent = 'Check one or more devices below to start sending';
    activeHint.classList.remove('has-device');
    dropTitle.textContent  = 'Drop files to send';
  } else {
    dropZone.classList.remove('disabled');
    const names = readySelected.map(id => peers.get(id)?.deviceName || id).join(', ');
    activeHint.textContent = `→ Sending to: ${names}`;
    activeHint.classList.add('has-device');
    dropTitle.textContent  = readySelected.length === 1
      ? `Drop files to send to ${peers.get(readySelected[0])?.deviceName}`
      : `Drop files — broadcast to ${readySelected.length} devices`;
  }
}

// ── Transfer UI ───────────────────────────────────────────
function addTransferItem(id, name, size, dir, devName, restored = false) {
  emptyState.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'transfer-item'; el.id = 'ti-' + id;
  el.innerHTML = `
    <div class="t-icon">${dir === 'send' ? '⬆' : '⬇'}</div>
    <div class="t-info">
      <div class="t-name">${escH(name)}</div>
      <div class="t-meta">
        <span class="t-badge ${dir}">${dir === 'send' ? devName || 'Sending' : devName || 'Receiving'}</span>
        <span>${fmtBytes(size)}</span>
        <span class="t-speed" id="tm-${id}">${restored ? '⏸ Waiting for device…' : 'Waiting…'}</span>
      </div>
      <div class="t-progress-wrap"><div class="t-progress-bar" id="tp-${id}" style="width:${restored ? '0%' : '0%'}"></div></div>
    </div>
    <div class="t-right">
      <div class="t-status prog" id="ts-${id}">0%</div>
      ${dir === 'send' ? `
        <button class="t-pause-btn" id="tbtn-${id}" onclick="togglePause('${id}')" title="Pause">⏸</button>
        <button class="t-cancel" onclick="cancelTransfer('${id}')" title="Cancel">✕</button>` : ''}
    </div>`;
  tList.prepend(el);
}

function updateProgress(id, pct, label) {
  const bar = document.getElementById('tp-' + id);
  const meta = document.getElementById('tm-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  bar.style.width    = pct.toFixed(1) + '%';
  if (meta) meta.textContent   = label;
  if (stat) stat.textContent   = pct.toFixed(0) + '%';
}
function updateLabel(id, label, cls = 'prog') {
  const meta = document.getElementById('tm-' + id);
  const stat = document.getElementById('ts-' + id);
  if (meta) meta.textContent = label;
  if (stat) stat.className   = 't-status ' + cls;
}
function updatePauseBtn(id, isPaused) {
  const btn = document.getElementById('tbtn-' + id);
  if (!btn) return;
  btn.textContent = isPaused ? '▶' : '⏸';
  btn.title       = isPaused ? 'Resume' : 'Pause';
  btn.classList.toggle('resuming', isPaused);
}
function markDone(id, label) {
  const bar = document.getElementById('tp-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  { bar.style.width = '100%'; bar.className = 't-progress-bar done'; }
  if (stat) { stat.textContent = label; stat.className = 't-status done'; }
  document.querySelector(`#ti-${id} .t-pause-btn`)?.remove();
  document.querySelector(`#ti-${id} .t-cancel`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
function markError(id, label) {
  const bar = document.getElementById('tp-' + id);
  const stat = document.getElementById('ts-' + id);
  if (bar)  bar.className = 't-progress-bar error';
  if (stat) { stat.textContent = label; stat.className = 't-status error'; }
  document.querySelector(`#ti-${id} .t-pause-btn`)?.remove();
  document.querySelector(`#ti-${id} .t-cancel`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
function clearDone() {
  document.querySelectorAll('.transfer-item[data-done="1"]').forEach(el => el.remove());
  if (!document.querySelector('.transfer-item')) emptyState.style.display = '';
}

// ── Status bar ────────────────────────────────────────────
function setStatus(state, title, sub) {
  statusDot.className    = 'status-dot ' + state;
  statusTitle.textContent = title;
  statusSub.textContent   = sub;
}

// ── Persistence ───────────────────────────────────────────
function saveState() {
  const toSave = [...outgoing.values()]
    .filter(t => !t.done && !t.cancelled && t.filePath)
    .map(({ name, size, totalChunks, nextChunk, filePath, targetPeerId, deviceName: dn }) => {
      const peer = peers.get(targetPeerId);
      return { name, size, totalChunks, nextChunk, filePath, targetPeerId, deviceName: dn || peer?.deviceName || 'Unknown' };
    });
  window.electronAPI.saveTransferState(toSave);
}

// ── Utils ─────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function u8ToBase64(u8) { let b = ''; u8.forEach(c => b += String.fromCharCode(c)); return btoa(b); }
function base64ToU8(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function mergeChunks(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(total); let off = 0;
  chunks.filter(Boolean).forEach(c => { out.set(c, off); off += c.length; }); return out;
}
function fmtBytes(b) {
  if (!b || b < 0) return '0 B';
  if (b < 1024) return b + ' B'; if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(1) + ' MB'; return (b / 1024 ** 3).toFixed(2) + ' GB';
}
function fmtSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + ' B/s'; if (bps < 1024 ** 2) return (bps / 1024).toFixed(0) + ' KB/s';
  return (bps / 1024 ** 2).toFixed(1) + ' MB/s';
}
function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
