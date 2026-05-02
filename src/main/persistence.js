const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const STATE_FILE = () => path.join(app.getPath('userData'), 'eazy_transfers.json');

/**
 * Save outgoing transfer state so they survive app restarts.
 * Only saves transfers that are in-progress (not done/cancelled).
 *
 * @param {Array<{id, filePath, name, size, totalChunks, nextChunk, deviceName}>} transfers
 */
function saveTransferState(transfers) {
  try {
    const saveable = transfers.filter(t => t.filePath && !t.done && !t.cancelled);
    fs.writeFileSync(STATE_FILE(), JSON.stringify(saveable, null, 2), 'utf8');
  } catch (e) {
    console.error('[Persist] Save failed:', e.message);
  }
}

/**
 * Load saved transfer states from disk.
 * Returns empty array if nothing saved or file is corrupt.
 */
function loadTransferStates() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const arr = JSON.parse(raw);
    // Validate each entry has a file that still exists on disk
    return arr.filter(t => t.filePath && fs.existsSync(t.filePath));
  } catch {
    return [];
  }
}

/**
 * Read a byte slice from a file on disk.
 * Used by renderer to resume persisted transfers without re-reading the whole file.
 */
function readFileSlice(filePath, start, end) {
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(end - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return Array.from(buf); // serializable over IPC
}

module.exports = { saveTransferState, loadTransferStates, readFileSlice };
