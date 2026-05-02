export const CHUNK_SIZE   = 65536;
export const MAX_BUFFERED = 1024 * 1024 * 4;
export const MY_ID        = 'desktop-' + Math.random().toString(36).slice(2, 9);

export const peers = new Map();
export const selectedPeers = new Set();
export const outgoing = new Map();
export const incoming = new Map();

export const refs = { ws: null };
