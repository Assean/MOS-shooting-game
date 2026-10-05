const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const signalingUrlInput = document.querySelector('#signalingUrl');
const roomCodeInput = document.querySelector('#roomCode');
const playerNameInput = document.querySelector('#playerName');
const joinButton = document.querySelector('#joinButton');
const copyButton = document.querySelector('#copyButton');
const status = document.querySelector('#connectionStatus');
const playerCount = document.querySelector('#playerCount');

const keys = new Set();
const peers = new Map();
const players = new Map();
const shots = [];
let socket;
let lastFrame = performance.now();
let lastNetworkUpdate = 0;
let mouse = { x: .5, y: .5 };
let localPlayer = { x: .5, y: .5, angle: 0, color: '#70e5ff', name: '玩家' };

const params = new URLSearchParams(location.search);
roomCodeInput.value = params.get('room') || '';
signalingUrlInput.value = localStorage.getItem('signaling-url') || '';
playerNameInput.value = localStorage.getItem('player-name') || '';
const playerId = localStorage.getItem('player-id') || crypto.randomUUID();
localStorage.setItem('player-id', playerId);

function apiUrl(base, path) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  return url.toString();
}

async function savePlayerProfile(base) {
  const displayName = playerNameInput.value.trim() || '玩家';
  if (displayName.length > 20) throw new Error('玩家名稱不可超過 20 個字元。');
  localStorage.setItem('player-name', displayName);
  localPlayer.name = displayName;
  const response = await fetch(apiUrl(base, '/api/players'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, displayName }),
  });
  if (!response.ok) throw new Error('資料服務尚未完成設定。');
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#ff9c9c' : '#75e6a4';
}

function websocketUrl(base, room) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/${encodeURIComponent(room)}`;
  return url.toString();
}

function sendSignal(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(channel, message) {
  for (const peer of peers.values()) {
    const dataChannel = peer[channel];
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify(message));
  }
}

function updatePlayerCount() {
  const count = peers.size + 1;
  playerCount.textContent = `${count} 位玩家`;
}

async function startPeer(peerId, initiator) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  const peer = { pc, state: null, event: null };
  peers.set(peerId, peer);
  players.set(peerId, { x: .5, y: .5, angle: 0, color: '#ffca6c', name: '連線中' });
  updatePlayerCount();

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal({ type: 'signal', to: peerId, data: { candidate } });
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) removePeer(peerId);
  };
  pc.ondatachannel = ({ channel }) => attachChannel(peerId, channel);

  if (initiator) {
    attachChannel(peerId, pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    attachChannel(peerId, pc.createDataChannel('event'));
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal({ type: 'signal', to: peerId, data: { description: pc.localDescription } });
  }
  return peer;
}

function attachChannel(peerId, channel) {
  const peer = peers.get(peerId);
  if (!peer) return;
  peer[channel.label] = channel;
  channel.onopen = () => setStatus(`已直連 ${peers.size} 位玩家`);
  channel.onmessage = ({ data }) => receiveGameMessage(peerId, data);
}

function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  peer.pc.close();
  peers.delete(peerId);
  players.delete(peerId);
  updatePlayerCount();
}

async function receiveSignal(from, data) {
  const peer = await startPeer(from, false);
  if (data.description) {
    await peer.pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') {
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      sendSignal({ type: 'signal', to: from, data: { description: peer.pc.localDescription } });
    }
  }
  if (data.candidate) await peer.pc.addIceCandidate(data.candidate);
}

function receiveGameMessage(peerId, raw) {
  try {
    const message = JSON.parse(raw);
    if (message.type === 'state') players.set(peerId, { ...players.get(peerId), ...message.player });
    if (message.type === 'shot') shots.push({ ...message.shot, life: .18, color: '#ffca6c' });
  } catch { /* Ignore malformed peer messages. */ }
}

async function joinRoom() {
  const base = signalingUrlInput.value.trim().replace(/\/$/, '');
  const room = roomCodeInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!base || !room) return setStatus('請填入 Worker 網址與房間碼。', true);

  for (const id of [...peers.keys()]) removePeer(id);
  socket?.close();
  localStorage.setItem('signaling-url', base);
  roomCodeInput.value = room;
  history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
  setStatus('正在儲存玩家資料…');

  let nextSocket;
  try {
    await savePlayerProfile(base);
    nextSocket = new WebSocket(websocketUrl(base, room));
  } catch (error) {
    return setStatus(error.message || 'Worker 網址格式不正確。', true);
  }
  socket = nextSocket;

  nextSocket.onopen = () => setStatus('已連線至房間，正在尋找玩家…');
  nextSocket.onerror = () => {
    if (socket === nextSocket) setStatus('無法連上協商服務。請確認 Worker 網址已部署。', true);
  };
  nextSocket.onclose = () => {
    if (socket === nextSocket) setStatus('協商服務已斷線。', true);
  };
  nextSocket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'welcome') {
      for (const peerId of message.peers) await startPeer(peerId, true);
    }
    if (message.type === 'signal') await receiveSignal(message.from, message.data);
    if (message.type === 'peer-left') removePeer(message.peerId);
  };
}

function fire() {
  const shot = { x: localPlayer.x, y: localPlayer.y, angle: localPlayer.angle, life: .18, color: '#70e5ff' };
  shots.push(shot);
  broadcast('event', { type: 'shot', shot });
}

function gameLoop(now) {
  const dt = Math.min((now - lastFrame) / 1000, .05);
  lastFrame = now;
  const dx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const dy = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  if (dx || dy) {
    const length = Math.hypot(dx, dy);
    localPlayer.x = Math.max(.025, Math.min(.975, localPlayer.x + dx / length * dt * .32));
    localPlayer.y = Math.max(.04, Math.min(.96, localPlayer.y + dy / length * dt * .32));
  }
  localPlayer.angle = Math.atan2(mouse.y - localPlayer.y, mouse.x - localPlayer.x);
  if (now - lastNetworkUpdate > 50) {
    broadcast('state', { type: 'state', player: localPlayer });
    lastNetworkUpdate = now;
  }
  for (const shot of shots) shot.life -= dt;
  while (shots.length && shots[0].life <= 0) shots.shift();
  draw();
  requestAnimationFrame(gameLoop);
}

function drawPlayer(player, isSelf) {
  const x = player.x * canvas.width;
  const y = player.y * canvas.height;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(player.angle);
  ctx.fillStyle = player.color;
  ctx.fillRect(-16, -12, 32, 24);
  ctx.fillStyle = '#eaffff';
  ctx.fillRect(7, -3, 22, 6);
  ctx.restore();
  ctx.fillStyle = '#d7eaff';
  ctx.font = '14px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(player.name || '玩家', x, y - 25);
  if (isSelf) { ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2; ctx.strokeRect(x - 20, y - 16, 40, 32); }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#123552'; ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 0; y < canvas.height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  for (const shot of shots) {
    const x = shot.x * canvas.width; const y = shot.y * canvas.height;
    ctx.strokeStyle = shot.color; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(shot.angle) * 90, y + Math.sin(shot.angle) * 90); ctx.stroke();
  }
  for (const player of players.values()) drawPlayer(player, false);
  drawPlayer(localPlayer, true);
}

addEventListener('keydown', event => keys.add(event.key.toLowerCase()));
addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
canvas.addEventListener('mousemove', event => {
  const rect = canvas.getBoundingClientRect();
  mouse = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
});
canvas.addEventListener('mousedown', event => { if (event.button === 0) fire(); });
joinButton.addEventListener('click', joinRoom);
copyButton.addEventListener('click', async () => {
  const room = roomCodeInput.value.trim();
  if (!room) return setStatus('先輸入房間碼。', true);
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`);
  setStatus('已複製邀請連結。對方也需要填入相同的 Worker 網址。');
});
requestAnimationFrame(gameLoop);
