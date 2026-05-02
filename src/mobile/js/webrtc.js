import { MY_ID, state, outgoing } from './state.js';
import { getDeviceName, setConn, setStatus, updateLabel } from './ui.js';
import { handleData } from './transfer.js';

let isConnecting = false;
export function connectSignaling(wsUrl) {
  if (isConnecting || (state.ws && state.ws.readyState === WebSocket.CONNECTING)) return;
  
  if (state.ws) {
    state.ws.onopen = state.ws.onmessage = state.ws.onclose = state.ws.onerror = null;
    try { state.ws.close(); } catch {}
  }
  
  isConnecting = true;
  setConn('connecting', 'Connecting…');
  setStatus('info', 'Connecting to PC…');
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    isConnecting = false;
    state.ws.send(JSON.stringify({ type: 'register', id: MY_ID, clientType: 'mobile', deviceName: getDeviceName() }));
    setStatus('info', 'Registered — waiting for PC…');
  };
  state.ws.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      await handleSignaling(msg);
    } catch (err) {
      console.error('[WS] Message error:', err);
    }
  };
  state.ws.onclose   = () => {
    isConnecting = false;
    state.peerReady = false; state.desktopId = null;
    setConn('error', 'Lost connection');
    setStatus('error', '⚠ Lost connection — retrying…');
    setTimeout(() => connectSignaling(wsUrl), 5000);
  };
  state.ws.onerror = () => {
    isConnecting = false;
    setConn('error', 'Error');
  };
}

export async function handleSignaling(msg) {
  switch (msg.type) {
    case 'peer-disconnected':
      state.peerReady = false; state.desktopId = null;
      setConn('error', 'PC offline');
      setStatus('error', '⚠ PC closed — reopen and rescan');
      for (const [id] of outgoing) updateLabel(id, '⏸ PC offline');
      break;
    case 'offer':
      state.desktopId = msg.from;
      await handleOffer(msg.sdp);
      break;
    case 'ice-candidate':
      if (state.pc && msg.candidate) await state.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      break;
  }
}

export async function handleOffer(sdp) {
  if (state.pc) {
    try { state.pc.close(); } catch {}
  }
  state.pc = new RTCPeerConnection({ iceServers: [] });

  state.pc.onicecandidate = ({ candidate }) => {
    if (candidate && state.desktopId) state.ws.send(JSON.stringify({ type: 'ice-candidate', candidate, target: state.desktopId }));
  };
  state.pc.ondatachannel = (e) => { state.dc = e.channel; setupDC(state.dc); };

  await state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await state.pc.createAnswer();
  await state.pc.setLocalDescription(answer);
  state.ws.send(JSON.stringify({ type: 'answer', sdp: state.pc.localDescription, target: state.desktopId }));
}

function setupDC(channel) {
  channel.onopen  = () => { state.peerReady = true; setConn('ready', 'Connected'); setStatus('ok', '✅ Ready! Select files to send or wait for PC'); };
  channel.onclose = () => { state.peerReady = false; setConn('error', 'Closed'); };
  channel.onmessage = (e) => handleData(e.data);
}
