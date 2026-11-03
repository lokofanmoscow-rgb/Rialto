// Точка входа приложения «Риальто».
import { BoardScene } from './scene/scene.js';
import { Hud, cardPopup } from './ui/hud.js';
import * as M from './ui/modals.js';
import * as S from './ui/screens.js';
import { LocalSession, HostSession, ClientSession } from './game/session.js';
import { net } from './net/bridge.js';
import { h } from './ui/dom.js';
import { sfx } from './ui/sound.js';
import { getPref } from './storage.js';
import { INDUSTRY, fmt } from './engine/data.js';
import { botAction } from './engine/bot.js';
import { activePrompt, options } from './engine/engine.js';

class App {
  constructor() {
    this.ui = document.getElementById('ui');
    this.modals = [];
    this.session = null;
    this.state = null;
    this.hud = null;
    this.screenEl = null;
    this.onScreenLeave = null;
    this.popupSeq = 0;
    try {
      this.scene = new BoardScene(document.getElementById('board3d'), { onCellTap: (i) => this.onCellTap(i) });
    } catch (e) {
      console.error(e);
      this.ui.append(h('div.screen', h('div.card', h('h2', 'Не удалось запустить 3D'),
        h('p', 'Для игры нужен WebGL 2. Обновите «Android System WebView» и Google Chrome в Google Play и перезапустите игру.'),
        h('p.small.muted', String(e && e.message || e)))));
      throw e;
    }
    this.toastBox = h('div.toasts');
    this.ui.append(this.toastBox);
    window.onAndroidBack = () => this.back();
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.back(); });
    this.menuBackground();
    S.mainMenu(this);
  }

  // ───── экраны ─────
  setScreen(el) {
    this.clearScreen();
    this.screenEl = el;
    this.ui.append(el);
  }
  clearScreen() {
    if (this.onScreenLeave) { try { this.onScreenLeave(); } catch (e) { /* ignore */ } this.onScreenLeave = null; }
    if (this.screenEl) { this.screenEl.remove(); this.screenEl = null; }
  }
  menuBackground() {
    this.scene.clearGame();
    this.scene.controls.autoRotate = true;
    this.scene.controls.autoRotateSpeed = 0.35;
    this.scene.setInsets({});
    this.scene.resetCamera(true);
  }
  closeModals() { while (this.modals.length) this.modals[this.modals.length - 1].close(); }

  // ───── запуск игр ─────
  closeSession() {
    if (this.session) { try { this.session.close(); } catch (e) { console.error(e); } }
    this.session = null;
    this.state = null;
    if (this.hud) { this.hud.destroy(); this.hud = null; }
  }
  startLocal(seats, settings) {
    this.closeSession();
    this.session = new LocalSession(this);
    this.session.start(seats, settings);
  }
  startHost(opts) {
    this.closeSession();
    this.session = new HostSession(this, opts);
    if (!this.session.open()) { this.toast('Не удалось запустить сервер игры', 'error'); this.toMenu(); return; }
    S.hostLobby(this);
  }
  startClient(opts) {
    this.closeSession();
    this.session = new ClientSession(this, opts);
    S.clientLobby(this);
    this.session.connect();
  }
  loadSave(save, as) {
    if (!save || !save.state) { this.toast('Сохранение повреждено', 'error'); return; }
    this.closeSession();
    if (as === 'host') {
      this.session = new HostSession(this, { hostName: getPref('name', 'Хост'), save });
      if (!this.session.open()) { this.toast('Не удалось запустить сервер игры', 'error'); this.toMenu(); return; }
      S.hostLobby(this);
    } else {
      this.session = new LocalSession(this);
      this.session.load(save);
    }
  }
  enterGame() {
    this.clearScreen();
    this.closeModals();
    this.scene.controls.autoRotate = false;
    this.hud = new Hud(this);
    this.hud.mount(this.ui);
    this.ui.append(this.toastBox);
    setTimeout(() => { this.hud && this.hud.updateInsets(); this.scene.resetCamera(); }, 60);
  }
  toMenu() {
    this.closeModals();
    this.closeSession();
    this.menuBackground();
    S.mainMenu(this);
  }

  // ───── события сессии ─────
  onState(st) {
    if (!this.hud) this.enterGame();
    const prev = this.state;
    this.state = st;
    this.scene.update(st);
    this.handleEvents(prev, st);
    this.render();
    this.scene.whenIdle(() => this.render());
  }
  onLobby() {
    if (this.state) { this.render(); return; }
    if (this.session && this.session.mode === 'host') S.hostLobby(this);
    if (this.session && this.session.mode === 'client') S.clientLobby(this);
  }
  onConnection(ok, reason) {
    if (!this.session || this.session.mode !== 'client') return;
    if (!this.state) S.clientLobby(this);
    else if (!ok) this.toast('Связь с хостом потеряна — переподключаемся…', 'warn');
    else this.toast('Соединение восстановлено', 'ok');
  }
  onRejected(reason) {
    this.toast(reason || 'Отказано в подключении', 'error');
    this.toMenu();
  }

  handleEvents(prev, st) {
    if (!prev || prev.id !== st.id) { this.popupSeq = st.seq; return; }
    const evs = st.events.filter((e) => e.s > this.popupSeq);
    this.popupSeq = st.seq;
    const humans = st.players.filter((p) => p.kind !== 'bot').length;
    for (const e of evs) {
      if (e.type === 'card') this.scene.whenIdle(() => this.showCard(st, e));
      if (e.type === 'enterprise') this.scene.whenIdle(() => this.toast(`🏭 ${st.players[e.pid].name} вводит предприятие «${INDUSTRY[e.ind].name}»: +${fmt(e.payout)}`, 'ok', 4500));
      if (e.type === 'turn' && !st.over) {
        const p = st.players[e.pid];
        if (this.session.canControl(e.pid) && (this.session.mode !== 'local' || humans > 1)) {
          this.scene.whenIdle(() => { sfx('turn'); this.toast(`Ход: ${p.name}`, 'info', 1800); });
        }
      }
      if (e.type === 'bankrupt') this.toast(`💥 ${st.players[e.pid].name} — банкрот`, 'warn', 4000);
      if (e.type === 'gameover') this.scene.whenIdle(() => { sfx('fanfare'); if (this.hud && this.hud.collapsed) this.hud.toggleSide(false); setTimeout(() => M.resultsModal(this), 900); });
    }
  }

  // На одном устройстве: подсказать, кому передать телефон, когда решение принимает другой игрок
  passDeviceHint(st) {
    if (!this.session || this.session.mode !== 'local' || st.over || this.scene.busy) return;
    const pr = activePrompt(st);
    const humans = st.players.filter((p) => p.kind !== 'bot' && !p.bankrupt).length;
    if (pr.pid === this.lastActor) return;
    const prev = this.lastActor;
    this.lastActor = pr.pid;
    if (humans < 2 || prev === undefined || prev === null || pr.pid === null || !this.session.canControl(pr.pid)) return;
    if (pr.type === 'turn' && pr.pid === st.cur) return; // о новом ходе сообщает отдельный тост
    sfx('turn');
    this.toast(`📱 Передайте устройство: решает ${st.players[pr.pid].name}`, 'warn', 2600);
  }

  showCard(st, e) {
    const el = h('div.modal', { style: { background: 'rgba(2,8,12,0.35)' }, onclick: () => el.remove() }, cardPopup(st, e));
    this.ui.append(el);
    setTimeout(() => el.remove(), 3600);
  }

  render() {
    if (this.hud && this.state) {
      this.hud.render(this.state);
      this.passDeviceHint(this.state);
    }
    for (const m of this.modals) if (m.refresh) m.refresh();
  }

  act(pid, a) {
    if (!this.session) return false;
    return this.session.act(pid, a);
  }

  myPid() {
    const st = this.state;
    if (!st || !this.session) return null;
    if (this.session.mode === 'local') {
      if (this.session.canControl(st.cur)) return st.cur;
      const p = st.players.find((q) => this.session.canControl(q.id));
      return p ? p.id : null;
    }
    const p = st.players.find((q) => this.session.canControl(q.id));
    return p ? p.id : null;
  }

  hostIps() { return net ? net.localIps() : []; }

  toast(text, kind = 'info', ms = 2600) {
    const t = h('div.toast.' + kind, text);
    this.toastBox.append(t);
    while (this.toastBox.children.length > 4) this.toastBox.firstChild.remove();
    if (kind === 'error') sfx('bad');
    setTimeout(() => t.remove(), ms);
  }
  confirm(text, fn) { M.confirmModal(this, text, fn); }

  openPortfolio(pid) { M.portfolioModal(this, pid === undefined ? this.myPid() : pid); }
  openLog() { M.logModal(this); }
  openPrices() { M.pricesModal(this); }
  openResults() { M.resultsModal(this); }
  openMenu() { M.menuModal(this); }
  openLoanDialog(pid, role) {
    if (!M.loanDialog(this, pid, role)) this.toast('Нет других игроков', 'warn');
  }

  onCellTap(i) {
    if (!this.state || !this.hud || i < 0) return;
    this.scene.placeHighlight(this.scene.hlTap, i, 0.1);
    M.cellModal(this, i);
  }

  // Кнопка «Назад» на Android: true — обработано, false — можно выходить из приложения
  back() {
    if (this.modals.length) { this.modals[this.modals.length - 1].close(); return true; }
    if (this.hud) { this.openMenu(); return true; }
    if (this.screenEl && !this.screenEl.querySelector('.logo')) { this.toMenu(); return true; }
    return false;
  }
}

if (__DEV__) window.__dev = { botAction, activePrompt, options };

function boot() { if (!window.app) window.app = new App(); }
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
