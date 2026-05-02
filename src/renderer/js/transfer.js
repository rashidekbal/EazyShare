import { CHUNK_SIZE, MAX_BUFFERED, outgoing, incoming, peers } from './state.js';
import { u8ToBase64, base64ToU8, mergeChunksDense, fmtBytes, fmtSpeed, sleep } from './utils.js';
import { addTransferItem, updateProgress, updateLabel, updatePauseBtn, markDone, markError } from './ui.js';

export function saveState() {
  const toSave = [...outgoing.values()]
    .filter(t => !t.done && !t.cancelled && t.filePath)
    .map(({ name, size, totalChunks, nextChunk, filePath, targetPeerId, deviceName: dn }) => {
      const peer = peers.get(targetPeerId);
      return { name, size, totalChunks, nextChunk, filePath, targetPeerId, deviceName: dn || peer?.deviceName || 'Unknown' };
    });
  window.electronAPI.saveTransferState(toSave);
}

export function restoreTransfer(saved) {
  outgoing.set(saved.id, { ...saved, file: null, ackedCount: 0, streaming: false, paused: true, done: false, cancelled: false, startTime: Date.now() });
  addTransferItem(saved.id, saved.name, saved.size, 'send', saved.deviceName, true);
}

export async function queueFile(file, peerId) {
  const id = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const peer = peers.get(peerId);

  outgoing.set(id, {
    file, filePath: file.path || null, name: file.name, size: file.size,
    totalChunks, nextChunk: 0,
    ackedCount: 0, speedStartAcked: 0, speedStart: Date.now(),
    streaming: false, paused: false, done: false, cancelled: false,
    startTime: Date.now(), targetPeerId: peerId,
  });

  addTransferItem(id, file.name, file.size, 'send', peer?.deviceName);
  saveState();
  peer.dc.send(JSON.stringify({ type: 'file-start', id, name: file.name, size: file.size, totalChunks, isResume: false }));
}

export async function streamChunks(id, fromChunk = 0) {
  const state = outgoing.get(id);
  if (!state || state.streaming) return;
  state.streaming = true; state.paused = false;
  state.speedStart      = Date.now();
  state.ackedCount      = fromChunk;
  state.speedStartAcked = fromChunk;
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

  for (state.nextChunk = fromChunk; state.nextChunk < state.totalChunks; ) {
    const i = state.nextChunk;
    if (!outgoing.has(id) || state.cancelled) return;
    if (state.paused) { state.streaming = false; return; }
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
    if (state.nextChunk === i) state.nextChunk++;
  }

  dc.send(JSON.stringify({ type: 'file-done', id }));
  state.done = true; state.streaming = false;
  markDone(id, '✓ Sent');
  saveState();
}

export function pauseTransfer(id) {
  const t = outgoing.get(id);
  if (!t || t.done || t.cancelled) return;
  t.paused = true;
  updatePauseBtn(id, true);
  const confirmedBytes = Math.min((t.ackedCount || 0) * CHUNK_SIZE, t.size);
  const confirmedPct   = t.totalChunks > 0 ? ((t.ackedCount || 0) / t.totalChunks) * 100 : 0;
  updateProgress(id, confirmedPct, `⏸ Paused — ${fmtBytes(confirmedBytes)} / ${fmtBytes(t.size)}`);
}

export function resumeTransfer(id) {
  const t = outgoing.get(id);
  if (!t || t.done || t.cancelled) return;
  const peer = peers.get(t.targetPeerId);
  if (!peer?.ready) { updateLabel(id, '⚠ Device offline', 'warn'); return; }
  t.paused = false; updatePauseBtn(id, false);
  updateLabel(id, `▶ Resuming from ${fmtBytes(t.nextChunk * CHUNK_SIZE)}…`, 'prog');
  streamChunks(id, t.nextChunk);
}

export function togglePause(id) {
  let t = outgoing.get(id);
  if (t) {
    if (t.paused || !t.streaming) {
      resumeTransfer(id);
      const peer = peers.get(t.targetPeerId);
      if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-resume', id }));
    } else {
      pauseTransfer(id);
      const peer = peers.get(t.targetPeerId);
      if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-pause', id }));
    }
    return;
  }
  t = incoming.get(id);
  if (t) {
    t.paused = !t.paused;
    updatePauseBtn(id, t.paused);
    const peer = peers.get(t.sourcePeerId);
    if (t.paused) {
      updateLabel(id, `⏸ Paused`, 'warn');
      if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-pause', id }));
    } else {
      updateLabel(id, `▶ Resuming…`, 'prog');
      if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-resume', id }));
    }
  }
}

export function cancelTransfer(id) {
  let peerId = null;
  const tOut = outgoing.get(id);
  if (tOut) {
    tOut.cancelled = true;
    peerId = tOut.targetPeerId;
    outgoing.delete(id);
  }
  const tIn = incoming.get(id);
  if (tIn) {
    peerId = tIn.sourcePeerId;
    if (tIn.tempPath) window.electronAPI.incomingCancel(tIn.tempPath);
    incoming.delete(id);
  }

  if (peerId) {
    const peer = peers.get(peerId);
    if (peer?.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ type: 'file-cancel', id }));
  }
  markError(id, '✕ Cancelled');
  saveState();
}

export function handleIncomingChunk(id, index, dataB64, dc) {
  const t = incoming.get(id);
  if (!t) return;
  
  const data = base64ToU8(dataB64);
  if (t.tempPath && index < (t.receivedChunks || 0)) {
    // Already have it on disk, just ack and ignore
    dc?.send(JSON.stringify({ type: 'file-ack', id, index }));
    return;
  }
  
  if (t.tempPath) {
    window.electronAPI.incomingWrite({ tempPath: t.tempPath, data, index });
    t.receivedCount++;
    const pct = (t.receivedCount / t.total) * 100;
    updateProgress(id, pct, `${fmtSpeed(0)} · ${fmtBytes(t.receivedCount * CHUNK_SIZE)} / ${fmtBytes(t.size)}`);
    dc?.send(JSON.stringify({ type: 'file-ack', id, index }));
  }
}

export function handleData(raw, peerId, deviceName) {
  const msg = JSON.parse(raw);
  const peer = peers.get(peerId);
  const dc   = peer?.dc;

  switch (msg.type) {
    case 'file-start': {
      // ── Cleanup stale entry for same file from same device (if ID changed) ──
      const staleId = [...incoming.entries()].find(([sid, st]) => 
        sid !== msg.id && st.name === msg.name && st.size === msg.size && st.sourcePeerId === peerId
      )?.[0];
      if (staleId) {
        incoming.delete(staleId);
        const oldEl = document.getElementById(`ti-${staleId}`);
        if (oldEl) oldEl.remove();
      }

      if (!incoming.has(msg.id)) {
        incoming.set(msg.id, { name: msg.name, size: msg.size, total: msg.totalChunks, sourcePeerId: peerId, deviceName, receivedCount: 0 });
        addTransferItem(msg.id, msg.name, msg.size, 'receive', deviceName);
      }
      window.electronAPI.incomingInit({ name: msg.name, size: msg.size, deviceName }).then(({ tempPath, receivedChunks }) => {
        const t = incoming.get(msg.id);
        if (!t) return;
        t.tempPath = tempPath;
        if (receivedChunks > 0) {
          t.receivedCount = receivedChunks;
          t.receivedChunks = receivedChunks;
          updateProgress(msg.id, (receivedChunks / t.total) * 100, `${fmtBytes(receivedChunks * CHUNK_SIZE)} / ${fmtBytes(t.size)}`);
        }
        dc?.send(JSON.stringify({ type: 'file-resume-request', id: msg.id, fromChunk: receivedChunks }));

        if (t.bufferedChunks) {
          t.bufferedChunks.forEach(c => {
            if (c.index >= receivedChunks) {
              window.electronAPI.incomingWrite({ tempPath: t.tempPath, data: c.data, index: c.index });
              t.receivedCount++;
            }
          });
          t.bufferedChunks = null;
        }
      });
      break;
    }
    case 'file-chunk': {
      const t = incoming.get(msg.id);
      if (!t) return;
      
      if (!t.tempPath) {
        t.bufferedChunks = t.bufferedChunks || [];
        t.bufferedChunks.push({ index: msg.index, data: msg.data });
        return;
      }
      
      handleIncomingChunk(msg.id, msg.index, msg.data, dc);
      break;
    }
    case 'file-done': {
      const t = incoming.get(msg.id);
      if (!t) return;
      
      const commit = () => {
        window.electronAPI.incomingCommit({ tempPath: t.tempPath, name: t.name, deviceName: t.deviceName })
          .then(p => markDone(msg.id, p ? '✓ Saved' : '✓ Done'))
          .catch(err => { console.error('[Save] IPC error:', err); markError(msg.id, '✕ Save failed'); });
        incoming.delete(msg.id);
      };

      if (t.tempPath) commit();
      else {
        const iv = setInterval(() => {
          if (t.tempPath) { clearInterval(iv); commit(); }
        }, 50);
      }
      break;
    }
    case 'file-cancel': {
      let t = incoming.get(msg.id);
      if (t) {
        if (t.tempPath) window.electronAPI.incomingCancel(t.tempPath);
        incoming.delete(msg.id); markError(msg.id, '✕ Cancelled'); 
      }
      t = outgoing.get(msg.id);
      if (t) {
        t.cancelled = true;
        outgoing.delete(msg.id);
        markError(msg.id, '✕ Cancelled by receiver');
        saveState();
      }
      break;
    }
    case 'file-pause': {
      let t = outgoing.get(msg.id); 
      if (t) {
        pauseTransfer(msg.id);
        updateLabel(msg.id, `⏸ Paused by receiver`, 'warn');
        return;
      }
      t = incoming.get(msg.id);
      if (t) {
        t.paused = true;
        updatePauseBtn(msg.id, true);
        updateLabel(msg.id, `⏸ Paused by sender`, 'warn');
      }
      break;
    }
    case 'file-resume': {
      let t = outgoing.get(msg.id); 
      if (t) {
        resumeTransfer(msg.id);
        return;
      }
      t = incoming.get(msg.id);
      if (t) {
        t.paused = false;
        updatePauseBtn(msg.id, false);
        updateLabel(msg.id, `▶ Resuming…`, 'prog');
      }
      break;
    }
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
      if (t.ackedCount % 5 === 0 || t.ackedCount === t.totalChunks) {
        const elapsed      = (Date.now() - (t.speedStart || t.startTime)) / 1000 || 1;
        const ackedDelta   = t.ackedCount - (t.speedStartAcked || 0);
        const speed        = Math.max(0, (ackedDelta * CHUNK_SIZE) / elapsed);
        const confirmedBytes = Math.min(t.ackedCount * CHUNK_SIZE, t.size);
        updateProgress(msg.id, (t.ackedCount / t.totalChunks) * 100, `${fmtSpeed(speed)} · ${fmtBytes(confirmedBytes)} / ${fmtBytes(t.size)}`);
      }
      break;
    }
  }
}
