// Симуляция множества партий случайными и «умными» игроками с проверкой инвариантов.
import { createGame, dispatch, options, globalOptions, activePrompt, setRandom } from '../src/engine/engine.js';
import { botAction } from '../src/engine/bot.js';
import { CONST, INDUSTRIES, COMPANY_KEYS, PLAYER_COLORS } from '../src/engine/data.js';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function check(st) {
  const errs = [];
  for (const p of st.players) {
    if (p.cash < 0) errs.push(`negative cash ${p.name} ${p.cash}`);
    if (p.insurance < 0 || p.insurance > CONST.INSURANCE_MAX) errs.push('insurance range');
    if (p.notes < 0 || p.notes > CONST.NOTES_PER_PLAYER) errs.push(`notes range ${p.notes}`);
  }
  for (const ind of INDUSTRIES) {
    const onBoard = st.lands.filter((l) => l.ent.lic === ind.id).length;
    const done = st.players.reduce((s, p) => s + p.done.filter((x) => x === ind.id).length, 0);
    if (st.stock.lic[ind.id] + onBoard + done !== CONST.LICENSES_PER_INDUSTRY) errs.push(`license conservation ${ind.id}`);
  }
  for (const k of ['mat', 'eq', 'pers']) {
    const onBoard = st.lands.filter((l) => l.ent[k]).length;
    if (st.stock[k] + onBoard !== CONST.COMPONENT_STOCK) errs.push(`component conservation ${k}`);
  }
  const credits = st.stock.credits.length + st.players.reduce((s, p) => s + p.credits.length, 0);
  if (credits !== CONST.CREDIT_RATES.length) errs.push('credit conservation ' + credits);
  const ins = st.stock.ins + st.players.reduce((s, p) => s + p.insurance, 0);
  if (ins !== CONST.INSURANCE_STOCK) errs.push('insurance conservation');
  for (const k of COMPANY_KEYS) for (const o of st.shares[k]) if (o !== null && (st.players[o].bankrupt)) errs.push('bankrupt holds share');
  for (const l of st.lands) { if (l.owner !== null && st.players[l.owner].bankrupt) errs.push('bankrupt owns land'); if (l.owner === null && l.ent.lic) errs.push('ent on free land'); }
  if (!st.over) {
    const pr = activePrompt(st);
    if (pr.pid === null || pr.pid === undefined) errs.push('prompt without actor ' + pr.type);
    else if (st.players[pr.pid].bankrupt) errs.push('bankrupt actor');
    else if (!options(st, pr.pid).some((o) => o.ok)) errs.push('no legal options for ' + pr.type + ' ' + JSON.stringify(pr).slice(0, 200));
  }
  return errs;
}

function randomAction(st, pid, rnd) {
  const pr = activePrompt(st);
  const opts = options(st, pid).filter((o) => o.ok);
  const o = opts[Math.floor(rnd() * opts.length)];
  const { ok, why, cost, nego, hasEnt, max, min, rate, offer, loan, ...a } = o;
  if (o.t === 'bid') a.amount = Math.min(o.max, o.amount + Math.floor(rnd() * 5) * 1000);
  if (o.t === 'ask') a.amount = pr.stage === 'lower' ? Math.floor((o.max * rnd()) / 100) * 100 : Math.floor(rnd() * 5) * 5000;
  if (o.t === 'rate') a.rate = o.rate;
  return a;
}

function runGame(seed, mode, nPlayers) {
  const rnd = mulberry32(seed);
  setRandom(mulberry32(seed * 7 + 1));
  let st = createGame({ players: Array.from({ length: nPlayers }, (_, i) => ({ name: 'P' + i, color: PLAYER_COLORS[i].id })), target: 3 });
  let steps = 0;
  const stats = { actions: 0, errors: 0 };
  while (!st.over && steps < 30000) {
    steps++;
    // случайные глобальные действия
    if (mode === 'random' && rnd() < 0.05) {
      const pid = Math.floor(rnd() * nPlayers);
      if (!st.players[pid].bankrupt) {
        const g = globalOptions(st, pid).filter((o) => o.ok);
        let a;
        if (g.length && rnd() < 0.6) { const { ok, why, cost, offer, loan, rate, ...x } = g[Math.floor(rnd() * g.length)]; a = x; }
        else a = { t: 'offerLoan', to: (pid + 1) % nPlayers, role: rnd() < 0.5 ? 'lend' : 'borrow', amount: 10000 + Math.floor(rnd() * 10) * 10000, rate: 10, term: 1 + Math.floor(rnd() * 3) };
        const r = dispatch(st, pid, a);
        if (r.ok) st = r.state;
      }
    }
    const pr = activePrompt(st);
    const pid = pr.pid;
    const a = mode === 'bot' ? botAction(st, pid) : randomAction(st, pid, rnd);
    const r = dispatch(st, pid, a);
    if (r.error) { stats.errors++; if (mode === 'bot') { console.log('BOT ERROR', r.error, JSON.stringify(a), pr.type, st.turn.phase); } continue; }
    st = r.state;
    stats.actions++;
    const errs = check(st);
    if (errs.length) { console.log('INVARIANT', seed, mode, errs, 'after', JSON.stringify(a), 'prompt', pr.type); console.log(st.log.slice(-8).map((l) => l.text).join('\n')); process.exit(1); }
  }
  return { st, steps, stats };
}

let over = 0, total = 0, rounds = 0, bankrupts = 0, botErr = 0;
const t0 = Date.now();
for (const mode of ['bot', 'random']) {
  for (let seed = 1; seed <= (mode === 'bot' ? 150 : 150); seed++) {
    const n = 2 + (seed % 5);
    const { st, steps, stats } = runGame(seed, mode, n);
    total++;
    if (st.over) over++;
    else console.log('NOT FINISHED', mode, seed, steps, st.round);
    rounds += st.round;
    bankrupts += st.players.filter((p) => p.bankrupt).length;
    if (mode === 'bot') botErr += stats.errors;
  }
}
console.log(`games: ${total}, finished: ${over}, avg rounds: ${(rounds / total).toFixed(1)}, bankrupts: ${bankrupts}, bot errors: ${botErr}, ${(Date.now() - t0)} ms`);
if (botErr) process.exit(1);
