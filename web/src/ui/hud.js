// Игровой интерфейс: верхняя панель игроков, боковая панель действий, лента событий.
import { h, clear, dot } from './dom.js';
import {
  activePrompt, options, globalOptions, shareCount, ownedLands, landOf, debtTotal, loanTotal, minBid, creditOffered,
  plural, playerCapital, holderList, nominalCase,
} from '../engine/engine.js';
import {
  BOARD, COMPANIES, COMPANY_KEYS, INDUSTRIES, INDUSTRY, COMPONENTS, LAND_BY_NO, CONST, PLAYER_COLORS,
  SURPRISES, CONSULTS, cellTitle, cellHelp, fmt,
} from '../engine/data.js';
import { TYPE_STYLE, COMPANY_ICON } from '../scene/texture.js';
import { sfx } from './sound.js';

export const colorHex = (id) => (PLAYER_COLORS.find((c) => c.id === id) || PLAYER_COLORS[0]).hex;
const pc = (st, pid) => colorHex(st.players[pid].color);
const pname = (st, pid) => (pid === null || pid === undefined ? 'Банк' : st.players[pid].name);
const who = (st, pid) => h('span.row', { style: { gap: '6px', display: 'inline-flex' } }, dot(pc(st, pid)), h('b', pname(st, pid)));

export function cellIcon(i) {
  const c = BOARD[i];
  return c.type === 'company' ? COMPANY_ICON[c.company] : TYPE_STYLE[c.type].icon;
}
export function cellColor(i) { return TYPE_STYLE[BOARD[i].type].color; }

export function cellCard(i, extra) {
  return h('div.cellcard',
    h('div.ch', { style: { background: cellColor(i) } }, h('span.em', cellIcon(i)), h('span', cellTitle(i)), h('span', { style: { marginLeft: 'auto', opacity: 0.7, fontSize: '11px' } }, '№' + i)),
    h('div.cb', cellHelp(i), extra || null));
}

const compName = (k) => COMPONENTS[k].name;
const coName = (k) => COMPANIES[k].name;

function holdersDots(st, c) {
  return h('span.row', { style: { gap: '3px', display: 'inline-flex' } },
    st.shares[c].map((o) => (o === null ? h('span.dot', { style: { background: 'transparent', boxShadow: '0 0 0 1.5px rgba(255,255,255,0.35)' } }) : dot(pc(st, o)))));
}

// ───────────────────────── HUD ─────────────────────────

export class Hud {
  constructor(app) {
    this.app = app;
    this.open = new Set();
    this.inputs = {};
    this.collapsed = false;
    this.lastPromptKey = null;
    this.root = h('div', { style: { display: 'contents' } });
    this.top = h('div.topbar');
    this.side = h('div.side');
    this.mini = h('div.mini');
    this.ticker = h('div.ticker');
    this.tools = h('div.tools');
    this.root.append(this.top, this.tools, this.side, this.mini, this.ticker);
  }

  mount(ui) {
    ui.append(this.root);
    this.updateInsets();
  }

  destroy() { this.root.remove(); }

  updateInsets() {
    const sc = this.app.scene;
    if (!sc) return;
    const portrait = window.innerHeight > window.innerWidth;
    const sideW = this.collapsed ? 0 : this.side.getBoundingClientRect().width || 0;
    const sideH = this.collapsed ? 0 : this.side.getBoundingClientRect().height || 0;
    sc.setInsets(portrait ? { top: 46, bottom: sideH + 34, left: 0 } : { top: 46, right: sideW + 8, left: 48, bottom: 30 });
  }

  toggleSide(force) {
    this.collapsed = force !== undefined ? force : !this.collapsed;
    this.side.classList.toggle('collapsed', this.collapsed);
    setTimeout(() => { this.updateInsets(); this.app.scene.resetCamera(); }, 240);
  }

  render(st) {
    if (!st) return;
    this.renderTop(st);
    this.renderSide(st);
    this.renderTicker(st);
  }

  renderTop(st) {
    const app = this.app;
    const pr = activePrompt(st);
    const chips = h('div.chips', st.players.map((p) => {
      const seat = app.session.seats && app.session.seats[p.id];
      const offline = app.session.mode !== 'local' && seat && seat.kind === 'human' && seat.online === false;
      const lobbySeat = app.session.lobbyInfo && app.session.lobbyInfo.seats && app.session.lobbyInfo.seats[p.id];
      const off2 = app.session.mode === 'client' && lobbySeat && lobbySeat.kind === 'human' && lobbySeat.online === false;
      const shares = COMPANY_KEYS.reduce((s, k) => s + shareCount(st, k, p.id), 0);
      const lands = ownedLands(st, p.id).length;
      return h('div.chip' + (st.cur === p.id && !st.over ? '.turn' : '') + (pr.pid === p.id ? '.acting' : '') + (p.bankrupt ? '.out' : ''),
        { onclick: () => app.openPortfolio(p.id), title: p.name },
        dot(colorHex(p.color)),
        h('div', h('div.nm', p.name + (p.kind === 'bot' ? ' 🤖' : '') + (app.session.canControl(p.id) && app.session.mode !== 'local' ? ' (вы)' : '')),
          h('div.row', { style: { gap: '6px' } }, h('span.cash', fmt(p.cash)),
            h('span.meta', `🏭${p.done.length}/${st.settings.target} 📈${shares} 🌳${lands}`),
            p.debts.length ? h('span.meta.warn', 'долг!') : null,
            offline || off2 ? h('span.off', 'офлайн') : null)));
    }));
    const tools = h('div.tools',
      h('button.iconbtn', { title: 'Портфель', onclick: () => app.openPortfolio() }, '💼'),
      h('button.iconbtn', { title: 'Журнал', onclick: () => app.openLog() }, '📜'),
      h('button.iconbtn', { title: 'Цены', onclick: () => app.openPrices() }, '📊'),
      h('button.iconbtn', { title: 'Камера', onclick: () => app.scene.resetCamera() }, '🎯'),
      h('button.iconbtn', { title: 'Меню', onclick: () => app.openMenu() }, '☰'));
    clear(this.top).append(chips);
    clear(this.tools).append(...tools.childNodes);
  }

  renderTicker(st) {
    const last = st.log.slice(-2);
    clear(this.ticker).append(...last.map((l) => h('div', l.text)));
  }

  renderSide(st) {
    const app = this.app;
    const pr = activePrompt(st);
    const key = `${pr.type}:${pr.id || ''}:${st.cur}:${st.turn.phase}:${pr.pid}`;
    const body = this.side.querySelector('.body');
    const scroll = body && key === this.lastPromptKey ? body.scrollTop : 0;
    if (key !== this.lastPromptKey) { this.open.clear(); this.inputs = {}; }
    this.lastPromptKey = key;

    const busy = app.scene && app.scene.busy;
    const P = buildPanel(this, st, pr, busy);
    const headEl = h('div.head', h('div.who', P.who), P.what ? h('div.what', P.what) : null);
    const bodyEl = h('div.body', offersBlock(this, st), P.body);
    const footEl = P.foot && P.foot.length ? h('div.foot', P.foot) : null;
    const handle = h('div.handle', { onclick: () => this.toggleSide() }, this.collapsed ? '‹' : '›');
    clear(this.side).append(handle, headEl, bodyEl, footEl || '');
    bodyEl.scrollTop = scroll;
    // мини-кнопка при свёрнутой панели
    clear(this.mini);
    if (P.miniAction) this.mini.append(h('button.btn.primary', { onclick: P.miniAction.fn }, P.miniAction.label));
    this.mini.append(h('button.btn', { onclick: () => this.toggleSide(false) }, '☰ Действия'));
    requestAnimationFrame(() => this.updateInsets());
  }

  section(key, title, count, items, defOpen) {
    const isOpen = this.open.has(key) || (defOpen && !this.open.has('!' + key));
    const d = h('details.sect', { open: isOpen },
      h('summary', h('span', title), count !== undefined ? h('span.count', count) : null),
      h('div.in', items));
    d.addEventListener('toggle', () => {
      if (d.open) { this.open.add(key); this.open.delete('!' + key); } else { this.open.delete(key); this.open.add('!' + key); }
    });
    return d;
  }
}

// ───────────────────────── построение панели ─────────────────────────

function act(hud, pid, a) {
  sfx('click');
  hud.app.act(pid, a);
}

function optBtn(label, price, opt, onClick, cls = '') {
  const b = h('button.btn.opt' + cls, { onclick: onClick, disabled: opt && !opt.ok },
    h('span', label, opt && !opt.ok && opt.why ? h('span.why', { style: { display: 'block' } }, opt.why) : null),
    price !== null && price !== undefined ? h('span.price', price) : null);
  return b;
}

function buildPanel(hud, st, pr, busy) {
  const app = hud.app;
  if (st.over) return overPanel(hud, st);
  const pid = pr.pid;
  const actor = st.players[pid];
  const mine = app.session.canControl(pid);
  const P = { who: [dot(colorHex(actor.color)), actor.name], what: '', body: [], foot: [] };
  if (busy) {
    P.what = 'Ход…';
    P.body.push(h('div.hint', h('span.spinner'), '  Фишка движется…'));
    return P;
  }
  const opts = mine ? options(st, pid) : [];
  if (!mine) {
    waitingPanel(hud, st, pr, P);
    return P;
  }
  switch (pr.type) {
    case 'turn': turnPanel(hud, st, pid, opts, P); break;
    case 'ownerDeal': ownerDealPanel(hud, st, pr, opts, P); break;
    case 'debt': debtPanel(hud, st, pr, opts, P); break;
    case 'auction': auctionPanel(hud, st, pr, opts, P, true); break;
    case 'commission': commissionPanel(hud, st, pr, opts, P, true); break;
    case 'creditNeg': creditPanel(hud, st, pr, opts, P, true); break;
    case 'antimono': antimonoPanel(hud, st, pr, opts, P); break;
  }
  return P;
}

function turnPanel(hud, st, pid, opts, P) {
  const p = st.players[pid];
  const phase = st.turn.phase;
  if (phase === 'pre') {
    P.what = `Ваш ход · клетка ${p.pos} «${cellTitle(p.pos)}»`;
    P.body.push(h('div.hint', 'Бросьте кубики. До броска можно взять кредит в банке (не больше одного за ход) или купить страховое свидетельство от убытков.'));
    const cr = opts.find((o) => o.t === 'credit');
    if (cr) {
      const label = cr.nego ? `💳 Попросить кредит ${fmt(CONST.CREDIT_AMOUNT)}` : `💳 Взять кредит ${fmt(CONST.CREDIT_AMOUNT)} под ${cr.rate}%`;
      const b = optBtn(label, null, cr, () => act(hud, pid, { t: 'credit' }));
      P.body.push(b);
      if (cr.ok && cr.nego) P.body.push(h('div.small.muted', 'У банка есть другие акционеры — они назначат процент (берётся наибольший).'));
    }
    const ins = opts.find((o) => o.t === 'insure');
    if (ins) P.body.push(optBtn(`☂️ Страховое свидетельство (у вас ${p.insurance}/${CONST.INSURANCE_MAX})`, fmt(CONST.INSURANCE_PRICE), ins, () => act(hud, pid, { t: 'insure' })));
    P.body.push(statusBlock(st, pid));
    const roll = () => act(hud, pid, { t: 'roll' });
    P.foot.push(h('button.btn.primary.big.block', { onclick: roll }, '🎲 Бросить кубики'));
    P.miniAction = { label: '🎲 Бросить', fn: roll };
    return;
  }
  if (phase === 'cell') {
    const cell = BOARD[p.pos];
    P.what = `Кубики: ${st.turn.dice ? st.turn.dice.join(' + ') : '—'} · вы на клетке ${p.pos}`;
    P.body.push(cellCard(p.pos, cellStatus(st, p.pos)));
    if (cell.type === 'land' && landOf(st, cell.land).owner === null) {
      P.body.push(h('div.hint', 'Участок свободен. Купите его — и сможете строить на нём предприятия. Если откажетесь, участок разыграют на аукционе.'));
    } else if (cell.type === 'deal') {
      P.body.push(h('div.hint', 'Можно совершить ОДНУ сделку из списка ниже или ничего не делать.'));
    } else if (cell.type === 'company' && cell.company === 'bank') {
      P.body.push(h('div.hint', 'В банке можно купить акцию и взять кредит под наименьший процент — или продать свою акцию банка.'));
    } else {
      P.body.push(h('div.hint', 'Выберите одно действие или завершите ход.'));
    }
    P.body.push(...dealSections(hud, st, pid, opts));
    if (!opts.some((o) => o.t === 'declineLand')) {
      const end = () => act(hud, pid, { t: 'endTurn' });
      P.foot.push(h('button.btn.block', { onclick: end }, 'Ничего не делать — завершить ход ➜'));
      P.miniAction = { label: 'Завершить ход ➜', fn: end };
    }
    return;
  }
  if (phase === 'post') {
    P.what = `Кубики: ${st.turn.dice ? st.turn.dice.join(' + ') : '—'} · клетка ${p.pos} «${cellTitle(p.pos)}»`;
    P.body.push(cellCard(p.pos, cellStatus(st, p.pos)));
    P.body.push(h('div.hint.ok', 'Действия хода выполнены. Кредиты и займы можно погасить в «Портфеле» 💼.'));
    P.body.push(statusBlock(st, pid));
    const end = () => act(hud, pid, { t: 'endTurn' });
    P.foot.push(h('button.btn.primary.big.block', { onclick: end }, 'Завершить ход ➜'));
    P.miniAction = { label: 'Завершить ход ➜', fn: end };
  }
}

function statusBlock(st, pid) {
  const p = st.players[pid];
  const lands = ownedLands(st, pid);
  const building = lands.filter((l) => l.ent.lic);
  const box = h('div.sect', { style: { padding: '8px 10px' } },
    h('div.kv', h('span', 'Наличные'), h('b', fmt(p.cash))),
    h('div.kv', h('span', 'Капитал'), h('b', fmt(playerCapital(st, pid)))),
    h('div.kv', h('span', 'Предприятия'), h('b', `${p.done.length} из ${st.settings.target}`)));
  if (building.length) {
    for (const L of building) {
      box.append(h('div.small', { style: { marginTop: '6px' } }, `Участок №${L.no} · ${INDUSTRY[L.ent.lic].name}`), entGrid(L));
    }
  } else if (lands.length) {
    box.append(h('div.small.muted', { style: { marginTop: '4px' } }, 'Совет: купите лицензию на «Сделке», чтобы начать строить предприятие на своём участке.'));
  } else {
    box.append(h('div.small.muted', { style: { marginTop: '4px' } }, 'Совет: чтобы строить предприятия, сначала купите земельный участок.'));
  }
  return box;
}

export function entGrid(L) {
  const e = L.ent;
  const ind = e.lic ? INDUSTRY[e.lic] : null;
  const s = (on, label, price) => h('div.s' + (on ? '.on' : ''), label, price ? h('div', { style: { fontSize: '10px', opacity: 0.8 } }, price) : null);
  return h('div.ent',
    s(!!e.lic, 'Лицензия', ind ? ind.name : fmt(CONST.LICENSE_PRICE)),
    s(e.mat, 'Материалы', ind ? fmt(ind.mat) : ''),
    s(e.eq, 'Оборуд.', ind ? fmt(ind.eq) : ''),
    s(e.pers, 'Персонал', ind ? fmt(ind.pers) : ''));
}

export function cellStatus(st, i) {
  const c = BOARD[i];
  if (c.type === 'land') {
    const L = landOf(st, c.land);
    if (L.owner === null) return h('div', { style: { marginTop: '4px', fontWeight: 700 } }, `Свободен · цена ${fmt(LAND_BY_NO[c.land].price)}`);
    return h('div', { style: { marginTop: '4px' } }, h('b', 'Владелец: '), pname(st, L.owner), L.ent.lic ? h('div', `Строится: ${INDUSTRY[L.ent.lic].name}`) : null);
  }
  if (c.type === 'company') {
    const holders = st.shares[c.company].map((o) => (o === null ? 'свободна' : pname(st, o)));
    return h('div', { style: { marginTop: '4px' } }, h('b', 'Акции: '), holders.join(' · '));
  }
  return null;
}

function landLabel(no) { return `Участок №${no}`; }

function dealSections(hud, st, pid, opts) {
  const out = [];
  const by = (t) => opts.filter((o) => o.t === t);
  const doAct = (a) => act(hud, pid, a);
  // Свободный участок, на котором стоит игрок: «купить» или «отказаться»
  const dec = opts.find((o) => o.t === 'declineLand');
  if (dec) {
    for (const o of by('buyLand')) out.push(optBtn(`🌳 Купить ${landLabel(o.land)}`, fmt(o.cost), o, () => doAct({ t: 'buyLand', land: o.land }), o.ok ? '.green' : ''));
    out.push(optBtn('Отказаться — выставить на аукцион', null, dec, () => doAct({ t: 'declineLand' })));
  }
  const sections = [];
  const buyLands = dec ? [] : by('buyLand');
  if (buyLands.length) sections.push(['buyLand', '🌳 Купить свободный участок', buyLands.map((o) => optBtn(`${landLabel(o.land)}`, fmt(o.cost), o, () => doAct({ t: 'buyLand', land: o.land })))]);
  const comps = by('buyComp');
  if (comps.length) sections.push(['buyComp', '🔧 Карта для предприятия', comps.map((o) => {
    const L = landOf(st, o.land);
    const label = `${compName(o.comp)} · №${o.land} ${INDUSTRY[L.ent.lic].name}`;
    const b = optBtn(label, fmt(o.cost) + (o.nego ? ' + %' : ''), o, () => doAct({ t: 'buyComp', comp: o.comp, land: o.land }));
    return o.nego ? h('div', b, h('div.small.muted', { style: { padding: '2px 4px' } }, `У «${coName(COMPONENTS[o.comp].company)}» есть акционеры — они назовут свои комиссионные.`)) : b;
  })]);
  const lic = by('buyLicense');
  if (lic.length) {
    const lands = [...new Set(lic.map((o) => o.land))];
    const items = [];
    for (const no of lands) {
      items.push(h('div.small.muted', { style: { marginTop: '4px' } }, `${landLabel(no)} — выберите отрасль (${fmt(CONST.LICENSE_PRICE)}):`));
      for (const o of lic.filter((x) => x.land === no)) {
        const ind = INDUSTRY[o.ind];
        const cost = ind.mat + ind.eq + ind.pers + CONST.LICENSE_PRICE;
        const half = Math.round(LAND_BY_NO[no].price / 200) * 100;
        items.push(optBtn(h('span', h('span', { style: { color: ind.color, fontWeight: 800 } }, '● '), ind.name,
          h('span.sub', `затраты ≈ ${fmt(cost)} · выручка ${fmt(ind.product + half)} · лицензий ${st.stock.lic[o.ind]}`)), fmt(o.cost), o,
          () => doAct({ t: 'buyLicense', ind: o.ind, land: o.land })));
      }
    }
    sections.push(['buyLicense', '📜 Купить лицензию', items]);
  }
  const bs = by('buyShare');
  if (bs.length) sections.push(['buyShare', bs.length === 1 ? `📈 Акция «${coName(bs[0].c)}»` : '📈 Купить акцию', bs.map((o) =>
    optBtn(h('span', coName(o.c), ' ', holdersDots(st, o.c)), fmt(o.cost), o, () => doAct({ t: 'buyShare', c: o.c })))]);
  const ss = by('sellShare');
  if (ss.length) sections.push(['sellShare', '💱 Продать акцию (аукцион)', ss.map((o) =>
    optBtn(h('span', coName(o.c), h('span.sub', `у вас ${shareCount(st, o.c, pid)} · старт ${fmt(o.cost)} · вам 80%`)), null, o, () => doAct({ t: 'sellShare', c: o.c })))]);
  const sl = by('sellLand');
  if (sl.length) sections.push(['sellLand', '🏷️ Продать участок (аукцион)', sl.map((o) =>
    optBtn(h('span', landLabel(o.land), h('span.sub', o.hasEnt ? '⚠️ карты строящегося предприятия вернутся в банк' : `старт ${fmt(o.cost)} · вам 80%`)), null, o, () => doAct({ t: 'sellLand', land: o.land })))]);
  const bc = opts.find((o) => o.t === 'bankCredit');
  if (bc) sections.push(['bankCredit', '💳 Кредит', [optBtn(`Взять кредит ${fmt(CONST.CREDIT_AMOUNT)}${bc.rate ? ` под ${bc.rate}%` : ''}`, null, bc, () => doAct({ t: 'bankCredit' }))]]);
  const single = sections.length === 1;
  for (const [key, title, items] of sections) {
    const okCount = opts.filter((o) => o.t === key && o.ok).length;
    out.push(hud.section(key, title, okCount ? `${okCount} доступно` : 'недоступно', items, single || (key === 'buyComp' && okCount > 0)));
  }
  if (!sections.length && !dec && !by('buyLand').length) out.push(h('div.small.muted', 'Здесь вам сейчас нечего сделать.'));
  return out;
}

function ownerDealPanel(hud, st, pr, opts, P) {
  P.what = `Сделка на вашем участке №${pr.land}`;
  P.body.push(h('div.hint.ok', h('span', `${pname(st, pr.visitor)} встаёт на ваш участок №${pr.land}. Вы можете сразу совершить одну сделку.`)));
  P.body.push(...dealSections(hud, st, pr.pid, opts));
  const skip = () => act(hud, pr.pid, { t: 'skip' });
  P.foot.push(h('button.btn.block', { onclick: skip }, 'Пропустить'));
  P.miniAction = { label: 'Пропустить', fn: skip };
}

function debtPanel(hud, st, pr, opts, P) {
  const p = st.players[pr.pid];
  const total = debtTotal(p);
  P.what = 'Финансовая необеспеченность';
  P.body.push(h('div.hint.warn', 'Не хватает денег на обязательный платёж. Продайте акции или участки (через аукцион) или попросите заём у другого игрока. Банковский кредит сейчас не выдаётся.'));
  P.body.push(h('div.sect', { style: { padding: '8px 10px' } },
    h('div.kv', h('span', 'Нужно заплатить'), h('b', fmt(total))),
    h('div.kv', h('span', 'Наличные'), h('b', fmt(p.cash))),
    h('div.kv', h('span', 'Не хватает'), h('b', { style: { color: '#ff8a80' } }, fmt(total - p.cash))),
    h('div.small.muted', p.debts.map((d) => `${d.reason}: ${fmt(d.amount)}`).join('; '))));
  const ss = opts.filter((o) => o.t === 'sellShare');
  const sl = opts.filter((o) => o.t === 'sellLand');
  if (ss.length) P.body.push(hud.section('dsell', '💱 Продать акцию', ss.length, ss.map((o) => optBtn(coName(o.c), `от ${fmt(o.cost * 0.8)}`, o, () => act(hud, pr.pid, { t: 'sellShare', c: o.c }))), true));
  if (sl.length) P.body.push(hud.section('dland', '🏷️ Продать участок', sl.length, sl.map((o) => optBtn(landLabel(o.land) + (o.hasEnt ? ' ⚠️' : ''), `от ${fmt(o.cost * 0.8)}`, o, () => act(hud, pr.pid, { t: 'sellLand', land: o.land }))), true));
  P.body.push(h('button.btn.block', { onclick: () => hud.app.openLoanDialog(pr.pid, 'borrow') }, '📝 Попросить заём у игрока…'));
  P.foot.push(h('button.btn.danger.block', { onclick: () => hud.app.confirm('Объявить банкротство? Вы выбываете из игры, всё имущество вернётся в банк.', () => act(hud, pr.pid, { t: 'bankrupt' })) }, '💥 Объявить банкротство'));
}

function lotText(st, pr) {
  return pr.kind === 'share' ? `Акция «${coName(pr.c)}»` : `Участок №${pr.land}`;
}
function auctionReason(st, pr) {
  if (pr.reason === 'antimono') return `Антимонопольный комитет: ${pname(st, pr.seller)} обязан продать акцию.`;
  if (pr.reason === 'decline') return `${pname(st, pr.decliner)} отказывается от участка. Если его никто не купит, отказавшийся заплатит 20% комиссии.`;
  return `Продаёт ${pname(st, pr.seller)}. Продавец получит 80% цены.`;
}

function auctionInfo(st, pr) {
  return h('div.sect', { style: { padding: '8px 10px' } },
    h('div', { style: { fontWeight: 800, fontSize: '15px' } }, '🔨 ', lotText(st, pr)),
    h('div.small.muted', auctionReason(st, pr)),
    h('div.kv', h('span', 'Начальная цена'), h('b', fmt(pr.start))),
    h('div.kv', h('span', 'Текущая ставка'), h('b', pr.leader === null ? 'нет' : fmt(pr.high))),
    pr.leader !== null ? h('div.kv', h('span', 'Лидер'), who(st, pr.leader)) : null,
    h('div.row.wrap', { style: { marginTop: '4px', gap: '6px' } }, pr.order.map((id) => h('span.row', { style: { gap: '4px', opacity: pr.active.includes(id) ? 1 : 0.35, fontSize: '12px' } }, dot(pc(st, id)), st.players[id].name, pr.active.includes(id) ? '' : ' (пас)'))));
}

function auctionPanel(hud, st, pr, opts, P) {
  P.what = 'Аукцион — ваша ставка';
  P.body.push(auctionInfo(st, pr));
  const bid = opts.find((o) => o.t === 'bid');
  const p = st.players[pr.pid];
  const min = minBid(pr);
  const key = 'bid' + pr.id + ':' + (pr.high || 0);
  if (!hud.inputs[key]) hud.inputs[key] = min;
  const val = () => hud.inputs[key];
  const input = h('input', { type: 'number', value: val(), min, step: 1000, inputMode: 'numeric', oninput: (e) => { hud.inputs[key] = Math.max(0, Math.round(+e.target.value || 0)); refreshBtn(); } });
  const setVal = (v) => { hud.inputs[key] = Math.max(min, Math.min(p.cash, Math.round(v / 100) * 100)); input.value = hud.inputs[key]; refreshBtn(); };
  const bidBtn = h('button.btn.primary.block');
  const refreshBtn = () => {
    const v = val();
    clear(bidBtn).append(`Поставить ${fmt(v)}`);
    bidBtn.disabled = !bid || !bid.ok || v < min || v > p.cash || v % 100 !== 0;
  };
  refreshBtn();
  bidBtn.onclick = () => act(hud, pr.pid, { t: 'bid', amount: val() });
  if (bid && bid.ok) {
    P.body.push(h('div.stepper', h('button.btn', { onclick: () => setVal(val() - 1000) }, '−'), input, h('button.btn', { onclick: () => setVal(val() + 1000) }, '+')));
    P.body.push(h('div.quick', [1000, 5000, 10000, 50000].map((d) => h('button.btn.tiny', { onclick: () => setVal(val() + d) }, '+' + d.toLocaleString('ru-RU'))), h('button.btn.tiny', { onclick: () => setVal(min) }, 'мин.')));
    P.body.push(h('div.small.muted', `Минимум ${fmt(min)} · ваши деньги ${fmt(p.cash)}`));
  } else {
    P.body.push(h('div.hint.warn', 'Не хватает денег, чтобы перебить ставку.'));
  }
  P.foot.push(bidBtn, h('button.btn.block', { onclick: () => act(hud, pr.pid, { t: 'pass' }) }, 'Пас'));
  P.miniAction = { label: 'Пас', fn: () => act(hud, pr.pid, { t: 'pass' }) };
}

function commissionInfo(st, pr) {
  return h('div.sect', { style: { padding: '8px 10px' } },
    h('div', { style: { fontWeight: 700 } }, `${pname(st, pr.buyer)} покупает «${compName(pr.comp)}» для участка №${pr.land}`),
    h('div.kv', h('span', 'Номинал (в банк)'), h('b', fmt(pr.nominal))),
    pr.holders.map((hid) => h('div.kv', h('span', h('span.row', { style: { display: 'inline-flex', gap: '5px' } }, dot(pc(st, hid)), pname(st, hid))),
      h('b', hid in pr.asks ? fmt(pr.asks[hid]) + (pr.stage === 'lower' && !pr.lowerDone.includes(hid) ? ' → ?' : '') : '…'))));
}

function commissionPanel(hud, st, pr, opts, P) {
  const pid = pr.pid;
  if (pr.stage === 'ask' || pr.stage === 'lower') {
    P.what = `Вы акционер «${coName(pr.company)}»`;
    P.body.push(commissionInfo(st, pr));
    const max = pr.stage === 'lower' ? pr.asks[pid] : CONST.MAX_ASK;
    P.body.push(h('div.hint', pr.stage === 'lower'
      ? `Покупатель просит снизить комиссионные. Сейчас вы просите ${fmt(pr.asks[pid])}. Назовите сумму не больше этой.`
      : 'Назовите свои комиссионные за продажу карты. Внимание: если покупатель откажется, вы заплатите в банк штраф в размере запрошенной суммы!'));
    const key = 'ask' + pr.id + pr.stage;
    if (hud.inputs[key] === undefined) hud.inputs[key] = pr.stage === 'lower' ? Math.round((pr.asks[pid] * 0.5) / 100) * 100 : Math.round((pr.nominal * 0.1) / 100) * 100;
    const input = h('input', { type: 'number', value: hud.inputs[key], min: 0, step: 500, oninput: (e) => { hud.inputs[key] = Math.max(0, Math.round(+e.target.value || 0)); upd(); } });
    const btn = h('button.btn.primary.block');
    const upd = () => { const v = hud.inputs[key]; clear(btn).append(`Назвать ${fmt(v)}`); btn.disabled = v < 0 || v > max || v % 100 !== 0; };
    upd();
    btn.onclick = () => act(hud, pid, { t: 'ask', amount: hud.inputs[key] });
    const set = (v) => { hud.inputs[key] = Math.min(max, Math.max(0, Math.round(v / 100) * 100)); input.value = hud.inputs[key]; upd(); };
    P.body.push(h('div.quick', [0, 0.05, 0.1, 0.15, 0.2, 0.3].map((k) => h('button.btn.tiny', { onclick: () => set(pr.nominal * k) }, k ? `${k * 100}%` : '0'))));
    P.body.push(h('div.stepper', h('button.btn', { onclick: () => set(hud.inputs[key] - 1000) }, '−'), input, h('button.btn', { onclick: () => set(hud.inputs[key] + 1000) }, '+')));
    P.foot.push(btn);
    return;
  }
  // решение покупателя
  P.what = 'Комиссионные акционеров';
  P.body.push(commissionInfo(st, pr));
  const acc = opts.find((o) => o.t === 'accept');
  P.body.push(h('div.hint', 'Согласитесь, попросите снизить (один раз) или откажитесь. При отказе акционеры платят штраф в банк в размере запрошенного, а вы теряете остаток хода.'));
  P.foot.push(h('button.btn.primary.block', { onclick: () => act(hud, pid, { t: 'accept' }), disabled: !acc || !acc.ok }, `Согласиться — ${fmt(acc ? acc.cost : 0)}`, acc && !acc.ok ? h('span.sub', acc.why) : null));
  if (opts.some((o) => o.t === 'lower')) P.foot.push(h('button.btn.block', { onclick: () => act(hud, pid, { t: 'lower' }) }, 'Попросить снизить'));
  P.foot.push(h('button.btn.danger.block', { onclick: () => act(hud, pid, { t: 'refuse' }) }, 'Отказаться от покупки'));
}

function creditInfo(st, pr) {
  return h('div.sect', { style: { padding: '8px 10px' } },
    h('div', { style: { fontWeight: 700 } }, `${pname(st, pr.borrower)} просит кредит ${fmt(CONST.CREDIT_AMOUNT)}`),
    pr.holders.map((hid) => h('div.kv', h('span', h('span.row', { style: { display: 'inline-flex', gap: '5px' } }, dot(pc(st, hid)), pname(st, hid))), h('b', hid in pr.asks ? pr.asks[hid] + '%' : '…'))),
    h('div.small.muted', 'Свободные кредиты: ' + [...st.stock.credits].sort((a, b) => a - b).join('%, ') + '%'));
}

function creditPanel(hud, st, pr, opts, P) {
  const pid = pr.pid;
  if (pr.stage === 'ask') {
    P.what = 'Вы акционер Банка';
    P.body.push(creditInfo(st, pr));
    P.body.push(h('div.hint', 'Назначьте процент по кредиту. Проценты получают акционеры банка каждый раз, когда заёмщик проходит Банк. Итоговый процент — наибольший из названных.'));
    P.body.push(h('div.quick', opts.filter((o) => o.t === 'rate').map((o) => h('button.btn', { onclick: () => act(hud, pid, { t: 'rate', rate: o.rate }) }, o.rate + '%'))));
    return;
  }
  P.what = 'Условия кредита';
  P.body.push(creditInfo(st, pr));
  const r = creditOffered(st, pr);
  P.body.push(h('div.hint', `Итоговый процент: ${r}% — это ${fmt(CONST.CREDIT_AMOUNT * r / 100)} при каждом проходе Банка.`));
  P.foot.push(h('button.btn.primary.block', { onclick: () => act(hud, pid, { t: 'accept' }) }, `Взять кредит под ${r}%`));
  P.foot.push(h('button.btn.block', { onclick: () => act(hud, pid, { t: 'refuse' }) }, 'Отказаться'));
}

function antimonoPanel(hud, st, pr, opts, P) {
  P.what = 'Антимонопольный комитет';
  P.body.push(h('div.hint.warn', 'Вы монополист в нескольких компаниях. Выберите, акции какой компании придётся продать на аукционе (останется одна акция).'));
  for (const o of opts) P.body.push(optBtn(`${coName(o.c)} (у вас ${shareCount(st, o.c, pr.pid)})`, null, o, () => act(hud, pr.pid, { t: 'chooseMono', c: o.c })));
}

function waitingPanel(hud, st, pr, P) {
  const app = hud.app;
  const actor = st.players[pr.pid];
  P.what = 'Ожидаем решения игрока';
  const isOffline = app.session.mode === 'host' && app.session.seats[pr.pid] && !app.session.seats[pr.pid].online;
  if (actor.kind === 'bot') P.body.push(h('div.hint', h('span.spinner'), '  Компьютер думает…'));
  else P.body.push(h('div.hint', h('span.spinner'), `  Ходит ${actor.name}`));
  if (isOffline) {
    P.body.push(h('div.hint.warn', `${actor.name}: нет связи. Можно подождать переподключения или играть за него на этом устройстве.`));
    P.body.push(h('button.btn.block', { onclick: () => app.session.takeOver(pr.pid) }, 'Играть за этого игрока здесь'));
  }
  switch (pr.type) {
    case 'turn': {
      const p = st.players[pr.pid];
      P.body.push(cellCard(p.pos, cellStatus(st, p.pos)));
      break;
    }
    case 'auction': P.body.push(auctionInfo(st, pr)); break;
    case 'commission': P.body.push(commissionInfo(st, pr)); break;
    case 'creditNeg': P.body.push(creditInfo(st, pr)); break;
    case 'debt': P.body.push(h('div.hint.warn', `${actor.name}: финансовая необеспеченность (${fmt(debtTotal(actor))}).`)); break;
    case 'ownerDeal': P.body.push(h('div.hint', `${actor.name} совершает сделку: на участок №${pr.land} встаёт ${pname(st, pr.visitor)}.`)); break;
    case 'antimono': P.body.push(h('div.hint', `${actor.name} выбирает, какие акции продать.`)); break;
  }
  // в сетевой игре свои «быстрые» данные
  const me = app.myPid();
  if (me !== null && me !== undefined && app.session.mode !== 'local') P.body.push(statusBlock(st, me));
}

function overPanel(hud, st) {
  const P = { who: ['🏆 Игра окончена'], what: '', body: [], foot: [] };
  st.result.forEach((r, k) => {
    P.body.push(h('div.result-row' + (k === 0 ? '.win' : ''), h('div.place', k < 3 ? ['🥇', '🥈', '🥉'][k] : String(k + 1)), dot(pc(st, r.pid)),
      h('div.grow', h('b', pname(st, r.pid)), h('div.small.muted', r.bankrupt ? 'банкрот' : `🏭 ${r.done}`)),
      h('b.gold', fmt(r.capital))));
  });
  P.foot.push(h('button.btn.block', { onclick: () => hud.app.openResults() }, '🏆 Подробные итоги'));
  P.foot.push(h('button.btn.primary.block', { onclick: () => hud.app.toMenu() }, 'В главное меню'));
  return P;
}

// Предложения займов и созревшие векселя для игроков этого устройства
function offersBlock(hud, st) {
  const app = hud.app;
  if (st.over) return null;
  const items = [];
  for (const p of st.players) {
    if (!app.session.canControl(p.id) || p.bankrupt) continue;
    for (const g of globalOptions(st, p.id)) {
      if (g.t === 'acceptOffer') {
        const o = g.offer;
        const lend = o.lender === o.from;
        items.push(h('div.offer',
          h('div', { style: { fontWeight: 700 } }, '📝 ', who(st, o.from), lend ? ` предлагает ${p.name} заём` : ` просит у ${p.name} заём`),
          h('div.small', `${fmt(o.amount)} под ${o.rate}% на ${plural(o.term, 'круг', 'круга', 'кругов')} · вернуть ${fmt(loanTotal(o))}`),
          h('div.row', { style: { marginTop: '6px' } },
            h('button.btn.green.tiny.grow', { onclick: () => act(hud, p.id, { t: 'acceptOffer', id: o.id }) }, 'Принять'),
            h('button.btn.tiny.grow', { onclick: () => act(hud, p.id, { t: 'declineOffer', id: o.id }) }, 'Отклонить'))));
      }
      if (g.t === 'demandLoan' && g.ok) {
        const l = g.loan;
        items.push(h('div.offer', h('div.small', `${p.name}: срок займа ${pname(st, l.borrower)} (${fmt(loanTotal(l))}) истёк.`),
          h('button.btn.tiny', { onclick: () => act(hud, p.id, { t: 'demandLoan', id: l.id }) }, 'Потребовать возврат')));
      }
    }
  }
  return items.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, items) : null;
}

// Всплывающая карта «Деловой случай» / «Консультация»
export function cardPopup(st, e) {
  const isS = e.deck === 'surprise';
  const card = isS ? SURPRISES[e.idx] : CONSULTS[e.idx];
  const color = isS ? TYPE_STYLE.surprise.color : TYPE_STYLE.consultation.color;
  const amt = isS ? card.amount : -card.amount;
  return h('div.bigcard',
    h('div.bh', { style: { background: color } }, isS ? '⚡ ДЕЛОВОЙ СЛУЧАЙ' : '💡 КОНСУЛЬТАЦИЯ'),
    h('div.bb', h('div', h('b', pname(st, e.pid))), h('div', { style: { marginTop: '6px' } }, card.text),
      h('div.amt', { style: { color: amt >= 0 ? '#1c8a4f' : '#c62828' } }, (amt >= 0 ? '+' : '−') + fmt(Math.abs(amt))),
      isS && e.used ? h('div.small', { style: { marginTop: '6px' } }, `Страховка (${e.used} шт.) покрыла ${fmt(e.covered)}`) : null,
      !isS ? h('div.small', { style: { marginTop: '6px' } }, 'Платится акционерам Консалтинговой компании') : null));
}

export { pname, coName, compName, holdersDots, who, nominalCase, holderList, INDUSTRIES };
