export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function u8ToBase64(u8) { let b = ''; u8.forEach(c => b += String.fromCharCode(c)); return btoa(b); }
export function base64ToU8(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export function mergeChunks(chunks) {
  const total = chunks.reduce((s, c) => s + (c?.length ?? 0), 0);
  const out = new Uint8Array(total); let off = 0;
  chunks.filter(Boolean).forEach(c => { out.set(c, off); off += c.length; }); return out;
}
export function mergeChunksDense(chunks, totalChunks) {
  let totalBytes = chunks.reduce((s, c) => s + (c?.length ?? 0), 0);
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (chunks[i]) { out.set(chunks[i], off); off += chunks[i].length; }
  }
  return out;
}
export function fmtBytes(b) {
  if (!b || b < 0) return '0 B';
  if (b < 1024) return b + ' B'; if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(1) + ' MB'; return (b / 1024 ** 3).toFixed(2) + ' GB';
}
export function fmtSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + ' B/s'; if (bps < 1024 ** 2) return (bps / 1024).toFixed(0) + ' KB/s';
  return (bps / 1024 ** 2).toFixed(1) + ' MB/s';
}
export function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
