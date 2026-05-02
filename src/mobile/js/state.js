export const CHUNK_SIZE   = 65536;
export const MAX_BUFFERED = 1024 * 1024 * 4;

let savedId = localStorage.getItem('eazy_my_id');
if (!savedId) {
  savedId = 'mobile-' + Math.random().toString(36).slice(2, 9);
  localStorage.setItem('eazy_my_id', savedId);
}
export const MY_ID = savedId;

export const state = {
  ws: null,
  pc: null,
  dc: null,
  peerReady: false,
  desktopId: null
};

export const incoming = new Map();
export const outgoing = new Map();
