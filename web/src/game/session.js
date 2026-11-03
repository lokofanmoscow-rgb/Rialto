// Игровые сессии: локальная (несколько игроков на одном устройстве), хост сети и клиент сети.
import { createGame, dispatch, activePrompt } from '../engine/engine.js';
import { botAction } from '../engine/bot.js';
import { PLAYER_COLORS, MAX_PLAYERS } from '../engine/data.js';
import { net, onNet, parseJSON } from '../net/bridge.js';
import { saveGame, getPref, setPref } from '../storage.js';

export const PROTOCOL = 1;

export function deviceToken() {
  let t = getPref('token', null);
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); setPref('token', t); }
  return t;
}

class BaseSession {
  constructor(app) {
    this.app = app;
    this.state = null;
    this.seats = [];
    this.lastAutoKey = null;
  }
  isBot(pid) { return this.state && this.state.players[pid] && this.state.players[pid].kind === 'bot'; }
  // Применение действия на авторитетной стороне (локально или на хосте)
  apply(pid, a) {
    const r = dispatch(this.state, pid, a);
    if (r.error) return r;
    this.state = r.state;
    this.afterChange();
    return r;
  }
  afterChange() {
    this.app.onState(this.state);
    this.autosave();
    this.botTick();
  }
  autosave() {
    const st = this.state;
    if (!st) return;
    const key = `${st.id}:${st.round}:${st.cur}:${st.over}`;
    if (key === this.lastAutoKey) return;
    this.lastAutoKey = key;
    saveGame('auto', this.saveData());
  }
  saveData() {
    return { mode: this.mode, seats: this.seats.map((s) => ({ name: s.name, color: s.color, kind: s.kind, local: s.device === 'host', token: s.token || null })), state: this.state };
  }
  botTick() {
    clearTimeout(this.botTimer);
    const st = this.state;
    if (!st || st.over) return;
    const seq = st.seq;
    this.botTimer = setTimeout(() => {
      const run = () => {
        if (!this.state || this.state.seq !== seq || this.state.over) return;
        const cur = this.state;
        const offer = cur.offers.find((o) => this.isBot(o.to));
        if (offer) { this.apply(offer.to, { t: 'declineOffer', id: offer.id }); return; }
        const pr = activePrompt(cur);
        if (pr.pid !== null && pr.pid !== undefined && this.isBot(pr.pid)) {
          const a = botAction(cur, pr.pid);
          if (a) {
            const r = this.apply(pr.pid, a);
            if (r.error) console.warn('bot error', r.error, a);
          }
        }
      };
      if (this.app.scene) this.app.scene.whenIdle(() => setTimeout(run, 350)); else run();
    }, 450);
  }
  close() { clearTimeout(this.botTimer); }
}

// ───────────── Игра на одном устройстве ─────────────
export class LocalSession extends BaseSession {
  constructor(app) { super(app); this.mode = 'local'; }
  start(seats, settings) {
    this.seats = seats.map((s) => ({ ...s, device: 'host' }));
    this.state = createGame({ players: seats, ...settings });
    this.afterChange();
  }
  load(save) {
    this.state = save.state;
    this.seats = (save.seats || this.state.players).map((s, i) => ({ name: s.name, color: s.color || this.state.players[i].color, kind: this.state.players[i].kind, device: 'host' }));
    for (const p of this.state.players) if (p.kind !== 'bot') p.kind = 'human';
    this.afterChange();
  }
  canControl(pid) { return !!this.state && this.state.players[pid] && this.state.players[pid].kind !== 'bot'; }
  act(pid, a) {
    const r = this.apply(pid, a);
    if (r.error) this.app.toast(r.error, 'error');
    return !r.error;
  }
}

// ───────────── Хост сетевой игры ─────────────
export class HostSession extends BaseSession {
  constructor(app, { hostName, settings, save }) {
    super(app);
    this.mode = 'host';
    this.hostName = hostName;
    this.settings = settings || { target: 3 };
    this.clients = new Map();
    this.loaded = null;
    if (save) {
      this.loaded = save.state;
      this.settings = { target: save.state.settings.target, startCash: save.state.settings.startCash };
      this.seats = save.state.players.map((p, i) => {
        const s = (save.seats || [])[i] || {};
        const local = s.local || (save.mode === 'local' && p.kind !== 'bot');
        return { name: p.name, color: p.color, kind: p.kind === 'bot' ? 'bot' : 'human', device: local || p.kind === 'bot' ? 'host' : null, token: s.token || null, online: local || p.kind === 'bot' };
      });
      if (!this.seats.some((s) => s.device === 'host' && s.kind === 'human')) {
        const first = this.seats.find((s) => s.kind === 'human');
        if (first) { first.device = 'host'; first.online = true; }
      }
    } else {
      this.seats = [{ name: hostName, color: PLAYER_COLORS[0].id, kind: 'human', device: 'host', token: deviceToken(), online: true }];
    }
    this.unsub = [
      onNet('hostClient', (id) => { this.clients.set(String(id), { id: String(id) }); }),
      onNet('hostMsg', (id, text) => this.onMsg(String(id), text)),
      onNet('hostLeave', (id) => this.onLeave(String(id))),
      onNet('hostError', (e) => this.app.toast('Сеть: ' + e, 'error')),
    ];
  }
  open() {
    if (!net) return false;
    return net.hostStart(this.info());
  }
  info() {
    return { v: PROTOCOL, name: this.hostName, players: this.seats.length, started: !!this.state, loaded: !!this.loaded };
  }
  lobby() {
    return {
      host: this.hostName, settings: this.settings, loaded: !!this.loaded, started: !!this.state,
      seats: this.seats.map((s) => ({ name: s.name, color: s.color, kind: s.kind, online: s.online, local: s.device === 'host', remote: s.device && s.device !== 'host' })),
    };
  }
  freeColor() {
    const used = new Set(this.seats.map((s) => s.color));
    return (PLAYER_COLORS.find((c) => !used.has(c.id)) || PLAYER_COLORS[0]).id;
  }
  send(id, obj) { if (net) net.hostSend(id, obj); }
  you(id) { return this.seats.map((s, i) => (s.device === id ? i : -1)).filter((i) => i >= 0); }
  broadcast() {
    if (net) net.hostUpdate(this.info());
    for (const id of this.clients.keys()) {
      if (this.state) this.send(id, { t: 'state', state: this.state, you: this.you(id), lobby: this.lobby() });
      else this.send(id, { t: 'lobby', lobby: this.lobby(), you: this.you(id) });
    }
    this.app.onLobby && this.app.onLobby();
  }
  onMsg(id, text) {
    const m = parseJSON(text);
    if (!m || typeof m.t !== 'string') return;
    if (!this.clients.has(id)) this.clients.set(id, { id });
    switch (m.t) {
      case 'hello': return this.onHello(id, m);
      case 'act': {
        if (!this.state) return;
        const pid = +m.pid;
        const seat = this.seats[pid];
        if (!seat || seat.device !== id) { this.send(id, { t: 'err', error: 'Вы не управляете этим игроком' }); return; }
        const r = this.apply(pid, m.a);
        if (r.error) this.send(id, { t: 'err', error: r.error });
        return;
      }
      case 'setColor': {
        if (this.state) return;
        const seat = this.seats.find((s) => s.device === id);
        if (seat && PLAYER_COLORS.some((c) => c.id === m.color) && !this.seats.some((s) => s.color === m.color)) { seat.color = m.color; this.broadcast(); }
        return;
      }
      case 'ping': this.send(id, { t: 'pong' }); return;
    }
  }
  onHello(id, m) {
    if (m.v !== PROTOCOL) { this.send(id, { t: 'reject', reason: 'Другая версия игры. Обновите приложение.' }); return; }
    const name = String(m.name || 'Игрок').slice(0, 16);
    const token = String(m.token || '');
    let idx = this.seats.findIndex((s) => s.token && s.token === token && s.device !== 'host');
    const claimMode = !!(this.state || this.loaded);
    if (idx < 0 && claimMode) idx = this.seats.findIndex((s) => s.device !== 'host' && s.kind === 'human' && !s.online && s.name === name);
    if (idx < 0 && claimMode) idx = this.seats.findIndex((s) => s.device !== 'host' && s.kind === 'human' && !s.online);
    if (idx < 0 && !claimMode) {
      if (this.seats.length >= MAX_PLAYERS) { this.send(id, { t: 'reject', reason: 'В игре уже максимум игроков' }); return; }
      let nm = name;
      if (this.seats.some((s) => s.name === nm)) nm = name + ' ' + (this.seats.length + 1);
      this.seats.push({ name: nm, color: this.freeColor(), kind: 'human', device: id, token, online: true });
      idx = this.seats.length - 1;
    }
    if (idx < 0) { this.send(id, { t: 'reject', reason: 'В этой игре нет свободных мест' }); return; }
    const seat = this.seats[idx];
    // старое соединение того же игрока закрываем
    for (const s of this.seats) if (s !== seat && s.device === id) { s.device = null; s.online = false; }
    seat.device = id;
    seat.online = true;
    seat.token = token;
    this.clients.set(id, { id, token });
    this.send(id, { t: 'welcome', id, seat: idx });
    this.app.toast(`${seat.name} в игре`, 'info');
    this.broadcast();
  }
  onLeave(id) {
    this.clients.delete(id);
    for (const s of this.seats) if (s.device === id) {
      s.online = false;
      if (!this.state && !this.loaded) { this.seats = this.seats.filter((x) => x !== s); }
      this.app.toast(`${s.name}: связь потеряна`, 'warn');
    }
    this.broadcast();
  }
  addSeat(kind) {
    if (this.state || this.loaded || this.seats.length >= MAX_PLAYERS) return;
    const n = this.seats.length + 1;
    this.seats.push({ name: kind === 'bot' ? `Компьютер ${n}` : `Игрок ${n}`, color: this.freeColor(), kind, device: 'host', token: null, online: true });
    this.broadcast();
  }
  removeSeat(i) {
    if (this.state || this.loaded) return;
    const s = this.seats[i];
    if (!s || i === 0) return;
    if (s.device && s.device !== 'host') { this.send(s.device, { t: 'reject', reason: 'Хост убрал вас из игры' }); if (net) net.hostKick(s.device); }
    this.seats.splice(i, 1);
    this.broadcast();
  }
  takeOver(i) {
    const s = this.seats[i];
    if (!s || s.online) return;
    s.device = 'host';
    s.online = true;
    this.broadcast();
    this.afterChange();
  }
  start() {
    if (this.state) return;
    if (this.loaded) {
      for (const s of this.seats) if (!s.online && s.kind === 'human') { s.device = 'host'; s.online = true; }
      this.state = this.loaded;
      this.loaded = null;
    } else {
      if (this.seats.length < 2) { this.app.toast('Нужно минимум 2 игрока', 'error'); return; }
      this.state = createGame({ players: this.seats.map((s) => ({ name: s.name, color: s.color, kind: s.kind })), ...this.settings });
    }
    this.afterChange();
  }
  afterChange() {
    super.afterChange();
    this.broadcast();
  }
  canControl(pid) { const s = this.seats[pid]; return !!s && s.device === 'host' && s.kind === 'human'; }
  act(pid, a) {
    const r = this.apply(pid, a);
    if (r.error) this.app.toast(r.error, 'error');
    return !r.error;
  }
  close() {
    super.close();
    for (const id of this.clients.keys()) this.send(id, { t: 'reject', reason: 'Хост завершил игру' });
    if (net) net.hostStop();
    this.unsub.forEach((u) => u());
  }
}

// ───────────── Клиент сетевой игры ─────────────
export class ClientSession extends BaseSession {
  constructor(app, { name, ip, port }) {
    super(app);
    this.mode = 'client';
    this.name = name;
    this.ip = ip;
    this.port = port;
    this.you = [];
    this.lobbyInfo = null;
    this.connected = false;
    this.closed = false;
    this.retries = 0;
    this.unsub = [
      onNet('clientOpen', () => {
        this.connected = true;
        this.retries = 0;
        net.clientSend({ t: 'hello', v: PROTOCOL, name: this.name, token: deviceToken() });
        this.app.onConnection && this.app.onConnection(true);
      }),
      onNet('clientMsg', (text) => this.onMsg(text)),
      onNet('clientClose', (reason) => this.onClose(reason)),
    ];
  }
  connect() { net.connect(this.ip, this.port); }
  onMsg(text) {
    const m = parseJSON(text);
    if (!m) return;
    switch (m.t) {
      case 'welcome': break;
      case 'lobby':
        this.lobbyInfo = m.lobby;
        this.you = m.you || [];
        this.app.onLobby && this.app.onLobby();
        break;
      case 'state':
        this.lobbyInfo = m.lobby || this.lobbyInfo;
        this.you = m.you || [];
        this.state = m.state;
        this.app.onState(this.state);
        break;
      case 'err': this.app.toast(m.error, 'error'); break;
      case 'reject':
        this.closed = true;
        this.app.onRejected && this.app.onRejected(m.reason);
        net.clientClose();
        break;
    }
  }
  onClose(reason) {
    this.connected = false;
    if (this.closed) return;
    this.app.onConnection && this.app.onConnection(false, reason);
    if (this.retries < 40) {
      this.retries++;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (!this.closed) this.connect(); }, 2500);
    }
  }
  canControl(pid) { return this.you.includes(pid); }
  act(pid, a) {
    if (!this.connected) { this.app.toast('Нет соединения с хостом', 'error'); return false; }
    net.clientSend({ t: 'act', pid, a });
    return true;
  }
  setColor(color) { net.clientSend({ t: 'setColor', color }); }
  autosave() { /* сохраняет хост */ }
  botTick() { /* ботами управляет хост */ }
  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    if (net) net.clientClose();
    this.unsub.forEach((u) => u());
  }
}
