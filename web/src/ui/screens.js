// Экраны вне игры: главное меню, настройка, сетевое лобби, подключение, загрузка.
import { h, clear, dot } from './dom.js';
import { PLAYER_COLORS, MAX_PLAYERS, MIN_PLAYERS, CONST, fmt } from '../engine/data.js';
import { listSaves, loadGame, deleteSave, getPref, setPref } from '../storage.js';
import { net, onNet, GAME_PORT, parseJSON } from '../net/bridge.js';
import { saveInfo, confirmModal, rulesModal } from './modals.js';
import { colorHex } from './hud.js';

function screen(app, ...children) {
  const el = h('div.screen', h('div.card', ...children));
  app.setScreen(el);
  return el;
}

function logo() {
  return h('div.logo', h('div.t', 'РИАЛЬТО'), h('div.s', 'экономическая настольная игра'));
}

function settingsFields(v, redraw) {
  const seg = (key, items) => h('div.seg', items.map(([val, label]) => h('button' + (v[key] === val ? '.sel' : ''), { onclick: () => { v[key] = val; redraw(); } }, label)));
  return [
    h('div.field', h('label', 'Игра идёт до ввода в эксплуатацию предприятий одним игроком'), seg('target', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])),
    h('div.field', h('label', 'Стартовый капитал'), seg('startCash', [[200000, '200 тыс.'], [300000, '300 тыс.'], [500000, '500 тыс.']])),
  ];
}

// ───────────── Главное меню ─────────────
export function mainMenu(app) {
  const auto = loadGame('auto');
  const canContinue = auto && auto.state && !auto.state.over;
  const netMsg = () => app.toast('Игра по Wi-Fi работает в Android-приложении', 'warn');
  screen(app,
    logo(),
    canContinue ? h('button.btn.primary.block.big', { style: { marginBottom: '10px' }, onclick: () => app.loadSave(auto, auto.mode === 'host' ? 'host' : 'local') }, '▶ Продолжить последнюю игру') : null,
    h('div.menu-grid',
      h('button.btn', { onclick: () => localSetup(app) }, h('span.e', '👥'), 'Играть на одном устройстве'),
      h('button.btn', { onclick: () => (net ? hostSetup(app) : netMsg()) }, h('span.e', '📡'), 'Создать игру по Wi-Fi'),
      h('button.btn', { onclick: () => (net ? joinScreen(app) : netMsg()) }, h('span.e', '🔗'), 'Присоединиться по Wi-Fi'),
      h('button.btn', { onclick: () => loadScreen(app) }, h('span.e', '💾'), 'Загрузить игру'),
      h('button.btn', { onclick: () => rulesModal(app) }, h('span.e', '📖'), 'Правила'),
      h('button.btn', { onclick: () => quickDemo(app) }, h('span.e', '🤖'), 'Играть с компьютером')),
    h('div.small.muted.center', { style: { marginTop: '12px' } }, 'Собирайте предприятия, торгуйте акциями и участками, договаривайтесь с соперниками.'));
  app.scene.resetCamera();
}

function quickDemo(app) {
  const name = getPref('name', 'Игрок');
  app.startLocal([
    { name, color: 'red', kind: 'human' },
    { name: 'Компьютер 1', color: 'blue', kind: 'bot' },
    { name: 'Компьютер 2', color: 'green', kind: 'bot' },
  ], { target: 3, startCash: CONST.START_CASH });
}

// ───────────── Игра на одном устройстве ─────────────
export function localSetup(app) {
  const saved = getPref('localSeats', null);
  const seats = saved && saved.length >= 2 ? saved : [
    { name: getPref('name', 'Игрок 1'), color: 'red', kind: 'human' },
    { name: 'Игрок 2', color: 'blue', kind: 'human' },
  ];
  const v = { target: getPref('target', 3), startCash: getPref('startCash', CONST.START_CASH) };
  const list = h('div');
  const settings = h('div');
  const draw = () => {
    clear(list).append(...seats.map((s, i) => seatRow(seats, s, i, draw)));
    if (seats.length < MAX_PLAYERS) list.append(h('div.row', { style: { marginTop: '4px' } },
      h('button.btn.tiny.grow', { onclick: () => { seats.push({ name: `Игрок ${seats.length + 1}`, color: freeColor(seats), kind: 'human' }); draw(); } }, '+ Игрок'),
      h('button.btn.tiny.grow', { onclick: () => { seats.push({ name: `Компьютер ${seats.length + 1}`, color: freeColor(seats), kind: 'bot' }); draw(); } }, '+ Компьютер')));
    clear(settings).append(...settingsFields(v, draw));
  };
  draw();
  screen(app,
    h('h2', '👥 Игра на одном устройстве'),
    h('div.small.muted', 'Игроки ходят по очереди, передавая устройство друг другу.'),
    h('h3', 'Игроки'), list,
    settings,
    h('div.row', { style: { marginTop: '12px' } },
      h('button.btn.grow', { onclick: () => mainMenu(app) }, '← Назад'),
      h('button.btn.primary.grow', {
        onclick: () => {
          if (seats.length < MIN_PLAYERS) return app.toast('Нужно минимум 2 игрока', 'error');
          seats.forEach((s, i) => { s.name = (s.name || '').trim() || `Игрок ${i + 1}`; });
          setPref('localSeats', seats);
          setPref('target', v.target);
          setPref('startCash', v.startCash);
          app.startLocal(seats.map((s) => ({ ...s })), v);
        },
      }, 'Начать игру ▶')));
}

function freeColor(seats) {
  const used = new Set(seats.map((s) => s.color));
  return (PLAYER_COLORS.find((c) => !used.has(c.id)) || PLAYER_COLORS[0]).id;
}

function seatRow(seats, s, i, draw) {
  const used = new Set(seats.filter((x) => x !== s).map((x) => x.color));
  return h('div.seat',
    dot(colorHex(s.color)),
    h('input', { type: 'text', value: s.name, maxLength: 16, oninput: (e) => { s.name = e.target.value; } }),
    h('div.colors', PLAYER_COLORS.map((c) => h('div.c' + (c.id === s.color ? '.sel' : '') + (used.has(c.id) ? '.used' : ''), { style: { background: c.hex }, onclick: () => { s.color = c.id; draw(); } }))),
    h('button.btn.tiny', { onclick: () => { s.kind = s.kind === 'bot' ? 'human' : 'bot'; draw(); } }, s.kind === 'bot' ? '🤖' : '🙂'),
    seats.length > MIN_PLAYERS ? h('button.btn.tiny.danger', { onclick: () => { seats.splice(i, 1); draw(); } }, '✕') : null);
}

// ───────────── Создание сетевой игры ─────────────
export function hostSetup(app) {
  const v = { name: getPref('name', 'Игрок'), target: getPref('target', 3), startCash: getPref('startCash', CONST.START_CASH) };
  const settings = h('div');
  const draw = () => clear(settings).append(...settingsFields(v, draw));
  draw();
  screen(app,
    h('h2', '📡 Создать игру по Wi-Fi'),
    h('div.small.muted', 'Все устройства должны быть подключены к одной сети Wi-Fi (или к точке доступа одного из телефонов).'),
    h('div.field', h('label', 'Ваше имя'), h('input', { type: 'text', value: v.name, maxLength: 16, oninput: (e) => { v.name = e.target.value; } })),
    settings,
    h('div.row', { style: { marginTop: '12px' } },
      h('button.btn.grow', { onclick: () => mainMenu(app) }, '← Назад'),
      h('button.btn.primary.grow', {
        onclick: () => {
          v.name = (v.name || '').trim() || 'Хост';
          setPref('name', v.name); setPref('target', v.target); setPref('startCash', v.startCash);
          app.startHost({ hostName: v.name, settings: { target: v.target, startCash: v.startCash } });
        },
      }, 'Создать ▶')));
}

export function hostLobby(app) {
  const s = app.session;
  const ips = app.hostIps();
  const list = h('div');
  const lobby = s.lobby();
  list.append(...lobby.seats.map((seat, i) => h('div.seat',
    dot(colorHex(seat.color)),
    h('div.grow', h('b', seat.name), h('div.small.muted', seat.kind === 'bot' ? 'компьютер' : seat.local ? 'на этом устройстве' : seat.online ? 'подключён по сети' : 'ожидает подключения')),
    !lobby.loaded && i > 0 ? h('button.btn.tiny.danger', { onclick: () => s.removeSeat(i) }, '✕') : null)));
  const canAdd = !lobby.loaded && lobby.seats.length < MAX_PLAYERS;
  screen(app,
    h('h2', '📡 Ожидание игроков'),
    h('div.hint', 'Другие игроки: «Присоединиться по Wi-Fi» — игра появится в списке. Если не появилась, введите адрес вручную: ',
      ips.length ? ips.map((ip) => h('span.ipbox', ip)) : h('b', 'нет сети Wi-Fi!')),
    lobby.loaded ? h('div.hint.warn', 'Загружена сохранённая игра. Игроки займут свои места автоматически (по устройству или имени). За неподключившихся можно играть на этом устройстве.') : null,
    h('h3', `Игроки (${lobby.seats.length}/${MAX_PLAYERS})`), list,
    canAdd ? h('div.row', h('button.btn.tiny.grow', { onclick: () => s.addSeat('human') }, '+ Игрок на этом устройстве'), h('button.btn.tiny.grow', { onclick: () => s.addSeat('bot') }, '+ Компьютер')) : null,
    !lobby.loaded ? h('div.small.muted', { style: { marginTop: '8px' } }, `Цель: ${lobby.settings.target} предпр. · старт ${fmt(lobby.settings.startCash || CONST.START_CASH)}`) : null,
    h('div.row', { style: { marginTop: '12px' } },
      h('button.btn.grow', { onclick: () => confirmModal(app, 'Закрыть игру?', () => app.toMenu()) }, '✕ Закрыть'),
      h('button.btn.primary.grow', { disabled: lobby.seats.length < 2, onclick: () => s.start() }, lobby.loaded ? 'Продолжить игру ▶' : 'Начать игру ▶')));
}

// ───────────── Подключение ─────────────
export function joinScreen(app) {
  const v = { name: getPref('name', 'Игрок'), ip: getPref('lastIp', '') };
  const found = new Map();
  const list = h('div.list');
  const draw = () => {
    clear(list);
    if (!found.size) list.append(h('div.muted.small', h('span.spinner'), '  Ищем игры в сети…'));
    for (const g of found.values()) {
      list.append(h('div.found', { onclick: () => go(g.ip, g.port) },
        h('span', { style: { fontSize: '22px' } }, '🎲'),
        h('div.grow', h('b', g.name), h('div.small.muted', `${g.ip} · игроков: ${g.players}${g.started ? ' · идёт игра' : ''}${g.loaded ? ' · сохранённая' : ''}`)),
        h('span.btn.tiny.primary', 'Войти')));
    }
  };
  const go = (ip, port) => {
    v.name = (v.name || '').trim() || 'Игрок';
    setPref('name', v.name);
    if (ip) setPref('lastIp', ip);
    app.startClient({ name: v.name, ip, port: port || GAME_PORT });
  };
  const unsub = onNet('found', (json) => {
    const g = parseJSON(json);
    if (!g || !g.ip) return;
    found.set(g.ip + ':' + g.port, { ...g, seen: Date.now() });
    draw();
  });
  const timer = setInterval(() => {
    for (const [k, g] of found) if (Date.now() - g.seen > 6000) found.delete(k);
    draw();
  }, 2000);
  const cleanup = () => { unsub(); clearInterval(timer); net.discoverStop(); };
  draw();
  const ipInput = h('input', { type: 'text', value: v.ip, placeholder: '192.168.0.10', inputMode: 'decimal', oninput: (e) => { v.ip = e.target.value.trim(); } });
  screen(app,
    h('h2', '🔗 Присоединиться к игре'),
    h('div.field', h('label', 'Ваше имя'), h('input', { type: 'text', value: v.name, maxLength: 16, oninput: (e) => { v.name = e.target.value; } })),
    h('h3', 'Игры в вашей сети'), list,
    h('h3', 'Или по адресу'),
    h('div.row', ipInput, h('button.btn', { onclick: () => (v.ip ? go(v.ip) : app.toast('Введите адрес хоста', 'warn')) }, 'Подключиться')),
    h('div.small.muted', { style: { marginTop: '6px' } }, 'Адрес показан на экране хоста. Устройства должны быть в одной сети Wi-Fi.'),
    h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => mainMenu(app) }, '← Назад'));
  app.onScreenLeave = cleanup;
  net.discoverStart();
}

export function clientLobby(app) {
  const s = app.session;
  const lob = s.lobbyInfo;
  const body = [];
  if (!s.connected) body.push(h('div.hint', h('span.spinner'), `  Подключаемся к ${s.ip}…`));
  if (lob) {
    const mine = s.you;
    body.push(h('div.hint.ok', `Вы в игре «${lob.host}». Ждём, когда хост начнёт.`));
    body.push(h('h3', 'Игроки'));
    body.push(...lob.seats.map((seat, i) => h('div.seat', dot(colorHex(seat.color)),
      h('div.grow', h('b', seat.name + (mine.includes(i) ? ' (вы)' : '')), h('div.small.muted', seat.kind === 'bot' ? 'компьютер' : seat.online ? 'в сети' : 'не подключён')))));
    if (mine.length && !lob.loaded) {
      const used = new Set(lob.seats.map((x) => x.color));
      body.push(h('div.field', h('label', 'Ваш цвет'), h('div.colors', PLAYER_COLORS.map((c) => h('div.c' + (lob.seats[mine[0]].color === c.id ? '.sel' : '') + (used.has(c.id) && lob.seats[mine[0]].color !== c.id ? '.used' : ''), { style: { background: c.hex }, onclick: () => s.setColor(c.id) })))));
    }
    body.push(h('div.small.muted', `Цель: ${lob.settings.target} предпр.`));
  }
  screen(app, h('h2', '🔗 Сетевая игра'), ...body,
    h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => app.toMenu() }, '← Отключиться'));
}

// ───────────── Загрузка ─────────────
export function loadScreen(app) {
  const list = h('div.list');
  const draw = () => {
    const saves = listSaves();
    clear(list).append(...saves.map((s) => {
      const title = s.slot === 'auto' ? 'Автосохранение' : `Слот ${s.slot}`;
      if (s.empty) return h('div.found', { style: { opacity: 0.5 } }, h('div.grow', h('b', title), h('div.small.muted', 'пусто')));
      const data = () => loadGame(s.slot);
      return h('div.found', { style: { cursor: 'default' } },
        h('div.grow', h('b', title), h('div.small.muted', saveInfo(s)),
          h('div.row.wrap', { style: { marginTop: '6px' } },
            h('button.btn.tiny.primary', { onclick: () => app.loadSave(data(), 'local') }, '▶ На этом устройстве'),
            net ? h('button.btn.tiny', { onclick: () => app.loadSave(data(), 'host') }, '📡 Как сетевую (хост)') : null,
            h('button.btn.tiny.danger', { onclick: () => confirmModal(app, `Удалить «${title}»?`, () => { deleteSave(s.slot); draw(); }, 'Удалить') }, '🗑'))));
    }));
  };
  draw();
  screen(app, h('h2', '💾 Загрузить игру'), list, h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => mainMenu(app) }, '← Назад'));
}
