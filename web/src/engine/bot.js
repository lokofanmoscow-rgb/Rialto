// Простой компьютерный соперник: выбирает разумное действие из доступных.
import { options, globalOptions, activePrompt, shareCount, ownedLands, landOf, R100 } from './engine.js';
import { COMPANIES, INDUSTRY, INDUSTRIES, CONST, BOARD } from './data.js';

const COMPANY_VALUE = { trade: 1.5, hr: 1.3, bank: 1.3, exchange: 1.2, realty: 1.1, consult: 1.0, school: 0.9, insure: 1.0 };

function pick(list, score) {
  let best = null, bs = -Infinity;
  for (const o of list) { const s = score(o); if (s > bs) { bs = s; best = o; } }
  return best;
}

export function botAction(st, pid) {
  const pr = activePrompt(st);
  const p = st.players[pid];
  const opts = options(st, pid).filter((o) => o.ok);
  const find = (t) => opts.find((o) => o.t === t);
  const reserve = 30000;

  if (pr.pid !== pid) {
    // ответы на предложения займов — боты вежливо отказываются
    const dec = globalOptions(st, pid).find((o) => o.t === 'declineOffer');
    return dec ? { t: 'declineOffer', id: dec.id } : null;
  }

  switch (pr.type) {
    case 'turn': {
      if (st.turn.phase === 'pre') {
        const ins = find('insure');
        if (ins && p.insurance < 1 && p.cash > 180000) return { t: 'insure' };
        const cr = find('credit');
        if (cr && p.cash < 80000 && p.credits.length < 2 && ownedLands(st, pid).length) return { t: 'credit' };
        return { t: 'roll' };
      }
      if (st.turn.phase === 'post') {
        const rep = globalOptions(st, pid).find((o) => o.t === 'repayCredit' && o.ok);
        if (rep && p.cash - rep.cost > 220000) return { t: 'repayCredit', i: rep.i };
        return { t: 'endTurn' };
      }
      return dealChoice(st, pid, opts, reserve) || (find('skip') ? { t: 'skip' } : { t: 'declineLand' });
    }
    case 'ownerDeal':
      return dealChoice(st, pid, opts, reserve) || { t: 'skip' };
    case 'debt': {
      const sell = pick(opts.filter((o) => o.t === 'sellShare' || (o.t === 'sellLand')), (o) => -(o.cost || 0) - (o.hasEnt ? 100000 : 0));
      if (sell) return sell.t === 'sellShare' ? { t: 'sellShare', c: sell.c } : { t: 'sellLand', land: sell.land };
      return { t: 'bankrupt' };
    }
    case 'antimono': {
      const o = pick(opts, (x) => -COMPANIES[x.c].price);
      return { t: 'chooseMono', c: o.c };
    }
    case 'auction': {
      const bid = find('bid');
      if (!bid) return { t: 'pass' };
      const base = pr.start;
      let value = base;
      if (pr.kind === 'share') value = base * (COMPANY_VALUE[pr.c] || 1) * 1.15;
      else value = base * 1.25;
      if (bid.amount <= value && p.cash - bid.amount > reserve) {
        const step = Math.max(CONST.MIN_BID_STEP, R100(base * 0.05));
        const amount = Math.min(p.cash - reserve, pr.leader === null ? bid.amount : Math.max(bid.amount, pr.high + step));
        if (amount >= bid.amount) return { t: 'bid', amount: R100(amount) };
      }
      return { t: 'pass' };
    }
    case 'commission': {
      if (pr.stage === 'ask') return { t: 'ask', amount: R100(pr.nominal * 0.15) };
      if (pr.stage === 'lower') return { t: 'ask', amount: R100((pr.asks[pid] || 0) * 0.6) };
      const acc = find('accept');
      const comm = acc ? acc.cost - pr.nominal : Infinity;
      if (acc && comm <= pr.nominal * 0.2 && p.cash - acc.cost > 0) return { t: 'accept' };
      if (find('lower')) return { t: 'lower' };
      if (acc && p.cash - acc.cost > reserve) return { t: 'accept' };
      return { t: 'refuse' };
    }
    case 'creditNeg': {
      if (pr.stage === 'ask') {
        const rates = opts.map((o) => o.rate);
        return { t: 'rate', rate: rates[Math.floor(rates.length / 2)] };
      }
      const acc = find('accept');
      return acc && acc.rate <= 15 ? { t: 'accept' } : { t: 'refuse' };
    }
  }
  return opts[0] ? stripOpt(opts[0]) : null;
}

function stripOpt(o) {
  const { ok, why, cost, nego, hasEnt, max, min, rate, ...a } = o;
  if (o.t === 'bid') return { t: 'bid', amount: o.amount };
  return a;
}

function dealChoice(st, pid, opts, reserve) {
  const p = st.players[pid];
  // 1. Достроить предприятие
  const comps = opts.filter((o) => o.t === 'buyComp' && p.cash - o.cost > reserve * (o.nego ? 1.5 : 0.5));
  if (comps.length) {
    const c = pick(comps, (o) => {
      const L = landOf(st, o.land);
      const filled = ['mat', 'eq', 'pers'].filter((k) => L.ent[k]).length;
      return filled * 10 - o.cost / 10000;
    });
    return { t: 'buyComp', comp: c.comp, land: c.land };
  }
  // 2. Купить участок
  const lands = opts.filter((o) => o.t === 'buyLand' && p.cash - o.cost > reserve + 20000);
  if (lands.length && ownedLands(st, pid).length < 3) {
    const l = pick(lands, (o) => -o.cost);
    return { t: 'buyLand', land: l.land };
  }
  // 3. Лицензия на пустой участок
  const lic = opts.filter((o) => o.t === 'buyLicense' && p.cash - o.cost > reserve);
  if (lic.length) {
    const l = pick(lic, (o) => {
      const ind = INDUSTRY[o.ind];
      return ind.product - ind.mat - ind.eq - ind.pers + st.stock.lic[o.ind] * 1000;
    });
    return { t: 'buyLicense', ind: l.ind, land: l.land };
  }
  // 4. Акции
  const shares = opts.filter((o) => o.t === 'buyShare' && p.cash - o.cost > reserve + 60000 && shareCount(st, o.c, pid) < 1);
  if (shares.length) {
    const s = pick(shares, (o) => (COMPANY_VALUE[o.c] || 1) * 100000 - o.cost);
    return { t: 'buyShare', c: s.c };
  }
  // 5. Кредит в банке, если мало денег
  const bc = opts.find((o) => o.t === 'bankCredit');
  if (bc && p.cash < 60000 && p.credits.length < 2 && ownedLands(st, pid).length) return { t: 'bankCredit' };
  if (opts.find((o) => o.t === 'declineLand')) {
    const land = opts.find((o) => o.t === 'declineLand').land;
    return { t: 'declineLand', land };
  }
  return null;
}
