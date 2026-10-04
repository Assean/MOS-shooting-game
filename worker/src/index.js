export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ws\/([a-z0-9-]{1,24})$/i);
    if (!match) return new Response('Use WebSocket endpoint /ws/<room>.', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 });
    }
    return env.ROOMS.getByName(match[1].toLowerCase()).fetch(request);
  },
};

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

