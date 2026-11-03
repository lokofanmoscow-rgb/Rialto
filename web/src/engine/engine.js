// Движок правил «Риальто».
// Состояние игры — простой JSON-объект (его можно сохранять и передавать по сети).
// Все изменения делаются через dispatch(state, playerId, action) → { ok, state } | { error }.

import {
  CONST, COMPANIES, COMPANY_KEYS, INDUSTRIES, INDUSTRY, COMPONENTS, LANDS, LAND_BY_NO, LAND_CELL,
  BOARD, BOARD_SIZE, SURPRISES, CONSULTS, cellTitle, fmt,
} from './data.js';

let rand = Math.random;
export function setRandom(fn) { rand = fn || Math.random; }

class RuleError extends Error {}
const fail = (m) => { throw new RuleError(m); };
const R100 = (x) => Math.round(x / 100) * 100;
const d6 = () => 1 + Math.floor(rand() * 6);
const clone = (o) => JSON.parse(JSON.stringify(o));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const emptyEnt = () => ({ lic: null, mat: false, eq: false, pers: false });
const newTurn = () => ({ phase: 'pre', dice: null, credit: false, acts: [], lost: false });

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ───────────────────────── создание игры ─────────────────────────

export function createGame(opts) {
  const players = opts.players || [];
  if (players.length < 2) fail('Нужно минимум 2 игрока');
  const startCash = opts.startCash || CONST.START_CASH;
  const st = {
    v: 1,
    id: Math.floor(rand() * 1e9).toString(36) + Date.now().toString(36),
    created: Date.now(),
    settings: { target: opts.target || 3, startCash },
    players: players.map((p, i) => ({
      id: i, name: p.name || `Игрок ${i + 1}`, color: p.color, kind: p.kind || 'human',
      cash: startCash, pos: 0, notes: CONST.NOTES_PER_PLAYER, insurance: 0,
      credits: [], done: [], debts: [], bankrupt: false,
    })),
    shares: Object.fromEntries(COMPANY_KEYS.map((k) => [k, [null, null, null]])),
    pool: 0,
    lands: LANDS.map((l) => ({ no: l.no, owner: null, ent: emptyEnt() })),
    stock: {
      lic: Object.fromEntries(INDUSTRIES.map((x) => [x.id, CONST.LICENSES_PER_INDUSTRY])),
      mat: CONST.COMPONENT_STOCK, eq: CONST.COMPONENT_STOCK, pers: CONST.COMPONENT_STOCK,
      credits: [...CONST.CREDIT_RATES], ins: CONST.INSURANCE_STOCK,
    },
    decks: {
      surprise: shuffle(SURPRISES.map((_, i) => i)),
      consult: shuffle(CONSULTS.map((_, i) => i)),
    },
    loans: [], offers: [], nextId: 1,
    first: 0, cur: 0, round: 1,
    turn: newTurn(),
    stack: [],
    seq: 0, events: [], log: [],
    over: false, result: null,
  };
  log(st, 'Игра началась! Цель — ' + plural(st.settings.target, 'предприятие', 'предприятия', 'предприятий') + '.', 'sys');
  decideOrder(st);
  return st;
}

function decideOrder(st) {
  let contenders = st.players.map((p) => p.id);
  const rounds = [];
  for (let guard = 0; guard < 50; guard++) {
    const rolls = contenders.map((id) => [id, [d6(), d6()]]);
    rounds.push(rolls);
    const best = Math.max(...rolls.map((r) => r[1][0] + r[1][1]));
    const top = rolls.filter((r) => r[1][0] + r[1][1] === best).map((r) => r[0]);
    rolls.forEach(([id, d]) => log(st, `${nm(st, id)} бросает на очерёдность: ${d[0]} + ${d[1]} = ${d[0] + d[1]}`, 'dice'));
    if (top.length === 1) { st.first = top[0]; break; }
    contenders = top;
    log(st, 'Ничья — переброс между: ' + top.map((id) => nm(st, id)).join(', '), 'sys');
  }
  st.cur = st.first;
  ev(st, 'order', { rounds, first: st.first });
  log(st, `Первым ходит ${nm(st, st.first)}.`, 'turn');
  ev(st, 'turn', { pid: st.cur });
}

// ───────────────────────── утилиты ─────────────────────────

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
  return `${n} ${w}`;
}
const nm = (st, id) => (id === null || id === undefined ? 'Банк' : st.players[id].name);

function log(st, text, kind = 'info', pid) {
  st.log.push({ s: ++st.seq, text, kind, pid });
  if (st.log.length > 300) st.log.splice(0, st.log.length - 300);
}
function ev(st, type, data = {}) {
  st.events.push({ s: ++st.seq, type, ...data });
  if (st.events.length > 80) st.events.splice(0, st.events.length - 80);
}

export const landOf = (st, no) => st.lands[no - 1];
export function shareCount(st, c, pid) { return st.shares[c].filter((o) => o === pid).length; }
export function boughtCount(st, c) { return st.shares[c].filter((o) => o !== null).length; }
export function isHolder(st, pid, c) { return shareCount(st, c, pid) > 0; }
export function holderList(st, c) { return [...new Set(st.shares[c].filter((o) => o !== null))]; }
export function ownedLands(st, pid) { return st.lands.filter((l) => l.owner === pid); }
export function playerShares(st, pid) {
  const out = [];
  for (const k of COMPANY_KEYS) { const n = shareCount(st, k, pid); if (n) out.push({ c: k, n }); }
  return out;
}

// Покупка по номиналу без переговоров: нет акционеров, у покупателя 2–3 акции или единственная выкупленная
export function nominalCase(st, pid, c) {
  const bought = boughtCount(st, c);
  const mine = shareCount(st, c, pid);
  return bought === 0 || mine >= 2 || (mine === 1 && bought === 1);
}

// Распределение дохода компании между акционерами (поровну на каждую выкупленную акцию)
export function incomeItems(st, c, amount) {
  amount = R100(amount);
  if (amount <= 0) return [];
  const bought = st.shares[c].filter((o) => o !== null);
  if (!bought.length) return [{ to: 'bank', amount }];
  const per = {};
  for (const o of bought) per[o] = (per[o] || 0) + 1;
  return Object.entries(per).map(([o, n]) => ({ to: +o, amount: R100((amount * n) / bought.length) }));
}

function moveMoney(st, pid, it) {
  st.players[pid].cash -= it.amount;
  if (it.to === 'pool') st.pool += it.amount;
  else if (typeof it.to === 'number') {
    const r = st.players[it.to];
    if (r && !r.bankrupt) r.cash += it.amount;
  }
}
// Выплаты из банка
function payout(st, items) {
  for (const it of items) if (typeof it.to === 'number' && !st.players[it.to].bankrupt) st.players[it.to].cash += it.amount;
}
export function debtTotal(p) { return sum(p.debts.map((d) => d.amount)); }

// Обязательный платёж. Если денег не хватает — весь платёж становится долгом (финансовая необеспеченность).
function charge(st, pid, items, reason) {
  const p = st.players[pid];
  items = items.filter((it) => it.amount > 0 && it.to !== pid);
  const total = sum(items.map((i) => i.amount));
  if (total <= 0) return true;
  if (p.cash >= total && p.debts.length === 0) {
    for (const it of items) moveMoney(st, pid, it);
    return true;
  }
  for (const it of items) p.debts.push({ to: it.to, amount: it.amount, reason });
  log(st, `${p.name}: не хватает денег на «${reason}» (${fmt(total)}) — финансовая необеспеченность!`, 'warn', pid);
  ev(st, 'debt', { pid, amount: total });
  return false;
}
// Добровольная покупка — должна быть оплачена сразу
function spend(st, pid, items, what) {
  const p = st.players[pid];
  items = items.filter((it) => it.amount > 0 && it.to !== pid);
  const total = sum(items.map((i) => i.amount));
  if (p.debts.length) fail('Сначала погасите долги');
  if (p.cash < total) fail(`Недостаточно денег: нужно ${fmt(total)}`);
  for (const it of items) moveMoney(st, pid, it);
  return total;
}
function itemsText(st, items) {
  return items.filter((i) => i.amount > 0).map((i) => `${i.to === 'bank' ? 'Банк' : i.to === 'pool' ? 'страховой фонд' : nm(st, i.to)} ${fmt(i.amount)}`).join(', ');
}

// ───────────────────────── активный запрос ─────────────────────────

export function activePrompt(st) {
  if (st.over) return { type: 'over', pid: null };
  if (st.stack.length) return st.stack[st.stack.length - 1];
  return { type: 'turn', pid: st.cur, phase: st.turn.phase };
}

// ───────────────────────── основной dispatch ─────────────────────────

export function dispatch(state, pid, action) {
  const st = clone(state);
  try {
    if (!action || typeof action.t !== 'string') fail('Пустое действие');
    if (st.over) fail('Игра окончена');
    const p = st.players[pid];
    if (!p) fail('Нет такого игрока');
    if (p.bankrupt) fail('Игрок выбыл');
    if (GLOBAL[action.t]) {
      GLOBAL[action.t](st, pid, action);
    } else {
      const pr = activePrompt(st);
      if (pr.pid !== pid) fail('Сейчас действует другой игрок');
      const table = HANDLERS[pr.type];
      const h = table && table[action.t];
      if (!h) fail('Это действие сейчас недоступно');
      h(st, pid, action, pr);
    }
    normalize(st);
    return { ok: true, state: st };
  } catch (e) {
    if (e instanceof RuleError) return { error: e.message };
    throw e;
  }
}

function removePrompt(st, pr) {
  const i = st.stack.lastIndexOf(pr);
  if (i >= 0) st.stack.splice(i, 1);
}

// ───────────────────────── ход игрока ─────────────────────────

function nextTurn(st) {
  const n = st.players.length;
  st.offers = [];
  for (let k = 1; k <= n; k++) {
    const j = (st.cur + k) % n;
    if (j === st.first) st.round++;
    if (!st.players[j].bankrupt) { st.cur = j; break; }
  }
  st.turn = newTurn();
  ev(st, 'turn', { pid: st.cur });
  log(st, `Ход игрока ${nm(st, st.cur)}.`, 'turn', st.cur);
}

function doRoll(st, pid) {
  const a = d6(), b = d6();
  st.turn.dice = [a, b];
  ev(st, 'dice', { pid, dice: [a, b] });
  log(st, `${nm(st, pid)} бросает кубики: ${a} + ${b} = ${a + b}`, 'dice', pid);
  move(st, pid, a + b);
}

function move(st, pid, steps) {
  const p = st.players[pid];
  const from = p.pos;
  const path = [];
  for (let k = 1; k <= steps; k++) path.push((from + k) % BOARD_SIZE);
  p.pos = path[path.length - 1];
  ev(st, 'move', { pid, from, to: p.pos, steps });
  for (let k = 0; k < path.length - 1; k++) passEffect(st, pid, path[k], false);
  passEffect(st, pid, p.pos, true);
  landOn(st, pid);
}

function payInterest(st, pid) {
  const p = st.players[pid];
  if (!p.credits.length) return;
  const total = sum(p.credits.map((r) => R100((CONST.CREDIT_AMOUNT * r) / 100)));
  const items = incomeItems(st, 'bank', total);
  log(st, `${p.name} проходит Банк и платит проценты по кредитам: ${fmt(total)}`, 'money', pid);
  charge(st, pid, items, 'проценты по кредитам');
}

function passEffect(st, pid, i, stop) {
  const c = BOARD[i];
  const p = st.players[pid];
  const verb = stop ? 'останавливается на клетке' : 'проходит клетку';
  if (c.type === 'company' && c.company === 'bank') payInterest(st, pid);
  else if (c.type === 'dividends') {
    const n = sum(COMPANY_KEYS.map((k) => shareCount(st, k, pid)));
    if (n) {
      const amt = n * CONST.DIVIDEND;
      p.cash += amt;
      log(st, `${p.name} ${verb} «Дивиденды»: +${fmt(amt)} за ${plural(n, 'акцию', 'акции', 'акций')}`, 'money', pid);
      ev(st, 'money', { pid, delta: amt });
    }
  } else if (c.type === 'income') {
    const n = p.done.length;
    if (n) {
      const amt = n * CONST.ENTERPRISE_INCOME;
      p.cash += amt;
      log(st, `${p.name} ${verb} «Доход от предприятий»: +${fmt(amt)}`, 'money', pid);
      ev(st, 'money', { pid, delta: amt });
    }
  } else if (c.type === 'tax') {
    const base = taxBase(st, pid);
    const tax = R100(base * CONST.TAX_RATE);
    if (tax > 0) {
      log(st, `${p.name} ${verb} «Налоговая инспекция»: налог ${fmt(tax)} (10% от ${fmt(base)})`, 'money', pid);
      charge(st, pid, [{ to: 'bank', amount: tax }], 'налог');
    } else log(st, `${p.name} ${verb} «Налоговая инспекция»: имущества нет, налог 0`, 'info', pid);
  }
}

export function taxBase(st, pid) {
  const sh = sum(COMPANY_KEYS.map((k) => shareCount(st, k, pid) * COMPANIES[k].price));
  const ld = sum(ownedLands(st, pid).map((l) => LAND_BY_NO[l.no].price));
  return sh + ld;
}

function landOn(st, pid) {
  const p = st.players[pid];
  const c = BOARD[p.pos];
  st.turn.phase = 'post';
  switch (c.type) {
    case 'deal': st.turn.phase = 'cell'; return;
    case 'land': {
      const L = landOf(st, c.land);
      if (L.owner === null) { st.turn.phase = 'cell'; return; }
      if (L.owner === pid) { log(st, `${p.name} на своём участке №${c.land}.`, 'info', pid); return; }
      log(st, `${p.name} встаёт на участок №${c.land} игрока ${nm(st, L.owner)} — владелец может совершить сделку.`, 'info', L.owner);
      st.stack.push({ type: 'ownerDeal', pid: L.owner, land: c.land, visitor: pid, id: st.nextId++ });
      return;
    }
    case 'surprise': drawSurprise(st, pid); return;
    case 'consultation': drawConsult(st, pid); return;
    case 'antimono': antimono(st, pid); return;
    case 'company': {
      const k = c.company;
      if ((k === 'school' || k === 'consult') && !isHolder(st, pid, k)) {
        const fee = k === 'school' ? CONST.SCHOOL_FEE : CONST.RESEARCH_FEE;
        const what = k === 'school' ? 'обучение в Бизнес-школе' : 'маркетинговое исследование';
        const items = incomeItems(st, k, fee);
        log(st, `${p.name} платит за ${what} ${fmt(fee)} → ${itemsText(st, items)}`, 'money', pid);
        charge(st, pid, items, what);
      }
      st.turn.phase = 'cell';
      return;
    }
    default: return;
  }
}

function drawSurprise(st, pid) {
  const p = st.players[pid];
  const idx = st.decks.surprise.shift();
  st.decks.surprise.push(idx);
  const card = SURPRISES[idx];
  let used = 0, covered = 0, rest = 0;
  if (card.amount > 0) {
    p.cash += card.amount;
    log(st, `«Деловой случай» для ${p.name}: ${card.text}. Доход +${fmt(card.amount)}`, 'money', pid);
  } else {
    const loss = -card.amount;
    const need = Math.min(CONST.INSURANCE_MAX, Math.ceil(loss / CONST.INSURANCE_COVER));
    used = Math.min(need, p.insurance);
    covered = Math.min(loss, used * CONST.INSURANCE_COVER);
    p.insurance -= used;
    st.stock.ins += used;
    rest = loss - covered;
    let t = `«Деловой случай» для ${p.name}: ${card.text}. Убыток ${fmt(loss)}`;
    if (used) t += `; страховка (${used} шт.) покрыла ${fmt(covered)}`;
    log(st, t, 'warn', pid);
    if (rest > 0) charge(st, pid, [{ to: 'bank', amount: rest }], 'убыток');
  }
  ev(st, 'card', { pid, deck: 'surprise', idx, used, covered, rest });
}

function drawConsult(st, pid) {
  const p = st.players[pid];
  const idx = st.decks.consult.shift();
  st.decks.consult.push(idx);
  const card = CONSULTS[idx];
  const items = incomeItems(st, 'consult', card.amount);
  log(st, `«Консультация» для ${p.name}: ${card.text} — ${fmt(card.amount)} → ${itemsText(st, items) || 'себе'}`, 'money', pid);
  ev(st, 'card', { pid, deck: 'consult', idx });
  charge(st, pid, items, 'консультация');
}

function antimono(st, pid) {
  const opts = COMPANY_KEYS.filter((k) => shareCount(st, k, pid) >= 2);
  if (!opts.length) { log(st, `${nm(st, pid)} — не монополист, антимонопольный комитет претензий не имеет.`, 'info', pid); return; }
  if (opts.length === 1) startAntimono(st, pid, opts[0]);
  else {
    log(st, `${nm(st, pid)} — монополист в нескольких компаниях и выбирает, акции какой продать.`, 'warn', pid);
    st.stack.push({ type: 'antimono', pid, options: opts, id: st.nextId++ });
  }
}
function startAntimono(st, pid, c) {
  const n = shareCount(st, c, pid) - 1;
  log(st, `Антимонопольный комитет: ${nm(st, pid)} обязан продать ${plural(n, 'акцию', 'акции', 'акций')} компании «${COMPANIES[c].name}» на аукционе.`, 'warn', pid);
  for (let k = 0; k < n; k++) pushAuction(st, { kind: 'share', c, seller: pid, reason: 'antimono' });
}

// ───────────────────────── сделки ─────────────────────────

export function dealSpec() { return { buy: 'any', sell: 'any', license: true, comps: ['mat', 'eq', 'pers'], sellLand: true }; }

export function cellSpec(st, pid) {
  const p = st.players[pid];
  const c = BOARD[p.pos];
  const used = st.turn.acts;
  if (c.type === 'deal') return dealSpec();
  if (c.type === 'land') {
    const L = landOf(st, c.land);
    return L.owner === null ? { buyLand: c.land, declineLand: true } : {};
  }
  if (c.type === 'company') {
    const k = c.company;
    switch (k) {
      case 'exchange': return { buy: 'any', sell: 'any' };
      case 'trade': return { buy: k, sell: k, comps: ['mat', 'eq'] };
      case 'hr': return { buy: k, sell: k, comps: ['pers'] };
      case 'bank':
        if (used.includes('buyShare')) return { bankCredit: true };
        if (used.includes('bankCredit')) return { buy: k };
        return { buy: k, sell: k, bankCredit: true };
      case 'insure': return { buy: k, sell: k };
      case 'school': case 'consult': return isHolder(st, pid, k) ? { buy: k, sell: k } : { buy: k };
      case 'realty': return { buy: k, sell: k, buyLand: 'any', sellLand: true };
    }
  }
  return {};
}

function pendingSales(st, pid, kind, key) {
  return st.stack.filter((a) => a.type === 'auction' && a.seller === pid && a.kind === kind && (kind === 'share' ? a.c === key : a.land === key)).length;
}

function execDeal(st, pid, a, spec, ctx) {
  switch (a.t) {
    case 'buyShare':
      if (!COMPANIES[a.c]) fail('Нет такой компании');
      if (!(spec.buy === 'any' || spec.buy === a.c)) fail('Здесь нельзя купить эту акцию');
      return buyShare(st, pid, a.c);
    case 'sellShare':
      if (!COMPANIES[a.c]) fail('Нет такой компании');
      if (!(spec.sell === 'any' || spec.sell === a.c)) fail('Здесь нельзя продать эту акцию');
      return startShareSale(st, pid, a.c);
    case 'buyLicense':
      if (!spec.license) fail('Здесь нельзя купить лицензию');
      return buyLicense(st, pid, a.ind, a.land);
    case 'buyComp':
      if (!spec.comps || !spec.comps.includes(a.comp)) fail('Здесь нельзя купить эту карту');
      return buyComp(st, pid, a.comp, a.land, ctx);
    case 'sellLand':
      if (!spec.sellLand) fail('Здесь нельзя продать участок');
      return startLandSale(st, pid, a.land);
    case 'buyLand':
      if (spec.buyLand == null) fail('Здесь нельзя купить участок');
      if (spec.buyLand !== 'any' && spec.buyLand !== a.land) fail('Можно купить только этот участок');
      return buyLand(st, pid, a.land);
    case 'declineLand':
      if (!spec.declineLand) fail('Нечего отклонять');
      return declineLand(st, pid, spec.buyLand);
    case 'bankCredit':
      if (!spec.bankCredit) fail('Кредит здесь недоступен');
      return takeCredit(st, pid, true);
    default: fail('Недопустимое действие');
  }
}

function buyShare(st, pid, c) {
  const sh = st.shares[c];
  const idx = sh.indexOf(null);
  if (idx < 0) fail('Свободных акций этой компании нет');
  const price = COMPANIES[c].price;
  const comm = R100(price * CONST.TRADE_COMMISSION);
  spend(st, pid, [{ to: 'bank', amount: price - comm }, ...incomeItems(st, 'exchange', comm)], 'акция');
  sh[idx] = pid;
  log(st, `${nm(st, pid)} покупает акцию «${COMPANIES[c].name}» за ${fmt(price)}`, 'buy', pid);
  ev(st, 'share', { pid, c });
}

function startShareSale(st, pid, c) {
  const have = shareCount(st, c, pid) - pendingSales(st, pid, 'share', c);
  if (have <= 0) fail('У вас нет свободной для продажи акции этой компании');
  log(st, `${nm(st, pid)} выставляет акцию «${COMPANIES[c].name}» на аукцион.`, 'sell', pid);
  pushAuction(st, { kind: 'share', c, seller: pid, reason: 'sale' });
}

function ownLand(st, pid, no) {
  const L = landOf(st, no);
  if (!L) fail('Нет такого участка');
  if (L.owner !== pid) fail('Это не ваш участок');
  return L;
}

function buyLicense(st, pid, ind, no) {
  if (!INDUSTRY[ind]) fail('Нет такой отрасли');
  const L = ownLand(st, pid, no);
  if (L.ent.lic) fail('На этом участке уже вводится предприятие');
  if (pendingSales(st, pid, 'land', no)) fail('Участок выставлен на продажу');
  if (st.stock.lic[ind] <= 0) fail('Лицензии этой отрасли закончились');
  spend(st, pid, [{ to: 'bank', amount: CONST.LICENSE_PRICE }], 'лицензия');
  st.stock.lic[ind]--;
  L.ent.lic = ind;
  log(st, `${nm(st, pid)} покупает лицензию «${INDUSTRY[ind].name}» для участка №${no}`, 'buy', pid);
  ev(st, 'ent', { pid, land: no });
}

export function compPrice(st, no, comp) {
  const L = landOf(st, no);
  return L.ent.lic ? INDUSTRY[L.ent.lic][comp] : 0;
}

function buyComp(st, pid, comp, no, ctx) {
  if (!COMPONENTS[comp]) fail('Нет такой карты');
  const L = ownLand(st, pid, no);
  if (!L.ent.lic) fail('Сначала купите лицензию для этого участка');
  if (L.ent[comp]) fail('Эта карта уже лежит на предприятии');
  if (st.stock[comp] <= 0) fail('В банке закончились такие карты');
  if (pendingSales(st, pid, 'land', no)) fail('Участок выставлен на продажу');
  const price = INDUSTRY[L.ent.lic][comp];
  const company = COMPONENTS[comp].company;
  const p = st.players[pid];
  if (p.debts.length) fail('Сначала погасите долги');
  if (nominalCase(st, pid, company)) {
    spend(st, pid, [{ to: 'bank', amount: price }], COMPONENTS[comp].name);
    log(st, `${p.name} покупает карту «${COMPONENTS[comp].name}» для участка №${no} за ${fmt(price)}`, 'buy', pid);
    placeComp(st, pid, L, comp);
  } else {
    if (p.cash < price) fail(`Недостаточно денег: только номинал стоит ${fmt(price)}`);
    const holders = holderList(st, company).filter((h) => h !== pid);
    log(st, `${p.name} хочет купить «${COMPONENTS[comp].name}» (${fmt(price)}). Акционеры «${COMPANIES[company].name}» называют свои комиссионные.`, 'info', pid);
    st.stack.push({
      type: 'commission', pid: holders[0], buyer: pid, comp, land: no, company, nominal: price,
      holders, asks: {}, lowerDone: [], stage: 'ask', lowered: false, ctx, id: st.nextId++,
    });
  }
}

function placeComp(st, pid, L, comp) {
  L.ent[comp] = true;
  st.stock[comp]--;
  ev(st, 'ent', { pid, land: L.no });
  const e = L.ent;
  if (e.lic && e.mat && e.eq && e.pers) {
    const p = st.players[pid];
    const ind = INDUSTRY[e.lic];
    const half = R100(LAND_BY_NO[L.no].price / 2);
    const payout = ind.product + half;
    p.cash += payout;
    p.done.push(e.lic);
    st.stock.mat++; st.stock.eq++; st.stock.pers++;
    L.ent = emptyEnt();
    log(st, `🏭 ${p.name} вводит в эксплуатацию предприятие «${ind.name}» на участке №${L.no}! Выручка ${fmt(ind.product)} + половина цены участка ${fmt(half)} = ${fmt(payout)}`, 'big', pid);
    ev(st, 'enterprise', { pid, land: L.no, ind: ind.id, payout });
    if (p.done.length >= st.settings.target) finishGame(st, pid);
  }
}

function clearEnt(st, L) {
  const e = L.ent;
  if (e.lic) st.stock.lic[e.lic]++;
  for (const k of ['mat', 'eq', 'pers']) if (e[k]) st.stock[k]++;
  const had = !!e.lic;
  L.ent = emptyEnt();
  return had;
}

function buyLand(st, pid, no) {
  const L = landOf(st, no);
  if (!L) fail('Нет такого участка');
  if (L.owner !== null) fail('Участок уже принадлежит игроку');
  const price = LAND_BY_NO[no].price;
  const comm = R100(price * CONST.TRADE_COMMISSION);
  spend(st, pid, [{ to: 'bank', amount: price - comm }, ...incomeItems(st, 'realty', comm)], 'участок');
  L.owner = pid;
  log(st, `${nm(st, pid)} покупает участок №${no} за ${fmt(price)} и получает карту предприятия №${no}`, 'buy', pid);
  ev(st, 'land', { pid, land: no });
}

function declineLand(st, pid, no) {
  log(st, `${nm(st, pid)} отказывается от участка №${no} — участок выставляется на аукцион.`, 'info', pid);
  pushAuction(st, { kind: 'land', land: no, seller: null, decliner: pid, reason: 'decline' });
}

function startLandSale(st, pid, no) {
  const L = ownLand(st, pid, no);
  if (pendingSales(st, pid, 'land', no)) fail('Участок уже на аукционе');
  const had = clearEnt(st, L);
  log(st, `${nm(st, pid)} выставляет участок №${no} на аукцион` + (had ? ' (карты с предприятия сданы в банк)' : ''), 'sell', pid);
  pushAuction(st, { kind: 'land', land: no, seller: pid, reason: 'sale' });
}

// ───────────────────────── кредиты и страховка ─────────────────────────

export function creditBlock(st, pid, atBank) {
  const p = st.players[pid];
  if (st.cur !== pid) return 'Кредит берут только в свой ход';
  if (!atBank && st.turn.phase !== 'pre') return 'Кредит берут до броска кубиков';
  if (st.turn.credit) return 'В этот ход кредит уже брали';
  if (p.debts.length) return 'При финансовой необеспеченности кредит не выдаётся';
  if (!st.stock.credits.length) return 'В банке нет свободных кредитов';
  return null;
}

function takeCredit(st, pid, atBank) {
  const why = creditBlock(st, pid, atBank);
  if (why) fail(why);
  st.turn.credit = true;
  if (atBank || nominalCase(st, pid, 'bank')) {
    giveCredit(st, pid, Math.min(...st.stock.credits));
  } else {
    const holders = holderList(st, 'bank').filter((h) => h !== pid);
    log(st, `${nm(st, pid)} просит кредит. Акционеры Банка назначают процент.`, 'info', pid);
    st.stack.push({ type: 'creditNeg', pid: holders[0], borrower: pid, holders, asks: {}, stage: 'ask', id: st.nextId++ });
  }
}
function giveCredit(st, pid, rate) {
  const i = st.stock.credits.indexOf(rate);
  if (i < 0) fail('Кредита с таким процентом в банке нет');
  st.stock.credits.splice(i, 1);
  const p = st.players[pid];
  p.credits.push(rate);
  p.cash += CONST.CREDIT_AMOUNT;
  log(st, `${p.name} берёт кредит ${fmt(CONST.CREDIT_AMOUNT)} под ${rate}% (${fmt(R100(CONST.CREDIT_AMOUNT * rate / 100))} при каждом проходе Банка)`, 'money', pid);
  ev(st, 'money', { pid, delta: CONST.CREDIT_AMOUNT });
}

export function insureBlock(st, pid) {
  const p = st.players[pid];
  if (st.cur !== pid || st.turn.phase !== 'pre') return 'Страховку покупают в свой ход до броска кубиков';
  if (p.insurance >= CONST.INSURANCE_MAX) return `Не больше ${CONST.INSURANCE_MAX} свидетельств`;
  if (st.stock.ins <= 0) return 'Свидетельства закончились';
  if (p.debts.length) return 'Сначала погасите долги';
  if (p.cash < CONST.INSURANCE_PRICE) return 'Недостаточно денег';
  return null;
}

// ───────────────────────── аукционы ─────────────────────────

function pushAuction(st, spec) {
  const n = st.players.length;
  const start = spec.kind === 'share' ? COMPANIES[spec.c].price : LAND_BY_NO[spec.land].price;
  const exclude = [spec.seller, spec.decliner].filter((x) => x !== null && x !== undefined);
  const from = spec.seller ?? spec.decliner ?? st.cur;
  const order = [];
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (!st.players[j].bankrupt && !exclude.includes(j)) order.push(j);
  }
  st.stack.push({
    type: 'auction', id: st.nextId++, kind: spec.kind, c: spec.c ?? null, land: spec.land ?? null,
    seller: spec.seller ?? null, decliner: spec.decliner ?? null, reason: spec.reason,
    start, high: null, leader: null, order, active: [...order], pid: order[0] ?? null,
  });
}

export function minBid(a) { return a.leader === null ? a.start : a.high + CONST.MIN_BID_STEP; }

function nextBidder(st, a, after) {
  const cands = a.order.filter((id) => a.active.includes(id) && id !== a.leader);
  if (!cands.length) return null;
  const pos = a.order.indexOf(after);
  for (let k = 1; k <= a.order.length; k++) {
    const id = a.order[(pos + k) % a.order.length];
    if (cands.includes(id)) return id;
  }
  return cands[0];
}

function auctionTick(st, a) {
  const min = minBid(a);
  const before = a.active.length;
  a.active = a.active.filter((id) => !st.players[id].bankrupt && (id === a.leader || st.players[id].cash >= min));
  const contenders = a.active.filter((id) => id !== a.leader);
  if (!contenders.length) { finishAuction(st, a); return true; }
  if (!contenders.includes(a.pid)) { a.pid = nextBidder(st, a, a.pid ?? a.order[0]); return true; }
  return a.active.length !== before;
}

function lotName(a) {
  return a.kind === 'share' ? `акция «${COMPANIES[a.c].name}»` : `участок №${a.land}`;
}

function finishAuction(st, a) {
  removePrompt(st, a);
  ev(st, 'auctionEnd', { kind: a.kind, c: a.c, land: a.land, leader: a.leader, price: a.high });
  if (a.kind === 'share') {
    const sh = st.shares[a.c];
    const idx = sh.indexOf(a.seller);
    if (idx < 0) { log(st, 'Аукцион отменён: акции у продавца больше нет.', 'info'); return; }
    if (a.leader !== null) {
      const price = a.high, comm = R100(price * CONST.TRADE_COMMISSION);
      const items = [{ to: a.seller, amount: price - comm }, ...incomeItems(st, 'exchange', comm)];
      sh[idx] = a.leader;
      log(st, `Аукцион: ${lotName(a)} продана игроку ${nm(st, a.leader)} за ${fmt(price)}. Продавцу ${fmt(price - comm)}, биржа ${fmt(comm)}.`, 'sell', a.leader);
      charge(st, a.leader, items, 'покупка на аукционе');
    } else {
      const price = a.start, comm = R100(price * CONST.TRADE_COMMISSION);
      st.players[a.seller].cash += price - comm;
      payout(st, incomeItems(st, 'exchange', comm));
      sh[idx] = null;
      log(st, `Аукцион: ${lotName(a)} никто не купил — её выкупает Банк по номиналу. ${nm(st, a.seller)} получает ${fmt(price - comm)}.`, 'sell', a.seller);
    }
    ev(st, 'share', { c: a.c });
    return;
  }
  const L = landOf(st, a.land);
  if (a.seller !== null) {
    if (L.owner !== a.seller) { log(st, 'Аукцион отменён: участок больше не принадлежит продавцу.', 'info'); return; }
    if (a.leader !== null) {
      const price = a.high, comm = R100(price * CONST.TRADE_COMMISSION);
      L.owner = a.leader;
      log(st, `Аукцион: участок №${a.land} продан игроку ${nm(st, a.leader)} за ${fmt(price)}. Продавцу ${fmt(price - comm)}.`, 'sell', a.leader);
      charge(st, a.leader, [{ to: a.seller, amount: price - comm }, ...incomeItems(st, 'realty', comm)], 'покупка на аукционе');
    } else {
      const price = a.start, comm = R100(price * CONST.TRADE_COMMISSION);
      st.players[a.seller].cash += price - comm;
      payout(st, incomeItems(st, 'realty', comm));
      L.owner = null;
      log(st, `Аукцион: участок №${a.land} никто не купил — его выкупает Банк. ${nm(st, a.seller)} получает ${fmt(price - comm)}.`, 'sell', a.seller);
    }
  } else {
    if (L.owner !== null) return;
    if (a.leader !== null) {
      const price = a.high, comm = R100(price * CONST.TRADE_COMMISSION);
      L.owner = a.leader;
      log(st, `Аукцион: участок №${a.land} достаётся игроку ${nm(st, a.leader)} за ${fmt(price)}.`, 'buy', a.leader);
      charge(st, a.leader, [{ to: 'bank', amount: price - comm }, ...incomeItems(st, 'realty', comm)], 'покупка на аукционе');
    } else {
      const fee = R100(LAND_BY_NO[a.land].price * CONST.TRADE_COMMISSION);
      const items = incomeItems(st, 'realty', fee);
      log(st, `Аукцион: участок №${a.land} никто не купил. ${nm(st, a.decliner)} платит 20% комиссионных (${fmt(fee)}) агентству недвижимости.`, 'money', a.decliner);
      if (a.decliner !== null && !st.players[a.decliner].bankrupt) charge(st, a.decliner, items, 'комиссия за отказ от участка');
    }
  }
  ev(st, 'land', { land: a.land });
}

// ───────────────────────── комиссионные и переговоры по кредиту ─────────────────────────

function commissionTick(st, pr) {
  pr.holders = pr.holders.filter((h) => !st.players[h].bankrupt);
  if (!pr.holders.length) {
    // акционеров не осталось — покупка по номиналу
    removePrompt(st, pr);
    const L = landOf(st, pr.land);
    const p = st.players[pr.buyer];
    if (L.owner === pr.buyer && L.ent.lic && !L.ent[pr.comp] && p.cash >= pr.nominal && st.stock[pr.comp] > 0) {
      p.cash -= pr.nominal;
      placeComp(st, pr.buyer, L, pr.comp);
    }
    return true;
  }
  let want;
  if (pr.stage === 'ask') want = pr.holders.find((h) => !(h in pr.asks));
  else if (pr.stage === 'lower') want = pr.holders.find((h) => !pr.lowerDone.includes(h));
  if (pr.stage === 'ask' || pr.stage === 'lower') {
    if (want === undefined) { pr.stage = 'decide'; pr.pid = pr.buyer; return true; }
    if (pr.pid !== want) { pr.pid = want; return true; }
  }
  return false;
}

function creditTick(st, pr) {
  pr.holders = pr.holders.filter((h) => !st.players[h].bankrupt);
  if (!pr.holders.length || !st.stock.credits.length) {
    removePrompt(st, pr);
    if (st.stock.credits.length) giveCredit(st, pr.borrower, Math.min(...st.stock.credits));
    return true;
  }
  if (pr.stage === 'ask') {
    const want = pr.holders.find((h) => !(h in pr.asks));
    if (want === undefined) { pr.stage = 'decide'; pr.pid = pr.borrower; return true; }
    if (pr.pid !== want) { pr.pid = want; return true; }
  }
  return false;
}
// Итоговый процент кредита при переговорах — наибольший из названных акционерами
export function creditOffered(st, pr) {
  const rates = Object.values(pr.asks);
  if (!st.stock.credits.length) return null;
  const want = rates.length ? Math.max(...rates) : Math.min(...st.stock.credits);
  if (st.stock.credits.includes(want)) return want;
  const higher = st.stock.credits.filter((r) => r >= want);
  return higher.length ? Math.min(...higher) : Math.max(...st.stock.credits);
}

// ───────────────────────── банкротство и конец игры ─────────────────────────

function goBankrupt(st, pid) {
  const p = st.players[pid];
  for (const d of p.debts) {
    const amt = Math.min(d.amount, p.cash);
    if (amt > 0) moveMoney(st, pid, { to: d.to, amount: amt });
  }
  p.debts = [];
  p.cash = 0;
  for (const k of COMPANY_KEYS) st.shares[k] = st.shares[k].map((o) => (o === pid ? null : o));
  for (const L of st.lands) if (L.owner === pid) { clearEnt(st, L); L.owner = null; }
  st.stock.credits.push(...p.credits);
  p.credits = [];
  st.stock.ins += p.insurance;
  p.insurance = 0;
  for (const l of st.loans) if (l.lender === pid) st.players[l.borrower].notes++;
  st.loans = st.loans.filter((l) => l.lender !== pid && l.borrower !== pid);
  st.offers = st.offers.filter((o) => o.from !== pid && o.to !== pid);
  p.bankrupt = true;
  st.stack = st.stack.filter((pr) => {
    if (['debt', 'ownerDeal', 'antimono'].includes(pr.type) && pr.pid === pid) return false;
    if (pr.type === 'commission' && pr.buyer === pid) return false;
    if (pr.type === 'creditNeg' && pr.borrower === pid) return false;
    if (pr.type === 'auction' && (pr.seller === pid)) return false;
    return true;
  });
  for (const pr of st.stack) {
    if (pr.type === 'auction') {
      pr.active = pr.active.filter((x) => x !== pid);
      if (pr.leader === pid) { pr.leader = null; pr.high = null; }
      if (pr.decliner === pid) pr.decliner = null;
    }
  }
  log(st, `💥 ${p.name} становится банкротом и выбывает из игры. Его имущество возвращается в Банк.`, 'big', pid);
  ev(st, 'bankrupt', { pid });
}

function finishGame(st, winnerPid) {
  if (st.over) return;
  st.over = true;
  st.stack = [];
  st.offers = [];
  if (winnerPid !== null && winnerPid !== undefined) {
    st.players[winnerPid].cash += CONST.FINISH_BONUS;
    log(st, `🏁 ${nm(st, winnerPid)} вводит ${plural(st.players[winnerPid].done.length, 'предприятие', 'предприятия', 'предприятий')} — игра окончена! Премия ${fmt(CONST.FINISH_BONUS)}.`, 'big', winnerPid);
  } else log(st, '🏁 Игра окончена.', 'big');
  if (st.pool > 0) {
    const items = incomeItems(st, 'insure', st.pool);
    payout(st, items);
    log(st, `Страховой фонд ${fmt(st.pool)} выплачен акционерам Страховой компании: ${itemsText(st, items)}`, 'money');
    st.pool = 0;
  }
  const alive = st.players.filter((p) => !p.bankrupt);
  // Погашение кредитов и векселей
  const settle = (p, items, what) => {
    const total = sum(items.filter((i) => i.to !== p.id).map((i) => i.amount));
    if (p.cash < total) liquidate(st, p, total);
    for (const it of items) {
      if (it.to === p.id) continue;
      const amt = Math.min(it.amount, Math.max(0, p.cash));
      if (amt > 0) moveMoney(st, p.id, { to: it.to, amount: amt });
    }
    log(st, `${p.name} погашает ${what}: ${fmt(total)}`, 'money', p.id);
  };
  for (const p of alive) {
    for (const r of p.credits) {
      const interest = R100(CONST.CREDIT_AMOUNT * r / 100);
      settle(p, [{ to: 'bank', amount: CONST.CREDIT_AMOUNT }, ...incomeItems(st, 'bank', interest)], `кредит под ${r}%`);
      st.stock.credits.push(r);
    }
    p.credits = [];
  }
  for (const l of st.loans) {
    const b = st.players[l.borrower];
    if (b.bankrupt) continue;
    settle(b, [{ to: l.lender, amount: loanTotal(l) }], `заём у ${nm(st, l.lender)}`);
  }
  st.loans = [];
  for (const p of alive) {
    if (p.debts.length) {
      for (const d of p.debts) {
        const amt = Math.min(d.amount, p.cash);
        if (amt > 0) moveMoney(st, p.id, { to: d.to, amount: amt });
      }
      p.debts = [];
    }
  }
  const result = st.players.map((p) => {
    const sharesValue = sum(COMPANY_KEYS.map((k) => shareCount(st, k, p.id) * COMPANIES[k].price));
    const landValue = sum(ownedLands(st, p.id).map((l) => LAND_BY_NO[l.no].price));
    return { pid: p.id, cash: p.cash, sharesValue, landValue, capital: p.bankrupt ? 0 : p.cash + sharesValue + landValue, done: p.done.length, bankrupt: p.bankrupt };
  }).sort((a, b) => b.capital - a.capital);
  st.result = result;
  log(st, `🏆 Победитель — ${nm(st, result[0].pid)} с капиталом ${fmt(result[0].capital)}!`, 'big', result[0].pid);
  ev(st, 'gameover', { winner: result[0].pid });
}

// Сдача имущества в банк по номиналу, пока не хватит денег
function liquidate(st, p, need) {
  const assets = [];
  for (const k of COMPANY_KEYS) for (let i = 0; i < 3; i++) if (st.shares[k][i] === p.id) assets.push({ kind: 'share', k, i, v: COMPANIES[k].price });
  for (const L of st.lands) if (L.owner === p.id) assets.push({ kind: 'land', L, v: LAND_BY_NO[L.no].price });
  assets.sort((a, b) => a.v - b.v);
  for (const a of assets) {
    if (p.cash >= need) break;
    if (a.kind === 'share') st.shares[a.k][a.i] = null;
    else { clearEnt(st, a.L); a.L.owner = null; }
    p.cash += a.v;
    log(st, `${p.name} сдаёт в банк по номиналу ${a.kind === 'share' ? 'акцию «' + COMPANIES[a.k].name + '»' : 'участок №' + a.L.no} (${fmt(a.v)})`, 'sell', p.id);
  }
}

export function loanTotal(l) { return R100(l.amount * (1 + l.rate / 100)); }

// ───────────────────────── нормализация после каждого действия ─────────────────────────

function normalize(st) {
  for (let guard = 0; guard < 500; guard++) {
    if (st.over) return;
    let changed = false;
    // 1. погашение долгов, если хватает денег
    for (const p of st.players) {
      if (p.bankrupt || !p.debts.length) continue;
      const total = debtTotal(p);
      if (p.cash >= total) {
        for (const d of p.debts) moveMoney(st, p.id, d);
        log(st, `${p.name} погашает задолженность ${fmt(total)}. Финансовая необеспеченность снята.`, 'money', p.id);
        p.debts = [];
        changed = true;
      }
    }
    // 2. запросы на погашение долга
    const before = st.stack.length;
    st.stack = st.stack.filter((pr) => !(pr.type === 'debt' && (st.players[pr.pid].bankrupt || !st.players[pr.pid].debts.length)));
    if (st.stack.length !== before) changed = true;
    for (const p of st.players) {
      if (!p.bankrupt && p.debts.length && !st.stack.some((pr) => pr.type === 'debt' && pr.pid === p.id)) {
        st.stack.push({ type: 'debt', pid: p.id, id: st.nextId++ });
        changed = true;
      }
    }
    // 3. обработка верхнего запроса
    const top = st.stack[st.stack.length - 1];
    if (top) {
      if (top.type === 'auction' && auctionTick(st, top)) changed = true;
      else if (top.type === 'commission' && commissionTick(st, top)) changed = true;
      else if (top.type === 'creditNeg' && creditTick(st, top)) changed = true;
      else if (top.type === 'ownerDeal' && st.players[top.pid].bankrupt) { removePrompt(st, top); changed = true; }
    }
    // 4. конец игры, если остался один игрок
    const alive = st.players.filter((p) => !p.bankrupt);
    if (alive.length <= 1) { finishGame(st, null); return; }
    // 5. переход хода
    if (!st.stack.length && (st.players[st.cur].bankrupt || st.turn.lost)) {
      if (st.turn.lost && !st.players[st.cur].bankrupt) log(st, `${nm(st, st.cur)} теряет остаток хода.`, 'info', st.cur);
      nextTurn(st);
      changed = true;
    }
    if (!changed) return;
  }
}

// ───────────────────────── обработчики запросов ─────────────────────────

const HANDLERS = {
  turn: {
    roll(st, pid) {
      if (st.turn.phase !== 'pre') fail('Кубики уже брошены');
      st.turn.phase = 'moving';
      doRoll(st, pid);
    },
    credit(st, pid) {
      if (st.turn.phase !== 'pre') fail('Кредит берут до броска кубиков');
      takeCredit(st, pid, false);
    },
    insure(st, pid) {
      const why = insureBlock(st, pid);
      if (why) fail(why);
      const p = st.players[pid];
      p.cash -= CONST.INSURANCE_PRICE;
      st.pool += CONST.INSURANCE_PRICE;
      p.insurance++;
      st.stock.ins--;
      log(st, `${p.name} покупает страховое свидетельство за ${fmt(CONST.INSURANCE_PRICE)} (всего ${p.insurance})`, 'buy', pid);
    },
    skip(st, pid) {
      if (st.turn.phase !== 'cell') fail('Нечего пропускать');
      const spec = cellSpec(st, pid);
      st.turn.phase = 'post';
      if (spec.declineLand) declineLand(st, pid, spec.buyLand);
    },
    endTurn(st, pid) {
      if (st.turn.phase === 'pre') fail('Сначала бросьте кубики');
      if (st.turn.phase === 'cell' && cellSpec(st, pid).declineLand) fail('Сначала решите: купить участок или отказаться');
      nextTurn(st);
    },
    _deal(st, pid, a) {
      if (st.turn.phase !== 'cell') fail('Сейчас нельзя совершать сделку');
      const spec = cellSpec(st, pid);
      const cell = BOARD[st.players[pid].pos];
      st.turn.phase = 'post';
      execDeal(st, pid, a, spec, 'cell');
      if (cell.type === 'company' && cell.company === 'bank' && (a.t === 'buyShare' || a.t === 'bankCredit')) {
        st.turn.acts.push(a.t);
        const rest = cellSpec(st, pid);
        const canMore = (rest.bankCredit && !creditBlock(st, pid, true)) || (rest.buy && st.shares.bank.includes(null));
        if (canMore && !st.stack.length) st.turn.phase = 'cell';
      }
    },
  },
  ownerDeal: {
    skip(st, pid, a, pr) { removePrompt(st, pr); log(st, `${nm(st, pid)} не совершает сделку.`, 'info', pid); },
    _deal(st, pid, a, pr) { removePrompt(st, pr); execDeal(st, pid, a, dealSpec(), 'owner'); },
  },
  debt: {
    sellShare(st, pid, a) { startShareSale(st, pid, a.c); },
    sellLand(st, pid, a) { startLandSale(st, pid, a.land); },
    bankrupt(st, pid) { goBankrupt(st, pid); },
  },
  antimono: {
    chooseMono(st, pid, a, pr) {
      if (!pr.options.includes(a.c)) fail('Выберите компанию, где вы монополист');
      removePrompt(st, pr);
      startAntimono(st, pid, a.c);
    },
  },
  auction: {
    bid(st, pid, a, pr) {
      const amount = Math.round(+a.amount);
      if (!Number.isFinite(amount) || amount % 100) fail('Ставка должна быть кратна 100');
      if (amount < minBid(pr)) fail(`Минимальная ставка ${fmt(minBid(pr))}`);
      if (amount > st.players[pid].cash) fail('Ставка больше ваших денег');
      pr.high = amount;
      pr.leader = pid;
      log(st, `${nm(st, pid)}: ставка ${fmt(amount)} за ${lotName(pr)}`, 'bid', pid);
      pr.pid = nextBidder(st, pr, pid);
    },
    pass(st, pid, a, pr) {
      pr.active = pr.active.filter((x) => x !== pid);
      log(st, `${nm(st, pid)}: пас`, 'bid', pid);
      pr.pid = nextBidder(st, pr, pid);
    },
  },
  commission: {
    ask(st, pid, a, pr) {
      const amount = Math.round(+a.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount % 100) fail('Сумма должна быть неотрицательной и кратной 100');
      if (amount > CONST.MAX_ASK) fail('Слишком большая сумма');
      if (pr.stage === 'ask') {
        pr.asks[pid] = amount;
        log(st, `${nm(st, pid)} просит комиссионные ${fmt(amount)}`, 'bid', pid);
      } else if (pr.stage === 'lower') {
        if (amount > pr.asks[pid]) fail('Нельзя повышать комиссионные');
        pr.asks[pid] = amount;
        pr.lowerDone.push(pid);
        log(st, `${nm(st, pid)}: комиссионные ${fmt(amount)}`, 'bid', pid);
      } else fail('Сейчас решает покупатель');
    },
    accept(st, pid, a, pr) {
      if (pr.stage !== 'decide') fail('Акционеры ещё не назвали комиссионные');
      const L = landOf(st, pr.land);
      if (L.owner !== pid || !L.ent.lic || L.ent[pr.comp]) fail('Покупка больше невозможна');
      if (st.stock[pr.comp] <= 0) fail('В банке закончились такие карты');
      const items = [{ to: 'bank', amount: pr.nominal }, ...pr.holders.map((h) => ({ to: h, amount: pr.asks[h] || 0 }))];
      spend(st, pid, items, 'покупка карты');
      removePrompt(st, pr);
      const comm = sum(pr.holders.map((h) => pr.asks[h] || 0));
      log(st, `${nm(st, pid)} соглашается и покупает «${COMPONENTS[pr.comp].name}»: ${fmt(pr.nominal)} в банк + ${fmt(comm)} комиссионных`, 'buy', pid);
      placeComp(st, pid, L, pr.comp);
    },
    lower(st, pid, a, pr) {
      if (pr.stage !== 'decide') fail('Сейчас нельзя');
      if (pr.lowered) fail('Снизить можно попросить только один раз');
      pr.lowered = true;
      pr.stage = 'lower';
      pr.lowerDone = [];
      log(st, `${nm(st, pid)} просит акционеров снизить комиссионные.`, 'info', pid);
    },
    refuse(st, pid, a, pr) {
      if (pr.stage !== 'decide') fail('Сейчас нельзя');
      removePrompt(st, pr);
      log(st, `${nm(st, pid)} отказывается от покупки. Акционеры платят штраф в размере запрошенных комиссионных.`, 'warn', pid);
      for (const h of pr.holders) {
        const fine = pr.asks[h] || 0;
        if (fine > 0) charge(st, h, [{ to: 'bank', amount: fine }], 'штраф за завышенные комиссионные');
      }
      if (pr.ctx === 'cell' && st.cur === pid) st.turn.lost = true;
    },
  },
  creditNeg: {
    rate(st, pid, a, pr) {
      if (pr.stage !== 'ask') fail('Сейчас решает заёмщик');
      const r = +a.rate;
      if (!st.stock.credits.includes(r)) fail('Выберите процент из имеющихся кредитов');
      pr.asks[pid] = r;
      log(st, `${nm(st, pid)} предлагает кредит под ${r}%`, 'bid', pid);
    },
    accept(st, pid, a, pr) {
      if (pr.stage !== 'decide') fail('Акционеры ещё не назвали процент');
      removePrompt(st, pr);
      giveCredit(st, pid, creditOffered(st, pr));
    },
    refuse(st, pid, a, pr) {
      if (pr.stage !== 'decide') fail('Сейчас нельзя');
      removePrompt(st, pr);
      log(st, `${nm(st, pid)} отказывается от кредита.`, 'info', pid);
    },
  },
};
for (const t of ['buyShare', 'sellShare', 'buyLicense', 'buyComp', 'sellLand', 'buyLand', 'declineLand', 'bankCredit']) {
  HANDLERS.turn[t] = HANDLERS.turn._deal;
  HANDLERS.ownerDeal[t] = HANDLERS.ownerDeal._deal;
}

// Действия, доступные в любой момент (не зависят от очереди)
const GLOBAL = {
  repayCredit(st, pid, a) {
    const p = st.players[pid];
    const i = +a.i;
    if (!(i >= 0 && i < p.credits.length)) fail('Нет такого кредита');
    const r = p.credits[i];
    const interest = R100(CONST.CREDIT_AMOUNT * r / 100);
    spend(st, pid, [{ to: 'bank', amount: CONST.CREDIT_AMOUNT }, ...incomeItems(st, 'bank', interest)], 'погашение кредита');
    p.credits.splice(i, 1);
    st.stock.credits.push(r);
    log(st, `${p.name} погашает кредит ${fmt(CONST.CREDIT_AMOUNT)} + ${r}% (${fmt(interest)})`, 'money', pid);
  },
  offerLoan(st, pid, a) {
    const to = +a.to;
    const other = st.players[to];
    if (!other || other.bankrupt || to === pid) fail('Выберите другого игрока');
    const amount = Math.round(+a.amount), rate = Math.round(+a.rate), term = Math.round(+a.term);
    if (!(amount >= 1000 && amount % 100 === 0 && amount <= 5000000)) fail('Сумма займа от 1 000, кратно 100');
    if (!(rate >= 0 && rate <= 200)) fail('Процент от 0 до 200');
    if (!(term >= 1 && term <= 30)) fail('Срок от 1 до 30 кругов');
    const lend = a.role === 'lend';
    const lender = lend ? pid : to, borrower = lend ? to : pid;
    if (st.players[borrower].notes <= 0) fail('У заёмщика не осталось векселей');
    if (lend && st.players[pid].cash < amount) fail('У вас нет такой суммы');
    if (st.offers.filter((o) => o.from === pid).length >= 3) fail('Не больше 3 предложений одновременно');
    const o = { id: st.nextId++, from: pid, to, lender, borrower, amount, rate, term };
    st.offers.push(o);
    log(st, `${nm(st, pid)} ${lend ? 'предлагает заём' : 'просит заём у'} ${nm(st, to)}: ${fmt(amount)} под ${rate}% на ${plural(term, 'круг', 'круга', 'кругов')}`, 'info', pid);
    ev(st, 'offer', { id: o.id, to });
  },
  acceptOffer(st, pid, a) {
    const o = st.offers.find((x) => x.id === +a.id);
    if (!o || o.to !== pid) fail('Предложение не найдено');
    const L = st.players[o.lender], B = st.players[o.borrower];
    if (L.bankrupt || B.bankrupt) fail('Игрок выбыл');
    if (B.notes <= 0) fail('У заёмщика нет векселей');
    if (L.cash < o.amount) fail('У заимодавца не хватает денег');
    st.offers = st.offers.filter((x) => x !== o);
    L.cash -= o.amount;
    B.cash += o.amount;
    B.notes--;
    const loan = { id: st.nextId++, lender: o.lender, borrower: o.borrower, amount: o.amount, rate: o.rate, due: st.round + o.term, since: st.round };
    st.loans.push(loan);
    log(st, `📝 ${B.name} берёт у ${L.name} заём ${fmt(o.amount)} под вексель (${o.rate}%, вернуть ${fmt(loanTotal(loan))} к ${loan.due}-му кругу)`, 'money', o.borrower);
    ev(st, 'money', { pid: o.borrower, delta: o.amount });
  },
  declineOffer(st, pid, a) {
    const o = st.offers.find((x) => x.id === +a.id);
    if (!o || o.to !== pid) fail('Предложение не найдено');
    st.offers = st.offers.filter((x) => x !== o);
    log(st, `${nm(st, pid)} отклоняет предложение займа.`, 'info', pid);
  },
  cancelOffer(st, pid, a) {
    const o = st.offers.find((x) => x.id === +a.id);
    if (!o || o.from !== pid) fail('Предложение не найдено');
    st.offers = st.offers.filter((x) => x !== o);
  },
  repayLoan(st, pid, a) {
    const l = st.loans.find((x) => x.id === +a.id);
    if (!l || l.borrower !== pid) fail('Заём не найден');
    const total = loanTotal(l);
    spend(st, pid, [{ to: l.lender, amount: total }], 'погашение векселя');
    st.loans = st.loans.filter((x) => x !== l);
    st.players[pid].notes++;
    log(st, `${nm(st, pid)} возвращает ${nm(st, l.lender)} заём по векселю: ${fmt(total)}`, 'money', pid);
  },
  demandLoan(st, pid, a) {
    const l = st.loans.find((x) => x.id === +a.id);
    if (!l || l.lender !== pid) fail('Заём не найден');
    if (st.round < l.due) fail(`Срок займа наступает на ${l.due}-м круге`);
    st.loans = st.loans.filter((x) => x !== l);
    st.players[l.borrower].notes++;
    log(st, `${nm(st, pid)} требует вернуть заём: ${nm(st, l.borrower)} платит ${fmt(loanTotal(l))}`, 'warn', pid);
    charge(st, l.borrower, [{ to: pid, amount: loanTotal(l) }], 'возврат векселя');
  },
};

// ───────────────────────── доступные действия (для интерфейса и ботов) ─────────────────────────

const ok = (o) => ({ ...o, ok: true });
const no = (o, why) => ({ ...o, ok: false, why });

function dealOptions(st, pid, spec) {
  const p = st.players[pid];
  const out = [];
  const debts = p.debts.length > 0;
  if (spec.buy) {
    const list = spec.buy === 'any' ? COMPANY_KEYS : [spec.buy];
    for (const c of list) {
      const price = COMPANIES[c].price;
      const o = { t: 'buyShare', c, cost: price };
      if (!st.shares[c].includes(null)) out.push(no(o, 'Все акции выкуплены'));
      else if (debts) out.push(no(o, 'Есть долги'));
      else if (p.cash < price) out.push(no(o, 'Не хватает денег'));
      else out.push(ok(o));
    }
  }
  if (spec.sell) {
    const list = spec.sell === 'any' ? COMPANY_KEYS : [spec.sell];
    for (const c of list) {
      const have = shareCount(st, c, pid) - pendingSales(st, pid, 'share', c);
      if (have > 0) out.push(ok({ t: 'sellShare', c, cost: COMPANIES[c].price }));
    }
  }
  if (spec.license) {
    for (const L of ownedLands(st, pid)) {
      if (L.ent.lic || pendingSales(st, pid, 'land', L.no)) continue;
      for (const ind of INDUSTRIES) {
        const o = { t: 'buyLicense', ind: ind.id, land: L.no, cost: CONST.LICENSE_PRICE };
        if (st.stock.lic[ind.id] <= 0) out.push(no(o, 'Лицензии закончились'));
        else if (debts) out.push(no(o, 'Есть долги'));
        else if (p.cash < CONST.LICENSE_PRICE) out.push(no(o, 'Не хватает денег'));
        else out.push(ok(o));
      }
    }
  }
  if (spec.comps) {
    for (const L of ownedLands(st, pid)) {
      if (!L.ent.lic || pendingSales(st, pid, 'land', L.no)) continue;
      for (const comp of spec.comps) {
        if (L.ent[comp]) continue;
        const price = INDUSTRY[L.ent.lic][comp];
        const company = COMPONENTS[comp].company;
        const o = { t: 'buyComp', comp, land: L.no, cost: price, nego: !nominalCase(st, pid, company) };
        if (st.stock[comp] <= 0) out.push(no(o, 'Карты закончились'));
        else if (debts) out.push(no(o, 'Есть долги'));
        else if (p.cash < price) out.push(no(o, 'Не хватает денег'));
        else out.push(ok(o));
      }
    }
  }
  if (spec.sellLand) {
    for (const L of ownedLands(st, pid)) if (!pendingSales(st, pid, 'land', L.no)) out.push(ok({ t: 'sellLand', land: L.no, cost: LAND_BY_NO[L.no].price, hasEnt: !!L.ent.lic }));
  }
  if (spec.buyLand != null) {
    const list = spec.buyLand === 'any' ? st.lands.filter((l) => l.owner === null).map((l) => l.no) : [spec.buyLand];
    for (const no2 of list) {
      const price = LAND_BY_NO[no2].price;
      const o = { t: 'buyLand', land: no2, cost: price };
      if (landOf(st, no2).owner !== null) continue;
      if (debts) out.push(no(o, 'Есть долги'));
      else if (p.cash < price) out.push(no(o, 'Не хватает денег'));
      else out.push(ok(o));
    }
  }
  if (spec.declineLand) out.push(ok({ t: 'declineLand', land: spec.buyLand }));
  if (spec.bankCredit) {
    const why = creditBlock(st, pid, true);
    const o = { t: 'bankCredit', rate: st.stock.credits.length ? Math.min(...st.stock.credits) : null };
    out.push(why ? no(o, why) : ok(o));
  }
  return out;
}

// Возвращает список конкретных действий для игрока pid в текущем запросе
export function options(st, pid) {
  const pr = activePrompt(st);
  if (st.over || pr.pid !== pid) return [];
  const p = st.players[pid];
  const out = [];
  switch (pr.type) {
    case 'turn': {
      if (st.turn.phase === 'pre') {
        out.push(ok({ t: 'roll' }));
        const cw = creditBlock(st, pid, false);
        const nominal = nominalCase(st, pid, 'bank');
        const co = { t: 'credit', nego: !nominal, rate: st.stock.credits.length ? Math.min(...st.stock.credits) : null };
        out.push(cw ? no(co, cw) : ok(co));
        const iw = insureBlock(st, pid);
        out.push(iw ? no({ t: 'insure', cost: CONST.INSURANCE_PRICE }, iw) : ok({ t: 'insure', cost: CONST.INSURANCE_PRICE }));
      } else if (st.turn.phase === 'cell') {
        const spec = cellSpec(st, pid);
        out.push(...dealOptions(st, pid, spec));
        if (spec.declineLand) { /* отказ = аукцион, отдельной кнопкой */ } else out.push(ok({ t: 'skip' }));
      } else if (st.turn.phase === 'post') {
        out.push(ok({ t: 'endTurn' }));
      }
      break;
    }
    case 'ownerDeal':
      out.push(...dealOptions(st, pid, dealSpec()));
      out.push(ok({ t: 'skip' }));
      break;
    case 'debt':
      for (const { c } of playerShares(st, pid)) {
        if (shareCount(st, c, pid) - pendingSales(st, pid, 'share', c) > 0) out.push(ok({ t: 'sellShare', c, cost: COMPANIES[c].price }));
      }
      for (const L of ownedLands(st, pid)) if (!pendingSales(st, pid, 'land', L.no)) out.push(ok({ t: 'sellLand', land: L.no, cost: LAND_BY_NO[L.no].price, hasEnt: !!L.ent.lic }));
      out.push(ok({ t: 'bankrupt' }));
      break;
    case 'antimono':
      for (const c of pr.options) out.push(ok({ t: 'chooseMono', c }));
      break;
    case 'auction': {
      const min = minBid(pr);
      out.push(p.cash >= min ? ok({ t: 'bid', amount: min, min, max: p.cash }) : no({ t: 'bid', amount: min }, 'Не хватает денег'));
      out.push(ok({ t: 'pass' }));
      break;
    }
    case 'commission':
      if (pr.stage === 'ask') out.push(ok({ t: 'ask', amount: R100(pr.nominal * 0.1), max: CONST.MAX_ASK }));
      else if (pr.stage === 'lower') out.push(ok({ t: 'ask', amount: pr.asks[pid] || 0, max: pr.asks[pid] || 0 }));
      else if (pr.stage === 'decide') {
        const total = pr.nominal + sum(pr.holders.map((h) => pr.asks[h] || 0));
        out.push(p.cash >= total ? ok({ t: 'accept', cost: total }) : no({ t: 'accept', cost: total }, 'Не хватает денег'));
        if (!pr.lowered) out.push(ok({ t: 'lower' }));
        out.push(ok({ t: 'refuse' }));
      }
      break;
    case 'creditNeg':
      if (pr.stage === 'ask') for (const r of [...new Set(st.stock.credits)].sort((a, b) => a - b)) out.push(ok({ t: 'rate', rate: r }));
      else {
        out.push(ok({ t: 'accept', rate: creditOffered(st, pr) }));
        out.push(ok({ t: 'refuse' }));
      }
      break;
  }
  return out;
}

// Глобальные действия игрока (погашение кредитов, займы)
export function globalOptions(st, pid) {
  const p = st.players[pid];
  if (st.over || !p || p.bankrupt) return [];
  const out = [];
  p.credits.forEach((r, i) => {
    const cost = CONST.CREDIT_AMOUNT + R100(CONST.CREDIT_AMOUNT * r / 100);
    const o = { t: 'repayCredit', i, rate: r, cost };
    out.push(p.debts.length ? no(o, 'Есть долги') : p.cash >= cost ? ok(o) : no(o, 'Не хватает денег'));
  });
  for (const l of st.loans) {
    if (l.borrower === pid) {
      const o = { t: 'repayLoan', id: l.id, cost: loanTotal(l), loan: l };
      out.push(p.debts.length ? no(o, 'Есть долги') : p.cash >= o.cost ? ok(o) : no(o, 'Не хватает денег'));
    }
    if (l.lender === pid) {
      const o = { t: 'demandLoan', id: l.id, loan: l };
      out.push(st.round >= l.due ? ok(o) : no(o, `Срок — ${l.due}-й круг`));
    }
  }
  for (const o of st.offers) {
    if (o.to === pid) { out.push(ok({ t: 'acceptOffer', id: o.id, offer: o })); out.push(ok({ t: 'declineOffer', id: o.id, offer: o })); }
    if (o.from === pid) out.push(ok({ t: 'cancelOffer', id: o.id, offer: o }));
  }
  return out;
}

// Чей сейчас ход / чьё решение ожидается
export function waitingFor(st) {
  const pr = activePrompt(st);
  return pr.pid;
}

export function playerCapital(st, pid) {
  const p = st.players[pid];
  return p.cash + taxBase(st, pid);
}

export { R100, cellTitle };
