# EazyShare Master Developer Guide

This document is the definitive technical reference for the EazyShare project. It covers the high-level architecture, low-level networking protocols, and the intricate state management required for reliable peer-to-peer file sharing.

---

## 1. System Architecture

EazyShare is a cross-platform (Phone ↔ PC) file transfer system built on a peer-to-peer (P2P) architecture.

### Process Topology

*   **Main Process (Node.js)**
    *   **Signaling Server**: WebSocket hub for peer discovery.
    *   **HTTP Server**: Serves mobile assets on the LAN.
    *   **Disk I/O**: Direct filesystem access for chunked writes/reads.
    *   **Firewall**: Automated port management.
*   **Renderer Process (Electron)**
    *   **WebRTC Peer (PC)**: Manages the desktop-side DataChannel.
    *   **Desktop UI**: The user dashboard and transfer management.
*   **Mobile Client (Browser)**
    *   **WebRTC Peer (Mobile)**: Manages the phone-side DataChannel.
    *   **Mobile UI**: Responsive interface for selection and downloads.

---

## 2. Communication Protocols

### A. Signaling (WebSocket)
The signaling server acts as a matchmaker. It routes messages based on a unique `peerId`.
- **Handshake**: `offer` -> `answer` -> `ice-candidates`.
- **Targeting**: Every signaling message includes a `target` field. The server only forwards messages to the specified `peerId`.

### B. Data Transfer (WebRTC DataChannel)
Once established, the DataChannel is the primary highway for all data.
- **Ordered**: `true` (Crucial for file reassembly).
- **Chunk Size**: `64KB`.
- **Protocol**: Custom JSON-wrapped binary protocol.

---

## 3. The Transfer Engine: Deep Dive

### Chunking & Back-pressure
To prevent memory overflow and DataChannel crashes, EazyShare implements a sophisticated back-pressure mechanism.

```javascript
// Flow Control Logic
async function streamChunks(id, fromChunk) {
  const t = outgoing.get(id);
  for (let i = fromChunk; i < t.totalChunks; i++) {
    // BACK-PRESSURE: Wait if DataChannel buffer is full
    while (dc.bufferedAmount > 4194304) { // 4MB threshold
      await sleep(50);
      if (t.cancelled || t.paused) return;
    }
    
    const chunk = await readChunk(t.path, i);
    dc.send(JSON.stringify({ type: 'file-chunk', data: toB64(chunk), index: i }));
  }
}
```

### Resume Mechanism
Resume logic is based on **Byte-Level Alignment**.
1. **Detection**: Upon connection, the receiver checks the `Downloads/EazyShare/<DeviceName>/` folder for `${name}.${size}.eazydownload`.
2. **Calculation**: `receivedCount = Math.floor(existingFileSize / 65536)`.
3. **Request**: Receiver sends `file-resume-request` with `fromChunk: receivedCount`.
4. **Sync**: Sender seeks the original file to `receivedCount * 65536` and begins streaming.

---

## 4. State Management

### State Store Structure
The application uses `Map` objects for real-time state and `localStorage`/`JSON files` for persistence.

- **`peers`**: Tracks active WebRTC connections.
- **`incoming`**: Tracks downloads. Keyed by `transferId`.
- **`outgoing`**: Tracks uploads. Keyed by `transferId`.

### Data Integrity
To prevent "Ghost Progress" (where the UI shows progress but data isn't written):
1. **ACK Driven**: The sender only increments its `ackedCount` after receiving a `file-ack` from the receiver.
2. **Atomic Writes**: Chunks are written to disk synchronously via IPC. If a write fails, the ack is never sent, and the sender will eventually retry or timeout.

---

## 5. Security & Isolation

### A. File Sanitization
The Main process strictly sanitizes all incoming filenames to prevent **Path Traversal** attacks.
```javascript
function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}
```

### B. Network Isolation
EazyShare is explicitly configured to ignore non-LAN interfaces.
- **Primary IP**: The `ipDetector` filters for `192.168.x.x`, `10.x.x.x`, or `172.16.x.x`.
- **P2P Privacy**: Because `iceServers` is empty, candidates never include public IPs, ensuring the connection is physically impossible to establish over the internet.

---

## 6. IPC Bridge (Preload API)

The `window.electronAPI` bridge is the only way the Renderer can interact with the system.

| Method | Description | Payload |
| :--- | :--- | :--- |
| `incomingInit` | Prepares a temp file on disk. | `{ name, size, deviceName }` |
| `incomingWrite` | Writes a 64KB chunk. | `{ tempPath, data, index }` |
| `incomingCommit`| Renames temp file to original. | `{ tempPath }` |
| `readFileSlice` | Reads a chunk from disk. | `{ path, index }` |

---

## 7. UI Components & Aesthetics

EazyShare follows a **Glassmorphic Dark Theme** design system.

- **Colors**: Deep purples (`#0f0c29`), neon accents (`#00d2ff`), and semi-transparent backgrounds.
- **Animations**: CSS Transitions are used for all state changes (connecting, progress bars, card reveals).
- **Responsiveness**: The Mobile UI uses a flexbox-based layout that adapts from small phones to large tablets.

---

## 8. Debugging Guide

### Common CLI Commands
- `npm run dev`: Starts the app with Chrome DevTools open.
- `npm run build`: Packages the app and generates the NSIS installer.

### Log Locations
- **Main Logs**: Appear in the terminal where `npm run dev` was started.
- **Renderer Logs**: Viewable in the Electron Console (`Ctrl+Shift+I`).
- **Mobile Logs**: Viewable in the mobile browser's remote debugging console.

---

## 9. Future Roadmap
- [ ] **Chunk Checksums**: Add MD5/SHA hashes for every chunk to guarantee 100% integrity.
- [ ] **QR Code Fallback**: Allow manual IP entry if the camera is unavailable.
- [ ] **Batch Actions**: "Pause All" and "Clear All Finished" buttons.
