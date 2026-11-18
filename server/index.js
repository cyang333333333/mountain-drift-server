import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { RaceService } from './rooms.js';
import { createStatsStore } from './stats.js';
import { clientAddress } from './client-address.js';

const port = Number(process.env.PORT), host = '0.0.0.0';
if (!Number.isInteger(port) || port < Number(process.env.PORT_BASE) || port > Number(process.env.PORT_END) || !process.env.PORT_BASE || !process.env.PORT_END) throw new Error('PORT must be inside the assigned PORT_BASE–PORT_END range.');
const origins = new Set((process.env.MP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(','));
const store = await createStatsStore();
// A snapshot is identical for every driver; encode it once per broadcast.
const encoded = new WeakMap();
const send = (socket, value) => {
  if (socket?.readyState !== 1 || socket.bufferedAmount >= 65536) return;
  let payload = encoded.get(value);
  if (!payload) { payload = JSON.stringify(value); encoded.set(value, payload); }
  socket.send(payload);
};
const service = new RaceService({ send, readStats: store.read, saveStats: store.save });
const http = createServer((request, response) => {
  // The hosting reverse proxy owns HTTP CORS. WebSocket origins are still
  // checked explicitly below, independently of HTTP CORS response headers.
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
  if (request.url === '/health') response.end(JSON.stringify({ ok: true, protocol: 1, rooms: service.rooms.size }));
  else { response.statusCode = 404; response.end(JSON.stringify({ error: 'Not found' })); }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
const ipLimits = new Map();
http.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws' || !origins.has(request.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  if (sockets.clients.size >= 1200) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const ip = clientAddress(request), count = ipLimits.get(ip) || 0;
  if (count >= 48) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  sockets.handleUpgrade(request, socket, head, client => {
    ipLimits.set(ip, count + 1);
    client.once('close', () => {
      const remaining = (ipLimits.get(ip) || 1) - 1;
      if (remaining > 0) ipLimits.set(ip, remaining); else ipLimits.delete(ip);
    });
    sockets.emit('connection', client);
  });
});
sockets.on('connection', socket => {
  let player, identifying = false, messages = 0, actions = 0, lastWindow = Date.now(), alive = true;
  const authTimeout = setTimeout(() => { if (!player) socket.close(1008, 'Identify first'); }, 10000);
  socket.on('pong', () => { alive = true; });
  const heartbeat = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 15000);
  socket.on('message', async bytes => {
    try {
      const now = Date.now(); if (now - lastWindow > 1000) { messages = 0; actions = 0; lastWindow = now; }
      if (++messages > 90) { socket.close(1008, 'Too many messages'); return; }
      const data = JSON.parse(bytes.toString()); if (!data || typeof data !== 'object') return;
      if (!player) {
        if (data.type !== 'hello' || identifying) return;
        identifying = true; player = await service.identify(socket, data.token); clearTimeout(authTimeout); return;
      }
      if (player.connection !== socket) { socket.close(1008, 'Replaced'); return; }
      if (!['input', 'ping'].includes(data.type) && ++actions > 8) throw new Error('Please wait before trying again.');
      service.handle(player, data);
    } catch (error) { send(socket, { type: 'error', message: error instanceof SyntaxError ? 'Invalid message.' : error.message }); }
  });
  socket.on('error', () => {});
  socket.on('close', () => { clearTimeout(authTimeout); clearInterval(heartbeat); service.disconnect(player, socket); });
});
const tick = setInterval(() => service.tick(), 1000 / 60), snapshots = setInterval(() => service.snapshots(), 50);
http.listen(port, host, () => console.log(`Mountain Drift multiplayer listening on ${host}:${port}`));
async function shutdown() {
  clearInterval(tick); clearInterval(snapshots);
  for (const socket of sockets.clients) socket.close(1012, 'Server restarting');
  await Promise.allSettled(service.finishJobs); http.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
