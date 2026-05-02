# eazyShare

> **Zero-install LAN file sharing between your PC and any phone — no internet, no accounts, no cables.**

Scan a QR code, drop files, done. eazyShare uses WebRTC to create a direct peer-to-peer connection over your local Wi-Fi, so transfers are as fast as your router allows.

---

## ✨ Features

| Feature                          | Details                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| 📱 **Zero-install on mobile**    | Phone opens a web app in the browser — no app download needed                                |
| ↔ **Bidirectional transfer**     | PC → Phone and Phone → PC simultaneously                                                     |
| 📶 **LAN only**                  | All data stays on your local network. No internet required                                   |
| ⏸ **Pause & Resume**             | Pause any transfer and resume exactly where it stopped                                       |
| 🔁 **Auto-resume on disconnect** | Phone drops Wi-Fi? Reconnect and transfers pick up from the last confirmed chunk             |
| 💾 **Persist across restarts**   | Both incoming and outgoing transfers are saved to disk — resume perfectly after app restart  |
| 📲 **Multi-device**              | Connect multiple phones simultaneously with independent transfer channels                    |
| 📂 **Per-device folders**        | Files from each phone saved to `Downloads/EazyShare/<DeviceName>/`                           |
| 📁 **Folder Support**            | Drop folders to recursively send all contents with structure preserved                       |
| 🔢 **Broadcast**                 | Check multiple device checkboxes and drop once to send to all of them                        |
| 🔥 **Firewall auto-config**      | On first run, offers to add Windows Firewall rules automatically (UAC prompt)                |

---

## 📸 How It Works

```
┌─────────────────────────┐         LAN Wi-Fi          ┌──────────────────────┐
│   Windows PC (Electron) │◄───────────────────────────►│  Phone (Browser)     │
│                         │                             │                      │
│  • Express HTTP server  │  ① Phone scans QR          │  • Opens web app     │
│  • WebSocket signaling  │  ② WS signaling handshake  │  • WebRTC answer     │
│  • WebRTC DataChannel   │  ③ Direct P2P data channel │  • Send / Receive    │
│  • File chunking engine │  ④ 64KB chunks + ACKs      │  • Download trigger  │
└─────────────────────────┘                             └──────────────────────┘
```

1. The desktop app starts an **Express HTTP server** (port `7523`) serving the mobile web UI
2. A **WebSocket signaling server** (port `7524`) handles WebRTC offer/answer/ICE exchange
3. Once signaling completes, a **direct WebRTC DataChannel** opens between PC and phone
4. Files are split into **64 KB chunks**, each ACK'd by the receiver — enabling precise resume

---

## 🗂 Project Structure

```
eazyShare/
├── assets/
│   ├── icon.png                 # App icon (512×512)
│   └── icon.ico                 # Windows installer icon
├── src/
│   ├── main/                    # Electron main process (Node.js)
│   │   ├── index.js             # App entry: window, IPC, servers
│   │   ├── firewall.js          # Windows Firewall rule management
│   │   ├── persistence.js       # Save/load transfer state across restarts
│   │   ├── network/
│   │   │   └── ipDetector.js    # LAN IP detection
│   │   ├── server/
│   │   │   ├── httpServer.js    # Express: serves mobile UI + /api/config
│   │   │   └── signalingServer.js # WebSocket: routes WebRTC signaling per-device
│   │   └── utils/
│   │       └── qrGenerator.js   # Generates QR code data URL
│   ├── renderer/                # Desktop UI (Chromium renderer)
│   │   ├── index.html
│   │   ├── app.js               # WebRTC multi-device, chunking, persistence
│   │   └── styles.css
│   └── mobile/                  # Mobile web app (served by Express)
│       ├── index.html
│       ├── app.js               # WebRTC client, send/receive, device name
│       └── styles.css
├── preload.js                   # Context bridge: renderer ↔ main IPC
├── electron-builder.config.js   # NSIS installer configuration
├── installer.nsh                # NSIS hook: remove firewall rules on uninstall
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- Windows 10 / 11
- Both PC and phone on the **same Wi-Fi network**

### Development

```bash
# Clone the repo
git clone https://github.com/rashidekbal/EazyShare.git
cd EazyShare

# Install dependencies
npm install

# Start in development mode (with DevTools)
npm run dev
```

### Build Windows Installer

```bash
npm run build
```

Produces `dist/eazyshare Setup 1.0.0.exe` — a standard NSIS installer (~96 MB) that:

- Creates Desktop + Start Menu shortcuts
- Launches eazyShare after installation
- Removes Windows Firewall rules cleanly on uninstall

---

## 📖 Usage Guide

### Desktop (Windows App)

1. **Launch eazyShare** — the QR code appears in the sidebar instantly
2. **First run only** — a dialog asks to add Windows Firewall rules. Click _Add Rules_ and approve the UAC prompt
3. **Connect a phone** — scan the QR code with any phone camera and tap the link
4. The phone appears as a **device card** in the sidebar with a checkbox
5. **Check one or more devices** — the drop zone activates
6. **Drop files** onto the drop zone (or click to browse) — transfer starts immediately
7. **Broadcast** — check multiple devices and drop files once to send to all simultaneously

### Mobile (Browser)

1. Scan the QR code and tap the link — the web app loads in your browser
2. Tap **Choose Files** to send files from your phone to the PC
3. Files received from the PC show a **⬇ Save** button to download them to your device
4. **Tap your device name** in the header to rename it (saved in localStorage)

### Pause & Resume

- **⏸** — pauses the transfer, icon immediately changes to **▶**
- **▶** — resumes from the exact byte where it stopped
- If the phone **disconnects mid-transfer**, reconnect and transfers auto-resume from the last confirmed chunk
- If the **PC app is restarted**, incomplete transfers are restored from disk and resume when the device reconnects


---

## ⚙️ Technical Details

### Port Allocation

| Port   | Service                      |
| ------ | ---------------------------- |
| `7523` | HTTP — mobile web UI         |
| `7524` | WebSocket — WebRTC signaling |

Both are added to Windows Firewall on first run and removed on uninstall.

### Transfer Protocol

```
PC                                        Phone
 │── file-start ────────────────────────►│  Announce file (name, size, chunks)
 │◄─ file-resume-request (fromChunk: N) ─│  Phone reports last received chunk
 │── file-chunk (index: N) ─────────────►│  Send 64 KB chunk
 │◄─ file-ack   (index: N) ─────────────│  Confirm received
 │── file-chunk (index: N+1) ───────────►│  Continue...
 │── file-done ──────────────────────────►│  Transfer complete
```

- **Chunk size:** 64 KB
- **Back-pressure:** Sender pauses when `dc.bufferedAmount > 4 MB` to prevent overflow
- **Progress:** Driven exclusively by ACKs — never by the send side — for accuracy
- **Speed display:** Calculated per-session (resets each resume) so it always reflects current throughput
- **Resume:** Phone reports `fromChunk`; PC reads the file from disk at the matching byte offset via IPC

### Multi-Device Architecture

Each connected phone gets its own:

- `RTCPeerConnection` and `RTCDataChannel`
- Targeted signaling (every message carries `target: peerId`)
- Independent transfer queues
- Download folder: `Downloads/EazyShare/<DeviceName>/`

Multiple phones never share a connection or interfere with each other's transfers.

### Persistence

Incomplete outgoing transfers are written to:

```
%APPDATA%\eazyShare\eazy_transfers.json
```

Each entry stores `filePath`, `name`, `size`, `totalChunks`, `nextChunk`, and `deviceName`. On restart, chunks are read directly from the original file path in 64 KB slices via IPC — the user does not need to re-select files.

---

## 🔒 Privacy & Security

- **100% local** — no data leaves your network
- **No accounts or cloud** — no login, no telemetry, no tracking
- **No STUN/TURN** — ICE candidates use LAN IPs only; connections never traverse the internet
- **DTLS encryption** — WebRTC DataChannels are encrypted by the spec

---

## 🛠 Configuration

### Changing Ports

In `src/main/index.js`:

```js
const PORT_HTTP = 7523;
const PORT_WS = 7524;
```

Update `src/main/firewall.js` to match if you change these.

### Device Name (Mobile)

Auto-detected from the browser user agent (e.g. `iPhone`, `Android Phone`) and saved in `localStorage`. To rename: **tap the device name** in the mobile header bar and type a new name — takes effect on the next connection.

---

## 📦 Dependencies

| Package            | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `electron`         | Desktop app framework                               |
| `express`          | Serves the mobile web UI                            |
| `ws`               | WebSocket signaling server                          |
| `qrcode`           | Generates the connection QR code                    |
| `uuid`             | Unique transfer IDs                                 |
| `electron-builder` | Packages the app as a Windows `.exe` NSIS installer |

---

## 🐛 Known Limitations

- **Windows only** — firewall, and installer are Windows-specific. The core would run on macOS/Linux with minor adjustments.
- **Same Wi-Fi required** — devices must be on the same network segment. Enterprise networks with AP client isolation will block connections.

---

## 📄 License

MIT © [rasidekbal](https://github.com/rashidekbal)

---

<div align="center">
  <strong>Built with Electron · WebRTC · Express · WebSockets</strong>
</div>
