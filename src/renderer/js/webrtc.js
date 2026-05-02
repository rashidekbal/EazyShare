import { MY_ID, peers, selectedPeers, outgoing, refs } from './state.js';
import { setStatus, addDeviceCard, updateDeviceCard, updateSendHint, dom, updateLabel } from './ui.js';
import { handleData } from './transfer.js';

export function connectSignaling(wsUrl) {
  const ws = new WebSocket(wsUrl);
  refs.ws = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type: 'register', id: MY_ID, clientType: 'desktop' }));
  ws.onmessage = async (e) => handleSignaling(JSON.parse(e.data), ws);
  ws.onclose = () => { setStatus('error', 'Server disconnected', 'Reconnecting…'); setTimeout(() => connectSignaling(wsUrl), 3000); };
  ws.onerror = () => setStatus('error', 'Connection error', 'Check network');
}

async function handleSignaling(msg, ws) {
  switch (msg.type) {
    case 'peer-connected':
      if (msg.peerType === 'mobile') {
        if (peers.has(msg.peerId)) {
          console.log(`[PC] Replacing stale connection for ${msg.peerId}`);
          onPeerDisconnect(msg.peerId, true);
        }
        setStatus('connected', `${msg.deviceName} connecting…`, 'Setting up channel');
        await initPeer(msg.peerId, msg.deviceName, ws);
      }
      break;
    case 'peer-disconnected':
      if (msg.peerType === 'mobile') onPeerDisconnect(msg.peerId);
      break;
    case 'answer': {
      const p = peers.get(msg.from);
      if (p?.pc) await p.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      break;
    }
    case 'ice-candidate': {
      const p = peers.get(msg.from);
      if (p?.pc && msg.candidate) await p.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      break;
    }
  }
}

async function initPeer(peerId, deviceName, ws) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('eazyshare', { ordered: true });

  peers.set(peerId, { pc, dc, deviceName, ready: false, ws });
  addDeviceCard(peerId, deviceName);
  setupDC(dc, peerId, deviceName);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate, target: peerId }));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') onPeerDisconnect(peerId);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, target: peerId }));
}

function setupDC(dc, peerId, deviceName) {
  dc.onopen = () => {
    const p = peers.get(peerId);
    if (p) p.ready = true;
    updateDeviceCard(peerId, true);
    setStatus('ready', `${peers.size} device(s) connected`, 'Select a device to send files');

    if (peers.size === 1) {
      const chk = document.getElementById('dchk-' + peerId);
      if (chk) { chk.checked = true; selectedPeers.add(peerId); updateSendHint(); }
    }

    let delay = 0;
    for (const [id, t] of outgoing) {
      if (!t.done && !t.cancelled && t.targetPeerId === peerId) {
        setTimeout(() => {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ type: 'file-start', id, name: t.name, size: t.size, totalChunks: t.totalChunks, isResume: true }));
            updateLabel(id, '🔄 Reconnected — waiting for device…', 'prog');
          }
        }, delay);
        delay += 150;
      }
    }
  };
  dc.onclose  = () => onPeerDisconnect(peerId);
  dc.onmessage = (e) => handleData(e.data, peerId, deviceName);
}

export function onPeerDisconnect(peerId, skipCardRemoval = false) {
  if (!peers.has(peerId)) return;

  for (const [id, t] of outgoing) {
    if (t.targetPeerId === peerId && !t.done && !t.cancelled) {
      t.streaming = false;
      updateLabel(id, '⏸ Device disconnected', 'warn');
    }
  }

  const p = peers.get(peerId);
  if (p) {
    p.pc?.close();
    if (p.dc) p.dc.onmessage = p.dc.onopen = p.dc.onclose = null;
  }

  peers.delete(peerId);
  
  if (!skipCardRemoval) {
    selectedPeers.delete(peerId);
    document.getElementById('dc-' + peerId)?.remove();
    if (dom.devList.querySelectorAll('.device-card').length === 0) {
      dom.noDevices.style.display = '';
    }
    updateSendHint();
  }

  const connectedCount = [...peers.values()].filter(p => p.ready).length;
  setStatus(
    connectedCount > 0 ? 'ready'   : 'waiting',
    connectedCount > 0 ? `${connectedCount} device(s) connected` : 'Waiting for phones',
    connectedCount > 0 ? 'Check devices to send' : 'Scan QR with your phone'
  );
}
