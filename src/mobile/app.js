// ── Constants ─────────────────────────────────────────────
const CHUNK_SIZE   = 65536;
const MAX_BUFFERED = 1024 * 1024 * 4;
const MY_ID        = 'mobile-' + Math.random().toString(36).slice(2, 9);

// ── Device name (persisted in localStorage) ───────────────
function getDeviceName() {
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
function setDeviceName(name) { localStorage.setItem('eazy_device_name', name); }

// ── State ─────────────────────────────────────────────────
let ws         = null;
let pc         = null;
let dc         = null;
let peerReady  = false;
let desktopId  = null; // ID of the connected desktop

const incoming = new Map(); // id → { name, size, total, chunks[], startTime }
const outgoing = new Map(); // id → { file, totalChunks, nextChunk, paused, streaming, cancelled, startTime }

// ── DOM ───────────────────────────────────────────────────
const connDot   = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const statusBar = document.getElementById('status-bar');
const statusTxt = document.getElementById('status-text');
const tList     = document.getElementById('transfer-list');
const emptyEl   = document.getElementById('empty-state');
const filePick  = document.getElementById('file-pick');
const devNameEl = document.getElementById('device-name-display');
const devNameIn = document.getElementById('device-name-input');

filePick.addEventListener('change', (e) => {
  [...e.target.files].forEach(sendFile);
  e.target.value = '';
});

// ── Boot ──────────────────────────────────────────────────
(async function boot() {
  // Set device name in header
  const name = getDeviceName();
  if (devNameEl) devNameEl.textContent = name;
  if (devNameIn) devNameIn.value       = name;

  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    connectSignaling(cfg.wsUrl);
  } catch {
    setStatus('error', '❌ Cannot reach PC — same Wi-Fi?');
    setConn('error', 'Unreachable');
  }
})();

// ── Device name edit ──────────────────────────────────────
function saveDeviceName() {
  const val = devNameIn?.value?.trim();
  if (!val) return;
  setDeviceName(val);
  if (devNameEl) devNameEl.textContent = val;
  setStatus('info', 'Device name saved — reconnect for it to take effect');
}

// ── Signaling ─────────────────────────────────────────────
function connectSignaling(wsUrl) {
  setConn('connecting', 'Connecting…');
  setStatus('info', 'Connecting to PC…');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', id: MY_ID, clientType: 'mobile', deviceName: getDeviceName() }));
    setStatus('info', 'Registered — waiting for PC…');
  };
  ws.onmessage = async (e) => handleSignaling(JSON.parse(e.data));
  ws.onclose   = () => {
    peerReady = false; desktopId = null;
    setConn('error', 'Lost connection');
    setStatus('error', '⚠ Lost connection — retrying…');
    setTimeout(() => connectSignaling(wsUrl), 3000);
  };
  ws.onerror = () => setConn('error', 'Error');
}

async function handleSignaling(msg) {
  switch (msg.type) {
    case 'peer-disconnected':
      peerReady = false; desktopId = null;
      setConn('error', 'PC offline');
      setStatus('error', '⚠ PC closed — reopen and rescan');
      for (const [id] of outgoing) updateLabel(id, '⏸ PC offline');
      break;
    case 'offer':
      desktopId = msg.from;
      await handleOffer(msg.sdp);
      break;
    case 'ice-candidate':
      if (pc && msg.candidate) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      break;
  }
}

// ── WebRTC ────────────────────────────────────────────────
async function handleOffer(sdp) {
  pc = new RTCPeerConnection({ iceServers: [] });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && desktopId) ws.send(JSON.stringify({ type: 'ice-candidate', candidate, target: desktopId }));
  };
  pc.ondatachannel = (e) => { dc = e.channel; setupDC(dc); };

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription, target: desktopId }));
}

function setupDC(channel) {
  channel.onopen  = () => { peerReady = true; setConn('ready', 'Connected'); setStatus('ok', '✅ Ready! Select files to send or wait for PC'); };
  channel.onclose = () => { peerReady = false; setConn('error', 'Closed'); };
  channel.onmessage = (e) => handleData(e.data);
}

// ── Incoming data ─────────────────────────────────────────
function handleData(raw) {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case 'file-start': {
      if (!incoming.has(msg.id)) {
        incoming.set(msg.id, { name: msg.name, size: msg.size, total: msg.totalChunks, chunks: [], startTime: Date.now() });
        addItem(msg.id, msg.name, msg.size, 'receive');
      }
      const received = incoming.get(msg.id).chunks.filter(Boolean).length;
      dc.send(JSON.stringify({ type: 'file-resume-request', id: msg.id, fromChunk: received }));
      break;
    }
    case 'file-chunk': {
      const t = incoming.get(msg.id); if (!t) return;
      t.chunks[msg.index] = b64ToU8(msg.data);
      const done  = t.chunks.filter(Boolean).length;
      const speed = (done * CHUNK_SIZE) / ((Date.now() - t.startTime) / 1000 || 1);
      updateProg(msg.id, (done / t.total) * 100, `${fmtSpeed(speed)} · ${fmtBytes(done * CHUNK_SIZE)} / ${fmtBytes(t.size)}`);
      dc.send(JSON.stringify({ type: 'file-ack', id: msg.id, index: msg.index }));
      break;
    }
    case 'file-done': {
      const t = incoming.get(msg.id); if (!t) return;
      markDoneWithDL(msg.id, new Blob(t.chunks.filter(Boolean), { type: guessMime(t.name) }), t.name);
      incoming.delete(msg.id);
      break;
    }
    case 'file-cancel': incoming.delete(msg.id); markErr(msg.id, '✕ Cancelled by PC'); break;
    case 'file-ack': {
      const t = outgoing.get(msg.id); if (!t) return;
      t.ackedCount = (t.ackedCount || 0) + 1;
      if (t.ackedCount % 5 === 0 || t.ackedCount === t.totalChunks) {
        const elapsed    = (Date.now() - (t.speedStart || t.startTime)) / 1000 || 1;
        const ackedDelta = t.ackedCount - (t.speedStartAcked || 0);
        const speed      = Math.max(0, (ackedDelta * CHUNK_SIZE) / elapsed);
        const confirmed  = Math.min(t.ackedCount * CHUNK_SIZE, t.file.size);
        updateProg(msg.id, (t.ackedCount / t.totalChunks) * 100, `${fmtSpeed(speed)} · ${fmtBytes(confirmed)} / ${fmtBytes(t.file.size)}`);
      }
      break;
    }
  }
}

// ── Outgoing ──────────────────────────────────────────────
async function sendFile(file) {
  if (!peerReady) { alert('Not connected to PC yet.'); return; }
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  outgoing.set(id, { file, totalChunks, nextChunk: 0, ackedCount: 0, speedStartAcked: 0, speedStart: Date.now(), paused: false, streaming: false, cancelled: false, startTime: Date.now() });
  addItem(id, file.name, file.size, 'send');
  dc.send(JSON.stringify({ type: 'file-start', id, name: file.name, size: file.size, totalChunks, isResume: false }));
  await streamChunks(id);
}

async function streamChunks(id, fromChunk = 0) {
  const s = outgoing.get(id);
  if (!s || s.streaming) return;
  s.streaming = true; s.paused = false;
  s.speedStart      = Date.now();
  s.speedStartAcked = s.ackedCount || 0;
  if (fromChunk === 0) s.startTime = Date.now();
  const buf = await s.file.arrayBuffer();

  for (let i = fromChunk; i < s.totalChunks; i++) {
    s.nextChunk = i;
    if (!outgoing.has(id) || s.cancelled) return;
    if (s.paused) { s.streaming = false; return; }  // UI already updated by togglePause
    if (!peerReady || !dc || dc.readyState !== 'open') { s.streaming = false; updateLabel(id, '⏸ PC offline'); return; }
    while (dc.bufferedAmount > MAX_BUFFERED) {
      await sleep(50);
      if (!peerReady || s.paused || s.cancelled) { s.streaming = false; return; }
    }
    const slice = buf.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    dc.send(JSON.stringify({ type: 'file-chunk', id, index: i, total: s.totalChunks, data: u8ToB64(new Uint8Array(slice)) }));
    // Progress driven by file-ack only for consistency
  }
  dc.send(JSON.stringify({ type: 'file-done', id }));
  s.streaming = false; markSentDone(id); outgoing.delete(id);
}

// ── Pause / Resume / Cancel ───────────────────────────────
function togglePause(id) {
  const t = outgoing.get(id); if (!t) return;
  if (t.paused || !t.streaming) {
    if (!peerReady) { updateLabel(id, '⚠ PC offline'); return; }
    t.paused = false; updPauseBtn(id, false);
    updateLabel(id, `▶ Resuming from ${fmtBytes(t.nextChunk * CHUNK_SIZE)}…`);
    streamChunks(id, t.nextChunk);
  } else {
    t.paused = true;
    updPauseBtn(id, true);
    // Freeze bar at last ACK'd byte — no jumping
    const confirmed = Math.min((t.ackedCount || 0) * CHUNK_SIZE, t.file.size);
    const pct       = t.totalChunks > 0 ? ((t.ackedCount || 0) / t.totalChunks) * 100 : 0;
    updateProg(id, pct, `⏸ Paused — ${fmtBytes(confirmed)} / ${fmtBytes(t.file.size)}`);
  }
}
function cancelTransfer(id) {
  const t = outgoing.get(id);
  if (t) { t.cancelled = true; outgoing.delete(id); }
  incoming.delete(id);
  if (dc?.readyState === 'open') dc.send(JSON.stringify({ type: 'file-cancel', id }));
  markErr(id, '✕ Cancelled');
}

// ── UI helpers ────────────────────────────────────────────
function setConn(state, label) { connDot.className = 'conn-dot ' + state; connLabel.textContent = label; }
function setStatus(type, text) {
  statusBar.className = 'status-bar' + (type === 'ok' ? ' ok' : type === 'error' ? ' error' : '');
  statusTxt.textContent = text;
}
function addItem(id, name, size, dir) {
  emptyEl.style.display = 'none';
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
      ${dir === 'send' ? `
        <button class="t-x pause-x" id="tbtn-${id}" onclick="togglePause('${id}')" title="Pause">⏸</button>
        <button class="t-x" onclick="cancelTransfer('${id}')">✕</button>` : ''}
    </div>
    <div class="t-bar-wrap"><div class="t-bar" id="tb-${id}"></div></div>
    <div id="tdl-${id}"></div>`;
  tList.prepend(el);
}
function updateProg(id, pct, label) {
  const bar = document.getElementById('tb-' + id);
  const pctEl = document.getElementById('tp-' + id);
  const sub   = document.getElementById('ts-' + id);
  if (bar)   bar.style.width   = pct.toFixed(1) + '%';
  if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  if (sub)   sub.textContent   = label;
}
function updateLabel(id, text) { const el = document.getElementById('ts-' + id); if (el) el.textContent = text; }
function updPauseBtn(id, isPaused) {
  const btn = document.getElementById('tbtn-' + id); if (!btn) return;
  btn.textContent = isPaused ? '▶' : '⏸'; btn.title = isPaused ? 'Resume' : 'Pause';
  btn.classList.toggle('resuming', isPaused);
}
function markDoneWithDL(id, blob, name) {
  const bar   = document.getElementById('tb-' + id);
  const pctEl = document.getElementById('tp-' + id);
  const dlDiv = document.getElementById('tdl-' + id);
  if (bar)   { bar.style.width = '100%'; bar.className = 't-bar done'; }
  if (pctEl) { pctEl.textContent = '✓ Saved'; pctEl.className = 't-pct done'; }
  document.querySelector(`#ti-${id} .t-x`)?.remove();
  if (dlDiv) {
    const url = URL.createObjectURL(blob);
    // Build anchor with raw name (no HTML escaping on download attr)
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = name;
    a.className   = 'dl-btn';
    a.textContent = `⬇ ${name}`;
    dlDiv.appendChild(a);
    // Auto-save: trigger download without user needing to tap
    a.click();
    // Revoke after a short delay to free memory
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
function markSentDone(id) {
  const bar = document.getElementById('tb-' + id); const pctEl = document.getElementById('tp-' + id);
  if (bar)   { bar.style.width = '100%'; bar.className = 't-bar done'; }
  if (pctEl) { pctEl.textContent = '✓ Sent'; pctEl.className = 't-pct done'; }
  document.querySelector(`#ti-${id} .t-x`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
function markErr(id, label) {
  const bar = document.getElementById('tb-' + id); const pctEl = document.getElementById('tp-' + id);
  if (bar)   bar.className = 't-bar error';
  if (pctEl) { pctEl.textContent = label; pctEl.className = 't-pct error'; }
  document.querySelector(`#ti-${id} .t-x`)?.remove();
  document.getElementById('ti-' + id)?.setAttribute('data-done', '1');
}
function clearDone() {
  document.querySelectorAll('.t-item[data-done="1"]').forEach(el => el.remove());
  if (!document.querySelector('.t-item')) emptyEl.style.display = '';
}

// ── Utils ─────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function u8ToB64(u8) { let b = ''; u8.forEach(c => b += String.fromCharCode(c)); return btoa(b); }
function b64ToU8(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function fmtBytes(b) { if (!b||b<0) return '0 B'; if (b<1024) return b+' B'; if (b<1024**2) return (b/1024).toFixed(1)+' KB'; if (b<1024**3) return (b/1024**2).toFixed(1)+' MB'; return (b/1024**3).toFixed(2)+' GB'; }
function fmtSpeed(bps) { if (bps<1024) return bps.toFixed(0)+' B/s'; if (bps<1024**2) return (bps/1024).toFixed(0)+' KB/s'; return (bps/1024**2).toFixed(1)+' MB/s'; }
function guessMime(name) { const ext = name.split('.').pop().toLowerCase(); return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',pdf:'application/pdf',mp4:'video/mp4',mp3:'audio/mpeg',zip:'application/zip',txt:'text/plain',json:'application/json'})[ext]||'application/octet-stream'; }
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
