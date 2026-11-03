// Ретранслятор для отладки сетевой игры в браузере (имитирует TCP-сервер и UDP-обнаружение Android).
// Запуск: node tools/devrelay.mjs [порт]   затем открыть dist/index.html?devnet=ws://localhost:8787
import { WebSocketServer } from 'ws';

const port = +(process.argv[2] || 8787);
const wss = new WebSocketServer({ port });
const hosts = new Map();   // hostId → { ws, info, clients: Map(clientId → ws) }
let seq = 1;

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/host') {
    const id = 'h' + seq++;
    const host = { ws, info: {}, clients: new Map() };
    hosts.set(id, host);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.ev === 'info') host.info = m.info || {};
      else if (m.ev === 'send') { const c = host.clients.get(m.id); if (c && c.readyState === 1) c.send(m.data); }
      else if (m.ev === 'kick') { const c = host.clients.get(m.id); if (c) c.close(); }
    });
    ws.on('close', () => { hosts.delete(id); for (const c of host.clients.values()) c.close(); });
  } else if (url.pathname === '/client') {
    const host = hosts.get(url.searchParams.get('game'));
    if (!host) { ws.close(); return; }
    const id = 'c' + seq++;
    host.clients.set(id, ws);
    host.ws.send(JSON.stringify({ ev: 'join', id, addr: 'relay' }));
    ws.on('message', (raw) => { if (host.ws.readyState === 1) host.ws.send(JSON.stringify({ ev: 'msg', id, data: raw.toString() })); });
    ws.on('close', () => { host.clients.delete(id); if (host.ws.readyState === 1) host.ws.send(JSON.stringify({ ev: 'leave', id })); });
  } else if (url.pathname === '/discover') {
    const tick = () => ws.readyState === 1 && ws.send(JSON.stringify({ ev: 'games', games: [...hosts.entries()].map(([id, h]) => ({ ...h.info, ip: id, port: 47321 })) }));
    tick();
    const t = setInterval(tick, 1000);
    ws.on('close', () => clearInterval(t));
  } else ws.close();
});
console.log('devrelay on ws://localhost:' + port);
