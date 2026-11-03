// Точечные проверки правил.
import assert from 'node:assert/strict';
import { createGame, dispatch, activePrompt, setRandom, incomeItems, nominalCase } from '../src/engine/engine.js';
import { CONST, COMPANIES, INDUSTRY, LAND_BY_NO, LAND_CELL, SURPRISES } from '../src/engine/data.js';

let seed = 7;
setRandom(() => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; });
const base = () => {
  const st = createGame({ players: [{ name: 'A', color: 'red' }, { name: 'B', color: 'blue' }, { name: 'C', color: 'green' }], target: 3 });
  st.cur = 0; st.first = 0; st.turn.phase = 'pre';
  return st;
};
const ok = (r) => { assert.ok(r.ok, r.error); return r.state; };
const err = (r) => { assert.ok(r.error, 'expected error'); };
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✓', name); };

test('покупка акции: 20% акционерам биржи', () => {
  let st = base();
  st.shares.exchange = [1, null, null];
  st.turn.phase = 'cell'; st.players[0].pos = 12; // биржа
  st = ok(dispatch(st, 0, { t: 'buyShare', c: 'bank' }));
  assert.equal(st.players[0].cash, CONST.START_CASH - COMPANIES.bank.price);
  assert.equal(st.players[1].cash, CONST.START_CASH + COMPANIES.bank.price * 0.2);
  assert.equal(st.shares.bank[0], 0);
});

test('номинальная цена без переговоров', () => {
  const st = base();
  st.shares.trade = [0, 0, 1];
  assert.equal(nominalCase(st, 0, 'trade'), true);
  assert.equal(nominalCase(st, 1, 'trade'), false);
  st.shares.trade = [1, null, null];
  assert.equal(nominalCase(st, 1, 'trade'), true);
  assert.equal(nominalCase(st, 2, 'trade'), false);
});

test('доход делится по числу акций', () => {
  const st = base();
  st.shares.consult = [0, 0, 1];
  const it = incomeItems(st, 'consult', 30000);
  assert.deepEqual(it.sort((a, b) => a.to - b.to), [{ to: 0, amount: 20000 }, { to: 1, amount: 10000 }]);
  st.shares.consult = [null, null, null];
  assert.deepEqual(incomeItems(st, 'consult', 30000), [{ to: 'bank', amount: 30000 }]);
});

test('ввод предприятия: выручка + половина цены участка', () => {
  let st = base();
  const L = st.lands[4]; // участок 5
  L.owner = 0; L.ent = { lic: 'auto', mat: true, eq: true, pers: false };
  st.stock.lic.auto--; st.stock.mat--; st.stock.eq--;
  st.turn.phase = 'cell'; st.players[0].pos = 1; // сделка
  const cash = st.players[0].cash;
  st = ok(dispatch(st, 0, { t: 'buyComp', comp: 'pers', land: 5 }));
  const ind = INDUSTRY.auto;
  assert.equal(st.players[0].cash, cash - ind.pers + ind.product + LAND_BY_NO[5].price / 2);
  assert.deepEqual(st.players[0].done, ['auto']);
  assert.equal(st.lands[4].ent.lic, null);
  assert.equal(st.stock.mat, CONST.COMPONENT_STOCK);
});

test('отказ от комиссионных: штраф акционерам и потеря хода', () => {
  let st = base();
  st.shares.hr = [1, null, null];
  const L = st.lands[0]; L.owner = 0; L.ent = { lic: 'food', mat: false, eq: false, pers: false }; st.stock.lic.food--;
  st.turn.phase = 'cell'; st.players[0].pos = 1;
  st = ok(dispatch(st, 0, { t: 'buyComp', comp: 'pers', land: 1 }));
  assert.equal(activePrompt(st).type, 'commission');
  assert.equal(activePrompt(st).pid, 1);
  st = ok(dispatch(st, 1, { t: 'ask', amount: 15000 }));
  assert.equal(activePrompt(st).pid, 0);
  st = ok(dispatch(st, 0, { t: 'lower' }));
  err(dispatch(st, 1, { t: 'ask', amount: 20000 }));
  st = ok(dispatch(st, 1, { t: 'ask', amount: 12000 }));
  st = ok(dispatch(st, 0, { t: 'refuse' }));
  assert.equal(st.players[1].cash, CONST.START_CASH - 12000);
  assert.equal(st.cur, 1, 'ход перешёл к следующему');
});

test('страховка покрывает убыток', () => {
  let s = base();
  const idx = SURPRISES.findIndex((c) => c.amount === -150000);
  s.decks.surprise = [idx, ...s.decks.surprise.filter((x) => x !== idx)];
  s = ok(dispatch(s, 0, { t: 'insure' }));
  assert.equal(s.pool, CONST.INSURANCE_PRICE);
  s.players[0].pos = 59; // 59 + (1 + 3) → клетка 3 «Деловой случай»
  setRandom((() => { const v = [0.01, 0.4]; let i = 0; return () => v[i++ % 2]; })());
  const before = s.players[0].cash;
  s = ok(dispatch(s, 0, { t: 'roll' }));
  assert.equal(s.players[0].pos, 3);
  // убыток 150 000: одно свидетельство покрывает 100 000, остальные 50 000 — из денег
  assert.equal(s.players[0].cash, before - 50000);
  assert.equal(s.players[0].insurance, 0);
});

test('налог 10% от номинала при проходе инспекции', () => {
  let s = base();
  s.shares.bank = [0, null, null]; s.lands[11].owner = 0; // 50 000 + 130 000
  s.players[0].pos = 57;
  setRandom((() => { const v = [0.01, 0.01]; let i = 0; return () => v[i++ % 2]; })()); // 1+1 → 59
  const before = s.players[0].cash;
  s = ok(dispatch(s, 0, { t: 'roll' }));
  assert.equal(s.players[0].pos, 59);
  assert.equal(s.players[0].cash, before - 18000);
});

test('отказ от участка: аукцион, без покупателя — 20% агентству', () => {
  let s = base();
  s.shares.realty = [2, null, null];
  s.players[0].pos = LAND_CELL[3]; s.turn.phase = 'cell';
  s = ok(dispatch(s, 0, { t: 'declineLand' }));
  let pr = activePrompt(s);
  assert.equal(pr.type, 'auction');
  assert.deepEqual(pr.order, [1, 2]);
  s = ok(dispatch(s, pr.pid, { t: 'pass' }));
  pr = activePrompt(s);
  s = ok(dispatch(s, pr.pid, { t: 'pass' }));
  assert.equal(s.lands[2].owner, null);
  assert.equal(s.players[0].cash, CONST.START_CASH - LAND_BY_NO[3].price * 0.2);
  assert.equal(s.players[2].cash, CONST.START_CASH + LAND_BY_NO[3].price * 0.2);
});

test('антимонополия: продажа лишних акций, банк выкупает', () => {
  let s = base();
  s.shares.trade = [0, 0, 0];
  s.players[0].pos = 10 - 2; // 8 → +2 = 10 (антимонопольный)
  setRandom((() => { const v = [0.01, 0.01]; let i = 0; return () => v[i++ % 2]; })());
  s = ok(dispatch(s, 0, { t: 'roll' }));
  assert.equal(s.players[0].pos, 10);
  for (let k = 0; k < 2; k++) {
    let pr = activePrompt(s);
    assert.equal(pr.type, 'auction');
    while (activePrompt(s).type === 'auction' && activePrompt(s).id === pr.id) s = ok(dispatch(s, activePrompt(s).pid, { t: 'pass' }));
  }
  assert.equal(s.shares.trade.filter((x) => x === 0).length, 1);
  assert.equal(s.players[0].cash, CONST.START_CASH + 2 * COMPANIES.trade.price * 0.8);
});

test('кредит: переговоры с акционерами банка, наибольший процент', () => {
  let s = base();
  s.shares.bank = [1, 2, null];
  s = ok(dispatch(s, 0, { t: 'credit' }));
  assert.equal(activePrompt(s).type, 'creditNeg');
  s = ok(dispatch(s, 1, { t: 'rate', rate: 10 }));
  s = ok(dispatch(s, 2, { t: 'rate', rate: 15 }));
  s = ok(dispatch(s, 0, { t: 'accept' }));
  assert.deepEqual(s.players[0].credits, [15]);
  assert.equal(s.players[0].cash, CONST.START_CASH + CONST.CREDIT_AMOUNT);
  err(dispatch(s, 0, { t: 'credit' }));
});

test('финансовая необеспеченность и банкротство', () => {
  let s = base();
  s.players[0].cash = 5000; s.players[0].pos = 49; // → 51 бизнес-школа: плата 40 000
  setRandom((() => { const v = [0.01, 0.01]; let i = 0; return () => v[i++ % 2]; })());
  s = ok(dispatch(s, 0, { t: 'roll' }));
  assert.equal(activePrompt(s).type, 'debt');
  s = ok(dispatch(s, 0, { t: 'bankrupt' }));
  assert.equal(s.players[0].bankrupt, true);
  assert.equal(s.cur, 1);
});

test('заём под вексель и требование возврата', () => {
  let s = base();
  s = ok(dispatch(s, 1, { t: 'offerLoan', to: 0, role: 'lend', amount: 50000, rate: 10, term: 1 }));
  const id = s.offers[0].id;
  s = ok(dispatch(s, 0, { t: 'acceptOffer', id }));
  assert.equal(s.players[0].cash, CONST.START_CASH + 50000);
  assert.equal(s.players[0].notes, 2);
  const lid = s.loans[0].id;
  err(dispatch(s, 1, { t: 'demandLoan', id: lid }));
  s.round = s.loans[0].due;
  s = ok(dispatch(s, 1, { t: 'demandLoan', id: lid }));
  assert.equal(s.players[0].cash, CONST.START_CASH - 5000);
  assert.equal(s.players[1].cash, CONST.START_CASH + 5000);
  assert.equal(s.players[0].notes, 3);
});

console.log(`\n${n} проверок пройдено`);
