export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (!hasAllowedOrigin(request, env)) return json({ error: 'origin not allowed' }, cors, 403);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, services: ['Durable Objects', 'D1', 'WebRTC signaling'] }, cors);
    }
    if (url.pathname === '/api/players' && request.method === 'POST') {
      return upsertPlayer(request, env, cors);
    }
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return getLeaderboard(env, cors);
    }

    const match = url.pathname.match(/^\/ws\/([a-z0-9-]{1,24})$/i);
    if (!match) return new Response('Use WebSocket endpoint /ws/<room>.', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 });
    }
    return env.ROOMS.getByName(match[1].toLowerCase()).fetch(request);
  },
};

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  });
  if (origin && allowedOrigins(env).includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function hasAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins(env).includes(origin);
}

function json(value, cors, status = 200) {
  const headers = new Headers(cors);
  headers.set('content-type', 'application/json; charset=UTF-8');
  return new Response(JSON.stringify(value), { status, headers });
}

async function upsertPlayer(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, cors, 400); }
  const playerId = typeof body.playerId === 'string' ? body.playerId : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!/^[a-f0-9-]{16,64}$/i.test(playerId) || !displayName || displayName.length > 20) {
    return json({ error: 'invalid player data' }, cors, 400);
  }
  await env.DB.prepare(`
    INSERT INTO players (id, display_name, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = unixepoch()
  `).bind(playerId, displayName).run();
  return json({ ok: true, playerId, displayName }, cors, 201);
}

async function getLeaderboard(env, cors) {
  const { results } = await env.DB.prepare(`
    SELECT display_name AS displayName, wins, kills, deaths
    FROM players
    ORDER BY wins DESC, kills DESC, deaths ASC, updated_at DESC
    LIMIT 20
  `).all();
  return json({ players: results }, cors);
}

export class RoomSignaling {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const peers = this.ctx.getWebSockets();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    server.send(JSON.stringify({
      type: 'welcome',
      id,
      peers: peers.map(ws => ws.deserializeAttachment()?.id).filter(Boolean),
    }));
    this.broadcast({ type: 'peer-joined', peerId: id }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(server, raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type !== 'signal' || typeof message.to !== 'string' || !message.data) return;
    const sender = server.deserializeAttachment()?.id;
    const target = this.ctx.getWebSockets().find(ws => ws.deserializeAttachment()?.id === message.to);
    if (sender && target) target.send(JSON.stringify({ type: 'signal', from: sender, data: message.data }));
  }

  webSocketClose(server) {
    const id = server.deserializeAttachment()?.id;
    server.close(1000, 'Closed');
    if (id) this.broadcast({ type: 'peer-left', peerId: id });
  }

  broadcast(message, excluded) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) if (socket !== excluded) socket.send(payload);
  }
}
