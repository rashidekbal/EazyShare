export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function u8ToB64(u8) {
  const CHUNK = 8192;
  let s = '';
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
export function b64ToU8(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export function fmtBytes(b) { if (!b||b<0) return '0 B'; if (b<1024) return b+' B'; if (b<1024**2) return (b/1024).toFixed(1)+' KB'; if (b<1024**3) return (b/1024**2).toFixed(1)+' MB'; return (b/1024**3).toFixed(2)+' GB'; }
export function fmtSpeed(bps) { if (bps<1024) return bps.toFixed(0)+' B/s'; if (bps<1024**2) return (bps/1024).toFixed(0)+' KB/s'; return (bps/1024**2).toFixed(1)+' MB/s'; }
export function guessMime(name) { const ext = name.split('.').pop().toLowerCase(); return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',pdf:'application/pdf',mp4:'video/mp4',mp3:'audio/mpeg',zip:'application/zip',txt:'text/plain',json:'application/json'})[ext]||'application/octet-stream'; }
export function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
