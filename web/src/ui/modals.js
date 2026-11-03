// Модальные окна игры.
import { h, clear, dot } from './dom.js';
import { colorHex, entGrid, cellCard, cellStatus, pname, coName, holdersDots } from './hud.js';
import { globalOptions, shareCount, ownedLands, loanTotal, playerCapital, plural, taxBase } from '../engine/engine.js';
import { COMPANIES, COMPANY_KEYS, INDUSTRIES, INDUSTRY, LAND_BY_NO, LAND_CELL, CONST, fmt } from '../engine/data.js';
import { rulesHTML } from './rules.js';
import { listSaves, saveGame, deleteSave } from '../storage.js';
import { soundOn, setSound, sfx } from './sound.js';

export function modal(app, title, content, opts = {}) {
  const close = () => { el.remove(); app.modals = app.modals.filter((m) => m !== api); opts.onClose && opts.onClose(); };
  const card = h('div.card', { style: opts.width ? { width: opts.width } : null },
    h('button.iconbtn.close', { onclick: close }, '✕'),
    title ? h('h2', title) : null,
    content);
  const el = h('div.modal', { onclick: (e) => { if (e.target === el && !opts.sticky) close(); } }, card);
  app.ui.append(el);
  const api = { el, card, close, refresh: opts.refresh || null };
  app.modals.push(api);
  return api;
}

export function confirmModal(app, text, onYes, yesLabel = 'Да') {
  const m = modal(app, 'Подтверждение', h('div',
    h('p', text),
    h('div.row', h('button.btn.primary.grow', { onclick: () => { m.close(); onYes(); } }, yesLabel), h('button.btn.grow', { onclick: () => m.close() }, 'Отмена'))), { width: 'min(420px, 100%)' });
  return m;
}

// ───────────── Портфель ─────────────
export function portfolioModal(app, pid) {
  let sel = pid;
  const body = h('div');
  const draw = () => {
    const st = app.state;
    if (!st) return;
    if (sel === undefined || sel === null || !st.players[sel]) sel = app.myPid() ?? st.cur;
    const p = st.players[sel];
    const tabs = h('div.tabs', st.players.map((q) => h('button.btn.tiny' + (q.id === sel ? '.sel' : ''), { onclick: () => { sel = q.id; draw(); } }, dot(colorHex(q.color)), q.name)));
    const mine = app.session.canControl(p.id) && !p.bankrupt && !st.over;
    const g = mine ? globalOptions(st, p.id) : [];
    const doAct = (a) => { sfx('click'); app.act(p.id, a); };
    const shares = COMPANY_KEYS.filter((k) => shareCount(st, k, p.id));
    const lands = ownedLands(st, p.id);
    const content = [
      tabs,
      h('div.row.wrap', { style: { gap: '14px' } },
        h('div', h('div.small.muted', 'Наличные'), h('div', { style: { fontSize: '20px', fontWeight: 800, color: 'var(--gold)' } }, fmt(p.cash))),
        h('div', h('div.small.muted', 'Капитал'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, fmt(playerCapital(st, p.id)))),
        h('div', h('div.small.muted', 'Предприятия'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, `${p.done.length} / ${st.settings.target}`)),
        h('div', h('div.small.muted', 'Страховка'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, `${p.insurance} / ${CONST.INSURANCE_MAX}`)),
        h('div', h('div.small.muted', 'Векселя'), h('div', { style: { fontSize: '16px', fontWeight: 700 } }, `${p.notes}`))),
      p.bankrupt ? h('div.hint.warn', 'Игрок — банкрот.') : null,
      p.debts.length ? h('div.hint.warn', `Долг: ${fmt(p.debts.reduce((s, d) => s + d.amount, 0))}`) : null,
      h('h3', '📈 Акции'),
      shares.length ? h('table.t', h('tr', h('th', 'Компания'), h('th.n', 'Акций'), h('th.n', 'Номинал')),
        shares.map((k) => h('tr', h('td', coName(k), ' ', holdersDots(st, k)), h('td.n', shareCount(st, k, p.id)), h('td.n', fmt(COMPANIES[k].price * shareCount(st, k, p.id)))))) : h('div.muted.small', 'Нет акций'),
      h('h3', '🌳 Участки и предприятия'),
      lands.length ? lands.map((L) => h('div.landbox',
        h('div.row', h('b', `Участок №${L.no}`), h('span.muted.small', `клетка ${LAND_CELL[L.no]} · ${fmt(LAND_BY_NO[L.no].price)}`)),
        L.ent.lic ? entGrid(L) : h('div.small.muted', 'Предприятие не строится. Купите лицензию на клетке «Сделка».'))) : h('div.muted.small', 'Нет участков'),
      p.done.length ? h('div.small', { style: { marginTop: '6px' } }, '🏭 Введены: ' + p.done.map((x) => INDUSTRY[x].name).join(', ')) : null,
      h('h3', '💳 Кредиты банка'),
      p.credits.length ? h('div.list', p.credits.map((r, i) => {
        const o = g.find((x) => x.t === 'repayCredit' && x.i === i);
        return h('div.row', h('span.grow', `${fmt(CONST.CREDIT_AMOUNT)} под ${r}% · ${fmt(CONST.CREDIT_AMOUNT * r / 100)} за проход Банка`),
          o ? h('button.btn.tiny', { disabled: !o.ok, onclick: () => doAct({ t: 'repayCredit', i }) }, `Погасить ${fmt(o.cost)}`) : null);
      })) : h('div.muted.small', 'Нет кредитов'),
      h('h3', '📝 Займы под вексель'),
      loansBlock(app, st, p, g, doAct),
      mine ? h('div.row', { style: { marginTop: '8px' } },
        h('button.btn.grow', { onclick: () => app.openLoanDialog(p.id, 'lend') }, 'Предложить заём'),
        h('button.btn.grow', { onclick: () => app.openLoanDialog(p.id, 'borrow') }, 'Попросить заём')) : null,
      h('div.small.muted', { style: { marginTop: '10px' } }, `Налоговая база (10% при проходе инспекции): ${fmt(taxBase(st, p.id))}`),
    ];
    clear(body).append(...content.flat(2).filter(Boolean));
  };
  draw();
  return modal(app, '💼 Портфель', body, { refresh: draw });
}

function loansBlock(app, st, p, g, doAct) {
  const rows = [];
  for (const l of st.loans) {
    if (l.borrower === p.id) {
      const o = g.find((x) => x.t === 'repayLoan' && x.id === l.id);
      rows.push(h('div.row', h('span.grow', `Должен ${pname(st, l.lender)}: ${fmt(loanTotal(l))} (${fmt(l.amount)} + ${l.rate}%), срок — ${l.due}-й круг`),
        o ? h('button.btn.tiny', { disabled: !o.ok, onclick: () => doAct({ t: 'repayLoan', id: l.id }) }, 'Вернуть') : null));
    }
    if (l.lender === p.id) {
      const o = g.find((x) => x.t === 'demandLoan' && x.id === l.id);
      rows.push(h('div.row', h('span.grow', `${pname(st, l.borrower)} должен вам ${fmt(loanTotal(l))}, срок — ${l.due}-й круг (сейчас ${st.round}-й)`),
        o ? h('button.btn.tiny', { disabled: !o.ok, onclick: () => doAct({ t: 'demandLoan', id: l.id }) }, 'Потребовать') : null));
    }
  }
  for (const o of st.offers) {
    if (o.from === p.id) rows.push(h('div.row', h('span.grow.small', `Ваше предложение ${pname(st, o.to)}: ${fmt(o.amount)} под ${o.rate}%`),
      app.session.canControl(p.id) ? h('button.btn.tiny', { onclick: () => doAct({ t: 'cancelOffer', id: o.id }) }, 'Отозвать') : null));
  }
  return rows.length ? h('div.list', rows) : h('div.muted.small', 'Нет займов');
}

// ───────────── Предложение займа ─────────────
export function loanDialog(app, fromPid, role) {
  const st = app.state;
  const others = st.players.filter((q) => q.id !== fromPid && !q.bankrupt);
  if (!others.length) return null;
  const v = { to: others[0].id, role, amount: 50000, rate: 10, term: 2 };
  const body = h('div');
  const draw = () => {
    const seg = (key, items) => h('div.seg', items.map(([val, label]) => h('button' + (v[key] === val ? '.sel' : ''), { onclick: () => { v[key] = val; draw(); } }, label)));
    const num = (key, step, min) => h('div.stepper',
      h('button.btn', { onclick: () => { v[key] = Math.max(min, v[key] - step); draw(); } }, '−'),
      h('input', { type: 'number', value: v[key], oninput: (e) => { v[key] = Math.max(min, Math.round(+e.target.value || 0)); } }),
      h('button.btn', { onclick: () => { v[key] += step; draw(); } }, '+'));
    const total = Math.round(v.amount * (1 + v.rate / 100) / 100) * 100;
    clear(body).append(
      h('div.field', h('label', 'Вы'), h('div', dot(colorHex(st.players[fromPid].color)), ' ', st.players[fromPid].name, ' · ', fmt(st.players[fromPid].cash))),
      h('div.field', h('label', 'Тип'), seg('role', [['lend', 'Дать в долг'], ['borrow', 'Взять в долг']])),
      h('div.field', h('label', v.role === 'lend' ? 'Кому' : 'У кого'), h('div.row.wrap', others.map((q) => h('button.btn.tiny' + (v.to === q.id ? '.primary' : ''), { onclick: () => { v.to = q.id; draw(); } }, dot(colorHex(q.color)), q.name)))),
      h('div.field', h('label', 'Сумма'), num('amount', 10000, 1000)),
      h('div.field', h('label', 'Процент'), num('rate', 5, 0)),
      h('div.field', h('label', 'Срок, кругов'), num('term', 1, 1)),
      h('div.hint', `Вернуть нужно ${fmt(total)}. Заёмщик отдаёт вексель; после срока заимодавец может потребовать возврат.`),
      h('button.btn.primary.block', { style: { marginTop: '8px' }, onclick: () => { if (app.act(fromPid, { t: 'offerLoan', ...v })) { m.close(); app.toast('Предложение отправлено', 'ok'); } } }, 'Отправить предложение'));
  };
  draw();
  const m = modal(app, '📝 Заём под вексель', body, { width: 'min(460px, 100%)' });
  return m;
}

// ───────────── Журнал ─────────────
export function logModal(app) {
  const body = h('div.loglist');
  const draw = () => {
    const st = app.state;
    if (!st) return;
    clear(body).append(...st.log.slice().reverse().map((l) => h('div' + (l.kind === 'big' ? '.big' : l.kind === 'warn' ? '.warn' : l.kind === 'turn' ? '.turn' : ''), l.text)));
  };
  draw();
  return modal(app, '📜 Журнал игры', body, { refresh: draw });
}

// ───────────── Таблица цен ─────────────
export function pricesModal(app) {
  const st = app.state;
  const body = h('div',
    h('h3', 'Отрасли'),
    h('table.t', h('tr', h('th', 'Продукция'), h('th.n', 'Материалы'), h('th.n', 'Оборуд.'), h('th.n', 'Персонал'), h('th.n', 'Выручка'), h('th.n', 'Лицензий')),
      INDUSTRIES.map((x) => h('tr', h('td', h('span', { style: { color: x.color } }, '● '), x.name), h('td.n', fmt(x.mat)), h('td.n', fmt(x.eq)), h('td.n', fmt(x.pers)), h('td.n', fmt(x.product)), h('td.n', st ? st.stock.lic[x.id] : '')))),
    h('div.small.muted', `Лицензия ${fmt(CONST.LICENSE_PRICE)}. При вводе предприятия банк платит выручку + половину цены участка.`),
    h('h3', 'Акционерные компании'),
    h('table.t', h('tr', h('th', 'Компания'), h('th.n', 'Акция'), h('th', 'Акционеры'), h('th', 'Доход')),
      COMPANY_KEYS.map((k) => h('tr', h('td', COMPANIES[k].name), h('td.n', fmt(COMPANIES[k].price)), h('td', st ? holdersDots(st, k) : ''), h('td.small', COMPANIES[k].income)))),
    st ? h('div.small.muted', `Страховой фонд: ${fmt(st.pool)} · свободные кредиты: ${st.stock.credits.length} · карт в банке: материалы ${st.stock.mat}, оборудование ${st.stock.eq}, персонал ${st.stock.pers}`) : null,
    h('h3', 'Участки'),
    h('table.t', h('tr', h('th', '№'), h('th.n', 'Цена'), h('th', 'Владелец')),
      Object.values(LAND_BY_NO).map((l) => h('tr', h('td', `№${l.no} (клетка ${LAND_CELL[l.no]})`), h('td.n', fmt(l.price)), h('td', st && st.lands[l.no - 1].owner !== null ? pname(st, st.lands[l.no - 1].owner) : '—')))));
  return modal(app, '📊 Цены и компании', body);
}

export function rulesModal(app) {
  return modal(app, '📖 Правила «Риальто»', h('div.rules', { html: rulesHTML() }));
}

export function cellModal(app, i) {
  const st = app.state;
  const m = modal(app, null, h('div', cellCard(i, st ? cellStatus(st, i) : null),
    st && st.players.some((p) => p.pos === i && !p.bankrupt) ? h('div.small', { style: { marginTop: '8px' } }, 'Здесь стоят: ', st.players.filter((p) => p.pos === i && !p.bankrupt).map((p) => p.name).join(', ')) : null),
  { width: 'min(380px, 100%)', onClose: () => app.scene.placeHighlight(app.scene.hlTap, -1) });
  return m;
}

// ───────────── Меню ─────────────
export function menuModal(app) {
  const body = h('div.list');
  const draw = () => {
    clear(body).append(
      h('button.btn.block', { onclick: () => m.close() }, '▶ Продолжить'),
      h('button.btn.block', { onclick: () => { m.close(); saveModal(app); } }, '💾 Сохранить игру'),
      h('button.btn.block', { onclick: () => { m.close(); rulesModal(app); } }, '📖 Правила'),
      h('button.btn.block', { onclick: () => { setSound(!soundOn()); draw(); } }, `🔊 Звук: ${soundOn() ? 'вкл' : 'выкл'}`),
      h('button.btn.block', { onclick: () => { app.scene.follow = !app.scene.follow; draw(); } }, `🎥 Камера следит за фишкой: ${app.scene.follow ? 'да' : 'нет'}`),
      app.session && app.session.mode === 'host' ? h('div.hint', 'Вы хост. Адрес для подключения: ', app.hostIps().map((ip) => h('span.ipbox', ip))) : null,
      h('button.btn.danger.block', { onclick: () => confirmModal(app, app.session && app.session.mode === 'client' ? 'Отключиться от игры?' : 'Выйти в главное меню? Игра сохранена в слот «Автосохранение».', () => { m.close(); app.toMenu(); }) }, '⏏ Выйти в главное меню'));
  };
  draw();
  const m = modal(app, '☰ Меню', body, { width: 'min(420px, 100%)' });
  return m;
}

export function saveModal(app) {
  const body = h('div.list');
  const draw = () => {
    const saves = listSaves().filter((s) => s.slot !== 'auto');
    clear(body).append(...saves.map((s) => h('button.btn.opt', {
      onclick: () => {
        const doSave = () => { if (saveGame(s.slot, app.session.saveData())) { app.toast(`Сохранено в слот ${s.slot}`, 'ok'); m.close(); } else app.toast('Не удалось сохранить', 'error'); };
        if (s.empty) doSave(); else confirmModal(app, `Перезаписать слот ${s.slot}?`, doSave, 'Перезаписать');
      },
    }, h('span', `Слот ${s.slot}`, h('span.sub', s.empty ? 'пусто' : saveInfo(s))), h('span.price', s.empty ? 'сохранить' : 'заменить'))));
  };
  draw();
  const m = modal(app, '💾 Сохранить игру', body, { width: 'min(480px, 100%)' });
  return m;
}

export function saveInfo(s) {
  const d = new Date(s.savedAt);
  const t = `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  const mode = s.mode === 'host' ? 'сеть' : s.mode === 'client' ? 'копия сетевой' : 'одно устройство';
  return `${t} · ${s.players.map((p) => p.name).join(', ')} · круг ${s.round}${s.over ? ' · окончена' : ''} · ${mode}`;
}

export function resultsModal(app) {
  const st = app.state;
  if (!st || !st.result) return null;
  const rows = st.result.map((r, k) => h('div.result-row' + (k === 0 ? '.win' : ''),
    h('div.place', k < 3 ? ['🥇', '🥈', '🥉'][k] : String(k + 1)), dot(colorHex(st.players[r.pid].color)),
    h('div.grow', h('b', pname(st, r.pid)), h('div.small.muted', r.bankrupt ? 'банкрот' : `наличные ${fmt(r.cash)} · акции ${fmt(r.sharesValue)} · участки ${fmt(r.landValue)} · предприятий: ${r.done}`)),
    h('b.gold', fmt(r.capital))));
  return modal(app, '🏆 Итоги игры', h('div', rows,
    h('div.row', { style: { marginTop: '10px' } },
      h('button.btn.grow', { onclick: () => { app.closeModals(); app.openLog(); } }, '📜 Журнал'),
      h('button.btn.primary.grow', { onclick: () => app.toMenu() }, 'В главное меню'))), { width: 'min(560px, 100%)' });
}

export { deleteSave };
