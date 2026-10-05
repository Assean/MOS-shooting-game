import * as THREE from 'three';

const canvas = document.querySelector('#game');
const signalingUrlInput = document.querySelector('#signalingUrl');
const roomCodeInput = document.querySelector('#roomCode');
const playerNameInput = document.querySelector('#playerName');
const joinButton = document.querySelector('#joinButton');
const leaveButton = document.querySelector('#leaveButton');
const copyButton = document.querySelector('#copyButton');
const status = document.querySelector('#connectionStatus');
const playerCount = document.querySelector('#playerCount');
const combatStats = document.querySelector('#combatStats');
const roomIndicator = document.querySelector('#roomIndicator');
const playerRoster = document.querySelector('#playerRoster');
const rosterCount = document.querySelector('#rosterCount');
const serviceBadge = document.querySelector('#serviceBadge');
const gameToast = document.querySelector('#gameToast');
const qualityPreset = document.querySelector('#qualityPreset');
const fovRange = document.querySelector('#fovRange');
const fovValue = document.querySelector('#fovValue');
const weaponMode = document.querySelector('#weaponMode');
const canvasWrap = document.querySelector('.canvas-wrap');
const damageOverlay = document.querySelector('#damageOverlay');

const keys = new Set();
const peers = new Map();
const players = new Map();
const avatars = new Map();
const tracers = [];
const projectiles = [];
const impactEffects = [];
const staticColliders = [];
const raycastTargets = [];
const positionHistory = [];
const processedEliminations = new Set();
const arenaBounds = { x: 20, z: 14 };
const playerId = localStorage.getItem('player-id') || crypto.randomUUID();
const defaultSignalingUrl = 'https://mos-shooting-game.y20120816s.workers.dev';
const SHOT_COOLDOWN = 180;
const MOVE_SPEED = 7;
const CAMERA_HEIGHT = 1.65;
const HITSCAN_DAMAGE = 34;
const PROJECTILE_DAMAGE = 45;
const RESPAWN_INVULNERABILITY_MS = 1000;

let socket;
let networkId = 'self';
let lastNetworkUpdate = 0;
let lastShotAt = 0;
let yaw = 0;
let pitch = 0;
let pointerLocked = false;
let weapon;
let bloom = 0;
let recoilPitch = 0;
let recoilRoll = 0;
let invulnerableUntil = 0;
let localPlayer = { x: 0, y: CAMERA_HEIGHT, z: 9, angle: 0, color: '#70e5ff', name: '玩家', health: 100, kills: 0, deaths: 0 };

localStorage.setItem('player-id', playerId);
const params = new URLSearchParams(location.search);
roomCodeInput.value = params.get('room') || '';
signalingUrlInput.value = params.get('worker') || localStorage.getItem('signaling-url') || defaultSignalingUrl;
playerNameInput.value = localStorage.getItem('player-name') || '';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#061525');
scene.fog = new THREE.Fog('#061525', 18, 72);
const camera = new THREE.PerspectiveCamera(75, 16 / 9, .05, 120);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const clock = new THREE.Clock();
const projectileRaycaster = new THREE.Raycaster();

scene.add(new THREE.HemisphereLight('#9ad9ff', '#07101a', 1.8));
const keyLight = new THREE.DirectionalLight('#e8f7ff', 2.4);
keyLight.position.set(8, 18, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

function makeMaterial(color, emissive = '#000000', intensity = 0) {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: .62, metalness: .22 });
}

function addBox({ x, y, z, width, height, depth, color = '#183a54', emissive, intensity }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), makeMaterial(color, emissive, intensity));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  raycastTargets.push(mesh);
  if (y < 1.2) staticColliders.push({ x, z, halfWidth: width / 2, halfDepth: depth / 2 });
  return mesh;
}

function buildArena() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 36), makeMaterial('#0b2a41'));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(48, 48, '#2a7594', '#123d58');
  grid.position.y = .015;
  scene.add(grid);
  addBox({ x: 0, y: 2, z: -17, width: 48, height: 4, depth: .7, color: '#102b42' });
  addBox({ x: 0, y: 2, z: 17, width: 48, height: 4, depth: .7, color: '#102b42' });
  addBox({ x: -23.5, y: 2, z: 0, width: .7, height: 4, depth: 34, color: '#102b42' });
  addBox({ x: 23.5, y: 2, z: 0, width: .7, height: 4, depth: 34, color: '#102b42' });
  for (const [x, z, color] of [[-14, -9, '#5df1ff'], [14, -9, '#a783ff'], [-14, 9, '#a783ff'], [14, 9, '#5df1ff']]) {
    const pillar = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.8, 1.15, .35, 10), makeMaterial('#16445f'));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, 4.2, 12), makeMaterial(color, color, 2.4));
    base.position.y = .18;
    core.position.y = 2.15;
    core.castShadow = true;
    pillar.add(base, core);
    pillar.position.set(x, 0, z);
    scene.add(pillar);
    const glow = new THREE.PointLight(color, 4, 10, 2);
    glow.position.set(x, 2.3, z);
    scene.add(glow);
  }
  for (const [x, z, width, depth] of [[0, 0, 7, 1.2], [-7, 3.5, 1.2, 5], [7, -3.5, 1.2, 5]]) addBox({ x, y: .45, z, width, height: .9, depth, color: '#174460' });
}

function createWeapon() {
  weapon = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.18, .14, .72), makeMaterial('#1c6a86', '#0b3445', .6));
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .55), makeMaterial('#75e6ff', '#4ddff8', 1.8));
  const sight = new THREE.Mesh(new THREE.BoxGeometry(.07, .05, .16), makeMaterial('#d8f8ff'));
  body.position.set(0, 0, -.2);
  barrel.position.set(0, .015, -.75);
  sight.position.set(0, .12, -.35);
  weapon.add(body, barrel, sight);
  weapon.position.set(.34, -.32, -.62);
  weapon.rotation.set(-.08, -.08, 0);
  camera.add(weapon);
  scene.add(camera);
}

function createLabel(name, color) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.8, .7, 1);
  sprite.position.y = 2.55;
  sprite.userData = { canvas: labelCanvas, texture, name: '', color: '' };
  updateLabel(sprite, name, color);
  return sprite;
}

function updateLabel(sprite, name, color) {
  if (sprite.userData.name === name && sprite.userData.color === color) return;
  const { canvas: labelCanvas, texture } = sprite.userData;
  const labelContext = labelCanvas.getContext('2d');
  labelContext.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  labelContext.font = '700 28px system-ui';
  labelContext.textAlign = 'center';
  labelContext.textBaseline = 'middle';
  labelContext.fillStyle = 'rgba(3, 15, 26, .72)';
  labelContext.fillRect(23, 10, 210, 44);
  labelContext.fillStyle = color;
  labelContext.fillText(name, 128, 33);
  texture.needsUpdate = true;
  sprite.userData.name = name;
  sprite.userData.color = color;
}

function createAvatar(player) {
  const group = new THREE.Group();
  const bodyMaterial = makeMaterial(player.color, player.color, .25);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, .75, 5, 10), bodyMaterial);
  body.position.y = .94;
  body.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.5, .18, .2), makeMaterial('#dffaff', '#7eeaff', 1.2));
  visor.position.set(0, 1.38, -.34);
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(.14, .12, .72), makeMaterial('#182f40'));
  rifle.position.set(.28, .9, -.42);
  const label = createLabel(player.name || '連線中', player.color);
  group.add(body, visor, rifle, label);
  scene.add(group);
  return { group, bodyMaterial, label };
}

function removeAvatar(peerId) {
  const avatar = avatars.get(peerId);
  if (!avatar) return;
  scene.remove(avatar.group);
  avatar.group.traverse(object => {
    object.geometry?.dispose();
    if (object.material?.map) object.material.map.dispose();
    object.material?.dispose();
  });
  avatars.delete(peerId);
}

function syncAvatars() {
  for (const [peerId, player] of players) {
    let avatar = avatars.get(peerId);
    if (!avatar) {
      avatar = createAvatar(player);
      avatars.set(peerId, avatar);
    }
    avatar.group.position.set(player.x ?? 0, 0, player.z ?? 0);
    avatar.group.rotation.y = player.angle ?? 0;
    avatar.bodyMaterial.color.set(player.color || '#ffca6c');
    avatar.bodyMaterial.emissive.set(player.color || '#ffca6c');
    updateLabel(avatar.label, player.name || '玩家', player.color || '#ffca6c');
  }
}

function apiUrl(base, path) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  return url.toString();
}

function websocketUrl(base, room) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/${encodeURIComponent(room)}`;
  return url.toString();
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#ff9c9c' : '#75e6a4';
  gameToast.textContent = message;
}

function setLobbyState(joined) {
  joinButton.disabled = joined;
  leaveButton.disabled = !joined;
}

function setRoomIndicator(room = '') {
  roomIndicator.textContent = room ? `房間 · ${room}` : '尚未加入房間';
}

function renderRoster() {
  const roster = [{ ...localPlayer, isSelf: true }, ...players.values()]
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || b.kills - a.kills || a.deaths - b.deaths);
  rosterCount.textContent = String(roster.length).padStart(2, '0');
  playerRoster.replaceChildren(...roster.map(player => {
    const card = document.createElement('article');
    card.className = `player-card${player.isSelf ? ' is-self' : ''}`;
    const name = document.createElement('div');
    name.className = 'player-name';
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = player.color;
    const label = document.createElement('span');
    label.textContent = `${player.name || '玩家'}${player.isSelf ? '（你）' : ''}`;
    name.append(dot, label);
    const meta = document.createElement('div');
    meta.className = 'player-meta';
    meta.textContent = `生命 ${Math.max(0, player.health ?? 0)}　K ${player.kills || 0} / D ${player.deaths || 0}`;
    const track = document.createElement('div');
    track.className = 'health-track';
    const fill = document.createElement('div');
    fill.className = 'health-fill';
    fill.style.width = `${Math.max(0, Math.min(100, player.health ?? 0))}%`;
    if ((player.health ?? 0) <= 35) fill.style.background = '#ff8585';
    track.append(fill);
    card.append(name, meta, track);
    return card;
  }));
}

function updatePlayerCount() {
  playerCount.textContent = `${peers.size + 1} 位玩家`;
  renderRoster();
}

function updateCombatStats() {
  combatStats.textContent = `生命 ${localPlayer.health}　擊殺 ${localPlayer.kills}　死亡 ${localPlayer.deaths}`;
  renderRoster();
}

async function checkService(base) {
  serviceBadge.dataset.state = 'checking';
  serviceBadge.textContent = '檢查服務中';
  try {
    const response = await fetch(apiUrl(base, '/api/health'));
    if (!response.ok) throw new Error();
    serviceBadge.dataset.state = 'ready';
    serviceBadge.textContent = '協商服務正常';
  } catch {
    serviceBadge.dataset.state = 'error';
    serviceBadge.textContent = '服務尚未連線';
  }
}

async function savePlayerProfile(base) {
  const displayName = playerNameInput.value.trim() || '玩家';
  if (displayName.length > 20) throw new Error('玩家名稱不可超過 20 個字元。');
  localStorage.setItem('player-name', displayName);
  localPlayer.name = displayName;
  const response = await fetch(apiUrl(base, '/api/players'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId, displayName }),
  });
  if (!response.ok) throw new Error('資料服務尚未完成設定。');
  updateCombatStats();
}

function sendSignal(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(channel, message) {
  const raw = JSON.stringify(message);
  for (const peer of peers.values()) if (peer[channel]?.readyState === 'open') peer[channel].send(raw);
}

async function startPeer(peerId, initiator) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const peer = { pc, state: null, event: null };
  peers.set(peerId, peer);
  const player = { x: 0, y: CAMERA_HEIGHT, z: 0, angle: 0, color: '#ffca6c', name: '連線中', health: 100, kills: 0, deaths: 0 };
  players.set(peerId, player);
  avatars.set(peerId, createAvatar(player));
  updatePlayerCount();
  pc.onicecandidate = ({ candidate }) => { if (candidate) sendSignal({ type: 'signal', to: peerId, data: { candidate } }); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) removePeer(peerId); };
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
  removeAvatar(peerId);
  updatePlayerCount();
  if (socket?.readyState === WebSocket.OPEN) setStatus(`有玩家離開，目前 ${peers.size + 1} 位玩家`);
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
    if (message.type === 'state' && message.player) {
      players.set(peerId, { ...players.get(peerId), ...message.player });
      renderRoster();
    }
    if (message.type === 'shot' && message.shot) {
      const endpoint = spawnTracer(message.shot, '#ffca6c', message.shot.distance || 30);
      if ((message.shot.distance || 30) < 30) spawnImpact(endpoint, '#ffca6c', .12);
      if (isShotHit(message.shot, rewindLocalPosition(message.shot.sentAt))) takeDamage(peerId, message.shot.damage || HITSCAN_DAMAGE);
    }
    if (message.type === 'projectile' && message.shot) spawnProjectile({ ...message.shot, owner: peerId }, '#c49bff');
    if (message.type === 'eliminated') recordElimination(message);
  } catch { /* Ignore malformed peer messages. */ }
}

async function joinRoom() {
  const base = signalingUrlInput.value.trim().replace(/\/$/, '');
  const room = roomCodeInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!base || !room) return setStatus('請填入 Worker 網址與房間碼。', true);
  leaveRoom(false);
  localStorage.setItem('signaling-url', base);
  roomCodeInput.value = room;
  const shareUrl = new URL(location.href);
  shareUrl.searchParams.set('room', room);
  shareUrl.searchParams.set('worker', base);
  history.replaceState(null, '', `${shareUrl.pathname}${shareUrl.search}`);
  setStatus('正在儲存玩家資料…');
  joinButton.disabled = true;
  let nextSocket;
  try {
    await savePlayerProfile(base);
    nextSocket = new WebSocket(websocketUrl(base, room));
  } catch (error) {
    setLobbyState(false);
    return setStatus(error.message || 'Worker 網址格式不正確。', true);
  }
  socket = nextSocket;
  nextSocket.onopen = () => { setLobbyState(true); setRoomIndicator(room); setStatus('已連線至房間，正在尋找玩家…'); };
  nextSocket.onerror = () => { if (socket === nextSocket) setStatus('無法連上協商服務。請確認 Worker 網址已部署。', true); };
  nextSocket.onclose = () => {
    if (socket === nextSocket) { socket = undefined; setLobbyState(false); setRoomIndicator(); setStatus('協商服務已斷線。', true); }
  };
  nextSocket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'welcome') {
      networkId = message.id;
      for (const peerId of message.peers) await startPeer(peerId, true);
    }
    if (message.type === 'signal') await receiveSignal(message.from, message.data);
    if (message.type === 'peer-left') removePeer(message.peerId);
  };
}

function leaveRoom(announce = true) {
  for (const id of [...peers.keys()]) removePeer(id);
  const activeSocket = socket;
  socket = undefined;
  activeSocket?.close();
  networkId = 'self';
  setLobbyState(false);
  setRoomIndicator();
  updatePlayerCount();
  if (announce) setStatus('已離開房間。可輸入新房間碼重新加入。');
}

function shotDirection(shot) {
  return new THREE.Vector3(Number(shot.dx) || Math.sin(shot.angle || 0), Number(shot.dy) || 0, Number(shot.dz) || -Math.cos(shot.angle || 0)).normalize();
}

function spawnTracer(shot, color, distance = 7) {
  const direction = shotDirection(shot);
  const origin = new THREE.Vector3(Number(shot.x) || 0, Number(shot.y) || 1.18, Number(shot.z) || 0);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.035, .008, distance, 6), makeMaterial(color, color, 6));
  mesh.position.copy(origin).addScaledVector(direction, distance / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  scene.add(mesh);
  tracers.push({ mesh, life: .12 });
  spawnMuzzleFlash(origin, color);
  return origin.addScaledVector(direction, distance);
}

function spawnMuzzleFlash(position, color) {
  const light = new THREE.PointLight(color, 4.5, 5, 2);
  light.position.copy(position);
  scene.add(light);
  impactEffects.push({ object: light, life: .055 });
}

function spawnImpact(position, color, size = .14) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), makeMaterial(color, color, 5));
  mesh.position.copy(position);
  scene.add(mesh);
  impactEffects.push({ object: mesh, life: .13, shrink: true });
}

function applyRecoil() {
  recoilPitch = Math.min(.12, recoilPitch + .025 + bloom * .02);
  recoilRoll = (Math.random() - .5) * .05;
  bloom = Math.min(.12, bloom + .018);
}

function makeShot() {
  const spread = bloom + .006;
  const spreadYaw = (Math.random() - .5) * spread;
  const spreadPitch = (Math.random() - .5) * spread;
  const aim = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  aim.applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadYaw).applyAxisAngle(new THREE.Vector3(1, 0, 0), spreadPitch).normalize();
  return { x: localPlayer.x, y: CAMERA_HEIGHT - .28, z: localPlayer.z, dx: aim.x, dy: aim.y, dz: aim.z, angle: localPlayer.angle, sentAt: Date.now() };
}

function raycastHit(shot) {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(shot.x, shot.y, shot.z), shotDirection(shot), .2, 30);
  return raycaster.intersectObjects(raycastTargets, false)[0];
}

function fire() {
  if (!pointerLocked) return setStatus('先點擊競技場，進入第一人稱瞄準模式。');
  const now = performance.now();
  if (now - lastShotAt < SHOT_COOLDOWN) return;
  lastShotAt = now;
  applyRecoil();
  const shot = makeShot();
  if (weaponMode.value === 'projectile') {
    const projectileShot = { ...shot, damage: PROJECTILE_DAMAGE };
    spawnProjectile(projectileShot, '#b78cff');
    broadcast('event', { type: 'projectile', shot: projectileShot });
    return;
  }
  const hit = raycastHit(shot);
  const distance = hit ? hit.distance : 30;
  const endpoint = spawnTracer(shot, '#70e5ff', distance);
  if (hit) spawnImpact(endpoint, '#8fefff', .12);
  broadcast('event', { type: 'shot', shot: { ...shot, distance, damage: HITSCAN_DAMAGE } });
}

function rewindLocalPosition(sentAt) {
  if (!sentAt || !positionHistory.length) return localPlayer;
  return positionHistory.reduce((nearest, sample) => Math.abs(sample.time - sentAt) < Math.abs(nearest.time - sentAt) ? sample : nearest, positionHistory[0]);
}

function isShotHit(shot, target) {
  const origin = new THREE.Vector3(shot.x, shot.y, shot.z);
  const toTarget = new THREE.Vector3(target.x, CAMERA_HEIGHT, target.z).sub(origin);
  const direction = shotDirection(shot);
  const forward = toTarget.dot(direction);
  const side = toTarget.clone().subScaledVector(direction, forward).length();
  const range = Math.min(Number(shot.distance) || 30, 30);
  return forward > .35 && forward < range && side < .72;
}

function spawnProjectile(shot, color) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 8), makeMaterial(color, color, 4));
  mesh.position.set(shot.x, shot.y, shot.z);
  scene.add(mesh);
  projectiles.push({ mesh, velocity: shotDirection(shot).multiplyScalar(26), owner: shot.owner, damage: shot.damage || PROJECTILE_DAMAGE, life: 2.2, color });
}

function takeDamage(killerId, damage) {
  if (performance.now() < invulnerableUntil) return;
  localPlayer.health = Math.max(0, localPlayer.health - damage);
  damageOverlay.classList.add('is-hit');
  setTimeout(() => damageOverlay.classList.remove('is-hit'), 140);
  setStatus(`受到 ${damage} 點傷害，生命剩餘 ${localPlayer.health}。`, true);
  if (localPlayer.health > 0) return updateCombatStats();
  localPlayer.deaths += 1;
  const elimination = { type: 'eliminated', id: crypto.randomUUID(), killerId, victimId: networkId };
  recordElimination(elimination);
  broadcast('event', elimination);
  respawn();
}

function respawn() {
  localPlayer.health = 100;
  localPlayer.x = (Math.random() * 2 - 1) * 16;
  localPlayer.z = (Math.random() * 2 - 1) * 10;
  invulnerableUntil = performance.now() + RESPAWN_INVULNERABILITY_MS;
  setStatus('已重生，1 秒內無敵。');
  updateCombatStats();
}

function recordElimination({ id, killerId, victimId }) {
  if (!id || processedEliminations.has(id)) return;
  processedEliminations.add(id);
  if (processedEliminations.size > 100) processedEliminations.delete(processedEliminations.values().next().value);
  if (killerId === networkId) localPlayer.kills += 1;
  else if (players.has(killerId)) players.set(killerId, { ...players.get(killerId), kills: players.get(killerId).kills + 1 });
  if (victimId !== networkId && players.has(victimId)) players.set(victimId, { ...players.get(victimId), deaths: players.get(victimId).deaths + 1 });
  updateCombatStats();
}

function updateMovement(dt) {
  const forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const strafe = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!forward && !strafe) return;
  const sprinting = keys.has('shift');
  const distance = MOVE_SPEED * (sprinting ? 1.45 : 1) * dt / Math.hypot(forward, strafe);
  const next = new THREE.Vector2(
    THREE.MathUtils.clamp(localPlayer.x + (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * distance, -arenaBounds.x, arenaBounds.x),
    THREE.MathUtils.clamp(localPlayer.z + (-Math.cos(yaw) * forward + Math.sin(yaw) * strafe) * distance, -arenaBounds.z, arenaBounds.z),
  );
  resolveCompositeColliders(next);
  localPlayer.x = next.x;
  localPlayer.z = next.y;
}

function resolveCompositeColliders(position) {
  const radius = .48;
  for (const collider of staticColliders) {
    const nearestX = THREE.MathUtils.clamp(position.x, collider.x - collider.halfWidth, collider.x + collider.halfWidth);
    const nearestZ = THREE.MathUtils.clamp(position.y, collider.z - collider.halfDepth, collider.z + collider.halfDepth);
    const delta = new THREE.Vector2(position.x - nearestX, position.y - nearestZ);
    if (delta.lengthSq() >= radius * radius) continue;
    if (delta.lengthSq() < .0001) {
      const pushX = Math.abs(position.x - collider.x) / collider.halfWidth;
      const pushZ = Math.abs(position.y - collider.z) / collider.halfDepth;
      if (pushX > pushZ) position.x = collider.x + Math.sign(position.x - collider.x || 1) * (collider.halfWidth + radius);
      else position.y = collider.z + Math.sign(position.y - collider.z || 1) * (collider.halfDepth + radius);
    } else position.addScaledVector(delta.normalize(), radius - delta.length());
  }
}

function updateCamera() {
  camera.position.set(localPlayer.x, CAMERA_HEIGHT, localPlayer.z);
  camera.quaternion.setFromEuler(new THREE.Euler(pitch - recoilPitch, yaw, recoilRoll, 'YXZ'));
  localPlayer.angle = yaw;
}

function updateTracers(dt) {
  for (let index = tracers.length - 1; index >= 0; index -= 1) {
    tracers[index].life -= dt;
    if (tracers[index].life <= 0) {
      scene.remove(tracers[index].mesh);
      tracers[index].mesh.geometry.dispose();
      tracers[index].mesh.material.dispose();
      tracers.splice(index, 1);
    }
  }
}

function updateImpactEffects(dt) {
  for (let index = impactEffects.length - 1; index >= 0; index -= 1) {
    const effect = impactEffects[index];
    effect.life -= dt;
    if (effect.shrink) effect.object.scale.multiplyScalar(.88);
    if (effect.life > 0) continue;
    scene.remove(effect.object);
    effect.object.geometry?.dispose();
    effect.object.material?.dispose();
    impactEffects.splice(index, 1);
  }
}

function updateProjectiles(dt) {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    projectile.velocity.y -= 12 * dt;
    const travel = projectile.velocity.clone().multiplyScalar(dt);
    projectileRaycaster.set(projectile.mesh.position, travel.clone().normalize());
    projectileRaycaster.near = 0;
    projectileRaycaster.far = travel.length();
    const worldHit = projectileRaycaster.intersectObjects(raycastTargets, false)[0];
    if (!worldHit) projectile.mesh.position.add(travel);
    projectile.life -= dt;
    const hitLocal = projectile.owner && Math.hypot(projectile.mesh.position.x - localPlayer.x, projectile.mesh.position.z - localPlayer.z) < .68 && Math.abs(projectile.mesh.position.y - CAMERA_HEIGHT) < 1.35;
    const outside = Math.abs(projectile.mesh.position.x) > 23 || Math.abs(projectile.mesh.position.z) > 17 || projectile.mesh.position.y < 0;
    if (hitLocal && projectile.owner) {
      takeDamage(projectile.owner, projectile.damage);
      spawnImpact(projectile.mesh.position, '#ff8f8f', .24);
    } else if (worldHit) {
      spawnImpact(worldHit.point, projectile.color, .2);
    }
    if (projectile.life <= 0 || outside || hitLocal || worldHit) {
      scene.remove(projectile.mesh);
      projectile.mesh.geometry.dispose();
      projectile.mesh.material.dispose();
      projectiles.splice(index, 1);
    }
  }
}

function updateCombatDynamics(dt) {
  bloom = Math.max(0, bloom - dt * .075);
  recoilPitch = Math.max(0, recoilPitch - dt * .24);
  recoilRoll = THREE.MathUtils.damp(recoilRoll, 0, 20, dt);
  const targetFov = Number(fovRange.value) + (keys.has('shift') && (keys.has('w') || keys.has('s') || keys.has('a') || keys.has('d')) ? 9 : 0);
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 8, dt);
  camera.updateProjectionMatrix();
  if (weapon) {
    const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08 - recoilPitch * 1.6, -.08, recoilRoll * 2));
    weapon.quaternion.slerp(targetQuaternion, 1 - Math.exp(-20 * dt));
  }
  positionHistory.push({ time: Date.now(), x: localPlayer.x, z: localPlayer.z });
  while (positionHistory.length && positionHistory[0].time < Date.now() - 750) positionHistory.shift();
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width && height && (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio()))) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function applyGraphicsSettings() {
  const preset = qualityPreset.value;
  renderer.setPixelRatio(preset === 'performance' ? 1 : preset === 'quality' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = preset !== 'performance';
  localStorage.setItem('graphics-preset', preset);
  resizeRenderer();
}

function applyFov() {
  camera.fov = Number(fovRange.value);
  fovValue.textContent = `${camera.fov}°`;
  camera.updateProjectionMatrix();
  localStorage.setItem('camera-fov', String(camera.fov));
}

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), .05);
  updateMovement(dt);
  updateCombatDynamics(dt);
  updateCamera();
  if (performance.now() - lastNetworkUpdate > 50) {
    broadcast('state', { type: 'state', player: localPlayer });
    lastNetworkUpdate = performance.now();
  }
  syncAvatars();
  updateTracers(dt);
  updateImpactEffects(dt);
  updateProjectiles(dt);
  resizeRenderer();
  renderer.render(scene, camera);
}

addEventListener('keydown', event => {
  if (event.target.closest('input, button, select, summary')) return;
  const key = event.key.toLowerCase();
  if ('wasd'.includes(key) || key === 'shift') { keys.add(key); event.preventDefault(); }
  if (key === 'escape' && pointerLocked) document.exitPointerLock();
});
addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  canvasWrap.classList.toggle('aiming', pointerLocked);
  if (pointerLocked) setStatus('第一人稱瞄準已啟用。WASD 移動，左鍵射擊。');
  else if (document.hasFocus()) setStatus('已暫停瞄準。點擊競技場即可繼續。');
});
document.addEventListener('mousemove', event => {
  if (!pointerLocked) return;
  yaw -= event.movementX * .0022;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * .002, -1.22, 1.22);
});
canvas.addEventListener('click', () => { if (!pointerLocked) canvas.requestPointerLock(); else fire(); });
joinButton.addEventListener('click', joinRoom);
leaveButton.addEventListener('click', () => leaveRoom());
copyButton.addEventListener('click', async () => {
  const room = roomCodeInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const worker = signalingUrlInput.value.trim().replace(/\/$/, '');
  if (!room || !worker) return setStatus('先輸入 Worker 網址與房間碼。', true);
  const invite = new URL(location.href);
  invite.searchParams.set('room', room);
  invite.searchParams.set('worker', worker);
  try {
    await navigator.clipboard.writeText(invite.toString());
    setStatus('已複製邀請連結，朋友開啟後可直接加入同一房間。');
  } catch {
    setStatus('無法存取剪貼簿，請手動複製瀏覽器網址。', true);
  }
});
signalingUrlInput.addEventListener('change', () => checkService(signalingUrlInput.value.trim()));
qualityPreset.value = localStorage.getItem('graphics-preset') || 'balanced';
fovRange.value = localStorage.getItem('camera-fov') || '75';
qualityPreset.addEventListener('change', applyGraphicsSettings);
fovRange.addEventListener('input', applyFov);
weaponMode.value = localStorage.getItem('weapon-mode') || 'hitscan';
weaponMode.addEventListener('change', () => localStorage.setItem('weapon-mode', weaponMode.value));

buildArena();
createWeapon();
applyGraphicsSettings();
applyFov();
updateCamera();
updateCombatStats();
checkService(signalingUrlInput.value);
gameLoop();
