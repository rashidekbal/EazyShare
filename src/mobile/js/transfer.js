import { CHUNK_SIZE, MAX_BUFFERED, state, outgoing, incoming } from './state.js';
import { u8ToB64, b64ToU8, guessMime, fmtBytes, fmtSpeed, sleep } from './utils.js';
import { addItem, updateProg, updateLabel, updPauseBtn, markDoneWithDL, markSentDone, markErr } from './ui.js';

export function saveOutgoingState() {
  const pending = [];
  for (const [id, t] of outgoing.entries()) {
    if (!t.cancelled && !t.streaming && t.totalChunks > 0 && (!t.file || t.nextChunk < t.totalChunks)) {
      // Save metadata only, not the File object
      pending.push({ id, name: t.name || (t.file && (t.file.webkitRelativePath || t.file.name)), size: t.size || (t.file && t.file.size), totalChunks: t.totalChunks });
    }
  }
  localStorage.setItem('eazy_outgoing', JSON.stringify(pending));
}

export async function sendFile(file) {
  if (!state.peerReady) { alert('Not connected to PC yet.'); return; }
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileName = file.webkitRelativePath || file.name;
  outgoing.set(id, { file, name: fileName, size: file.size, totalChunks, nextChunk: 0, ackedCount: 0, speedStartAcked: 0, speedStart: Date.now(), paused: false, streaming: false, cancelled: false, startTime: Date.now() });
  addItem(id, fileName, file.size, 'send');
  saveOutgoingState();
  state.dc.send(JSON.stringify({ type: 'file-start', id, name: fileName, size: file.size, totalChunks, isResume: false }));
  await streamChunks(id);
}

export async function resumePendingFile(id, file) {
  const t = outgoing.get(id);
  if (!t) return;
  if (!state.peerReady || !state.dc || state.dc.readyState !== 'open') {
    updateLabel(id, '⚠ PC not ready — wait for connection');
    return;
  }
  t.file = file;
  t.name = file.webkitRelativePath || file.name;
  t.size = file.size;
  t.totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  t.paused = false;
  t.startTime = Date.now();
  const initialPct = t.totalChunks > 0 ? (t.nextChunk / t.totalChunks) * 100 : 0;
  updateProg(id, initialPct, '🔄 Negotiating resume...');
  state.dc.send(JSON.stringify({ type: 'file-start', id, name: t.name, size: t.size, totalChunks: t.totalChunks, isResume: true }));
}

export async function streamChunks(id, fromChunk = 0) {
  const s = outgoing.get(id);
  if (!s || s.streaming) return;
  s.streaming = true; s.paused = false;
  s.ackedCount      = fromChunk;
  s.speedStart      = Date.now();
  s.speedStartAcked = fromChunk;
  if (fromChunk === 0) s.startTime = Date.now();

  for (s.nextChunk = fromChunk; s.nextChunk < s.totalChunks; ) {
    const i = s.nextChunk;
    if (!outgoing.has(id) || s.cancelled) return;
    if (s.paused) { s.streaming = false; return; }
    if (!state.peerReady || !state.dc || state.dc.readyState !== 'open') { s.streaming = false; updateLabel(id, '⏸ PC offline'); return; }
    while (state.dc.bufferedAmount > MAX_BUFFERED) {
      await sleep(50);
      if (!state.peerReady || s.paused || s.cancelled) { s.streaming = false; return; }
    }
    const blob  = s.file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const slice = await blob.arrayBuffer();
    state.dc.send(JSON.stringify({ type: 'file-chunk-meta', id, index: i, total: s.totalChunks }));
    state.dc.send(slice);
    if (s.nextChunk === i) s.nextChunk++;
  }
  state.dc.send(JSON.stringify({ type: 'file-done', id }));
  s.streaming = false; markSentDone(id); outgoing.delete(id);
  saveOutgoingState();
}

export function togglePause(id) {
  let t = outgoing.get(id);
  if (t) {
    if (t.paused || !t.streaming) {
      if (!state.peerReady) { updateLabel(id, '⚠ PC offline'); return; }
      t.paused = false; updPauseBtn(id, false);
      const pct = t.totalChunks > 0 ? (t.nextChunk / t.totalChunks) * 100 : 0;
      updateProg(id, pct, `▶ Resuming from ${fmtBytes(t.nextChunk * CHUNK_SIZE)}…`);
      streamChunks(id, t.nextChunk);
    } else {
      t.paused = true;
      updPauseBtn(id, true);
      const confirmed = Math.min((t.ackedCount || 0) * CHUNK_SIZE, t.file.size);
      const pct       = t.totalChunks > 0 ? ((t.ackedCount || 0) / t.totalChunks) * 100 : 0;
      updateProg(id, pct, `⏸ Paused — ${fmtBytes(confirmed)} / ${fmtBytes(t.file.size || t.size)}`);
      if (state.dc?.readyState === 'open') state.dc.send(JSON.stringify({ type: 'file-pause', id }));
    }
    saveOutgoingState();
    return;
  }
  t = incoming.get(id);
  if (t) {
    t.paused = !t.paused;
    updPauseBtn(id, t.paused);
    if (t.paused) {
      const pct = t.total > 0 ? (t.chunks.filter(Boolean).length / t.total) * 100 : 0;
      updateProg(id, pct, `⏸ Paused`);
      if (state.dc?.readyState === 'open') state.dc.send(JSON.stringify({ type: 'file-pause', id }));
    } else {
      const pct = t.total > 0 ? (t.chunks.filter(Boolean).length / t.total) * 100 : 0;
      updateProg(id, pct, `▶ Resuming…`);
      if (state.dc?.readyState === 'open') state.dc.send(JSON.stringify({ type: 'file-resume', id }));
    }
  }
}

export function cancelTransfer(id) {
  let t = incoming.get(id);
  if (t) { incoming.delete(id); markErr(id, '✕ Cancelled'); }
  t = outgoing.get(id);
  if (t) { t.cancelled = true; outgoing.delete(id); markErr(id, '✕ Cancelled'); saveOutgoingState(); }
  if (state.dc?.readyState === 'open') state.dc.send(JSON.stringify({ type: 'file-cancel', id }));
}

function handleIncomingChunk(id, index, data) {
  const t = incoming.get(id); if (!t) return;
  t.chunks[index] = data instanceof Uint8Array ? data : new Uint8Array(data);
  const done  = t.chunks.filter(Boolean).length;
  if (!t.startTime) t.startTime = Date.now();
  const speed = (done * CHUNK_SIZE) / ((Date.now() - t.startTime) / 1000 || 1);
  const confirmed = Math.min(done * CHUNK_SIZE, t.size);
  updateProg(id, (done / t.total) * 100, `${fmtSpeed(speed)} · ${fmtBytes(confirmed)} / ${fmtBytes(t.size)}`);
  state.dc.send(JSON.stringify({ type: 'file-ack', id, index }));
}

export function handleData(raw) {
  try {
    if (typeof raw !== 'string') {
      if (state.pendingChunk) {
        handleIncomingChunk(state.pendingChunk.id, state.pendingChunk.index, raw);
        state.pendingChunk = null;
      }
      return;
    }
    const msg = JSON.parse(raw);
    if (!msg || !msg.id) return;
    switch (msg.type) {
    case 'file-start': {
      // Cleanup stale entry for same file (if ID changed)
      const staleId = [...incoming.entries()].find(([sid, st]) => 
        sid !== msg.id && st.name === msg.name && st.size === msg.size
      )?.[0];
      if (staleId) {
        incoming.delete(staleId);
        const oldEl = document.getElementById(`t-${staleId}`);
        if (oldEl) oldEl.remove();
      }

      if (!incoming.has(msg.id)) {
        incoming.set(msg.id, { name: msg.name, size: msg.size, total: msg.totalChunks, chunks: [], startTime: Date.now() });
        addItem(msg.id, msg.name, msg.size, 'receive');
      }
      const t = incoming.get(msg.id);
      const received = t.chunks ? t.chunks.filter(Boolean).length : 0;
      state.dc.send(JSON.stringify({ type: 'file-resume-request', id: msg.id, fromChunk: received }));
      break;
    }
    case 'file-chunk-meta': {
      const t = incoming.get(msg.id);
      if (!t) return;
      state.pendingChunk = msg;
      break;
    }
    case 'file-chunk': {
      handleIncomingChunk(msg.id, msg.index, b64ToU8(msg.data));
      break;
    }
    case 'file-done': {
      const t = incoming.get(msg.id); if (!t) return;
      markDoneWithDL(msg.id, new Blob(t.chunks.filter(Boolean), { type: guessMime(t.name) }), t.name);
      incoming.delete(msg.id);
      break;
    }
    case 'file-cancel': {
      let t = incoming.get(msg.id);
      if (t) { incoming.delete(msg.id); markErr(msg.id, '✕ Cancelled by PC'); }
      t = outgoing.get(msg.id);
      if (t) { t.cancelled = true; outgoing.delete(msg.id); markErr(msg.id, '✕ Cancelled by PC'); }
      break;
    }
    case 'file-pause': {
      let t = outgoing.get(msg.id); 
      if (t) {
        t.paused = true;
        updPauseBtn(msg.id, true);
        // Ensure ackedCount is at least nextChunk to avoid jumping back to 0% on resume-pause race
        const currentAcked = Math.max(t.ackedCount || 0, t.nextChunk || 0);
        const confirmed = Math.min(currentAcked * CHUNK_SIZE, t.size);
        const pct       = t.totalChunks > 0 ? (currentAcked / t.totalChunks) * 100 : 0;
        updateProg(msg.id, pct, `⏸ Paused by PC — ${fmtBytes(confirmed)} / ${fmtBytes(t.size)}`);
        saveOutgoingState();
      }
      t = incoming.get(msg.id);
      if (t) {
        t.paused = true;
        updPauseBtn(msg.id, true);
        const doneCount = t.chunks.filter(Boolean).length;
        const pct = t.total > 0 ? (doneCount / t.total) * 100 : 0;
        updateProg(msg.id, pct, `⏸ Paused by PC`);
      }
      break;
    }
    case 'file-resume': {
      let t = outgoing.get(msg.id); 
      if (t) {
        if (t.paused) {
          t.paused = false; updPauseBtn(msg.id, false);
          t.ackedCount = t.nextChunk || 0;
          const pct = t.totalChunks > 0 ? (t.ackedCount / t.totalChunks) * 100 : 0;
          updateProg(msg.id, pct, `▶ Resuming from ${fmtBytes(t.ackedCount * CHUNK_SIZE)}…`);
          saveOutgoingState();
          streamChunks(msg.id, t.nextChunk);
        }
      }
      t = incoming.get(msg.id);
      if (t) {
        t.paused = false;
        updPauseBtn(msg.id, false);
        const pct = t.total > 0 ? (t.chunks.filter(Boolean).length / t.total) * 100 : 0;
        updateProg(msg.id, pct, `▶ Resuming…`);
      }
      break;
    }
    case 'file-resume-request': {
      let t = outgoing.get(msg.id);
      if (t && t.file && !t.cancelled) {
        t.nextChunk = msg.fromChunk || 0;
        t.ackedCount = t.nextChunk; // Sync ackedCount immediately
        const confirmed = Math.min(t.nextChunk * CHUNK_SIZE, t.file.size);
        const pct       = t.totalChunks > 0 ? (t.nextChunk / t.totalChunks) * 100 : 0;
        updateProg(msg.id, pct, `▶ Resuming from ${fmtBytes(confirmed)}…`);
        streamChunks(msg.id, t.nextChunk);
      }
      break;
    }
    case 'file-ack': {
      const t = outgoing.get(msg.id); if (!t) return;
      t.ackedCount = (t.ackedCount || 0) + 1;
      if (t.ackedCount % 5 === 0 || t.ackedCount === t.totalChunks) {
        const elapsed    = (Date.now() - (t.speedStart || t.startTime)) / 1000 || 1;
        const ackedDelta = t.ackedCount - (t.speedStartAcked || 0);
        const speed      = Math.max(0, (ackedDelta * CHUNK_SIZE) / elapsed);
        const confirmed  = Math.min(t.ackedCount * CHUNK_SIZE, t.size || (t.file && t.file.size) || 0);
        updateProg(msg.id, (t.ackedCount / t.totalChunks) * 100, `${fmtSpeed(speed)} · ${fmtBytes(confirmed)} / ${fmtBytes(t.size || (t.file && t.file.size))}`);
      }
      break;
    }
  }
} catch (e) {
  console.error('[DC] Data handling error:', e);
}
}
