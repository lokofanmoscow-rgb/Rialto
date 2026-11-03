// Транспорт для игры по локальной сети.
// На Android используется нативный мост window.AndroidNet (TCP-сервер + UDP-обнаружение в Java).
// В браузере для разработки и тестов — WebSocket-ретранслятор tools/devrelay.mjs (?devnet=ws://host:port).

export const GAME_PORT = 47321;

const listeners = {};
function emit(type, ...args) { (listeners[type] || []).slice().forEach((cb) => { try { cb(...args); } catch (e) { console.error(e); } }); }

// Нативный мост вызывает window.__rialtoNative(type, a, b)
window.__rialtoNative = (type, a, b) => emit(type, a, b);

function parse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

const native = window.AndroidNet || null;
const devUrl = (() => {
  try { return new URLSearchParams(location.search).get('devnet'); } catch (e) { return null; }
})();

class NativeNet {
  constructor() { this.kind = 'native'; }
  hostStart(info) { return native.hostStart(GAME_PORT, JSON.stringify(info)); }
  hostUpdate(info) { native.hostUpdate(JSON.stringify(info)); }
  hostStop() { native.hostStop(); }
  hostSend(id, obj) { native.hostSend(String(id), JSON.stringify(obj)); }
  hostKick(id) { native.hostKick(String(id)); }
  discoverStart() { native.discoverStart(); }
  discoverStop() { native.discoverStop(); }
  connect(ip, port) { native.connect(ip, port || GAME_PORT); }
  clientSend(obj) { native.clientSend(JSON.stringify(obj)); }
  clientClose() { native.clientClose(); }
  localIps() { return parse(native.localIps()) || []; }
}

// Эмуляция того же интерфейса через WebSocket-ретранслятор
class DevNet {
  constructor(url) { this.kind = 'dev'; this.url = url; this.hostWs = null; this.clientWs = null; this.discWs = null; }
  hostStart(info) {
    this.hostStop();
    const ws = new WebSocket(this.url + '/host');
    this.hostWs = ws;
    ws.onopen = () => ws.send(JSON.stringify({ ev: 'info', info }));
    ws.onmessage = (m) => {
      const d = parse(m.data);
      if (!d) return;
      if (d.ev === 'join') emit('hostClient', d.id, d.addr || 'dev');
      else if (d.ev === 'msg') emit('hostMsg', d.id, d.data);
      else if (d.ev === 'leave') emit('hostLeave', d.id);
    };
    ws.onclose = () => { if (this.hostWs === ws) emit('hostError', 'Ретранслятор отключён'); };
    return true;
  }
  hostUpdate(info) { if (this.hostWs && this.hostWs.readyState === 1) this.hostWs.send(JSON.stringify({ ev: 'info', info })); }
  hostStop() { if (this.hostWs) { const w = this.hostWs; this.hostWs = null; w.close(); } }
  hostSend(id, obj) { if (this.hostWs && this.hostWs.readyState === 1) this.hostWs.send(JSON.stringify({ ev: 'send', id: String(id), data: JSON.stringify(obj) })); }
  hostKick(id) { if (this.hostWs && this.hostWs.readyState === 1) this.hostWs.send(JSON.stringify({ ev: 'kick', id: String(id) })); }
  discoverStart() {
    this.discoverStop();
    const ws = new WebSocket(this.url + '/discover');
    this.discWs = ws;
    ws.onmessage = (m) => { const d = parse(m.data); if (d && d.ev === 'games') d.games.forEach((g) => emit('found', JSON.stringify(g))); };
  }
  discoverStop() { if (this.discWs) { this.discWs.close(); this.discWs = null; } }
  connect(ip) {
    this.clientClose();
    const ws = new WebSocket(this.url + '/client?game=' + encodeURIComponent(ip));
    this.clientWs = ws;
    ws.onopen = () => emit('clientOpen');
    ws.onmessage = (m) => emit('clientMsg', m.data);
    ws.onclose = () => { if (this.clientWs === ws) { this.clientWs = null; emit('clientClose', 'Соединение закрыто'); } };
    ws.onerror = () => {};
  }
  clientSend(obj) { if (this.clientWs && this.clientWs.readyState === 1) this.clientWs.send(JSON.stringify(obj)); }
  clientClose() { if (this.clientWs) { const w = this.clientWs; this.clientWs = null; w.close(); } }
  localIps() { return ['dev']; }
}

export const net = native ? new NativeNet() : devUrl ? new DevNet(devUrl) : null;

export function onNet(type, cb) {
  (listeners[type] ||= []).push(cb);
  return () => { listeners[type] = (listeners[type] || []).filter((x) => x !== cb); };
}

export { parse as parseJSON };
