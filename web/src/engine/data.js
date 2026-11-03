// Игровые данные «Риальто»: поле, компании, отрасли, карты.
// Все числа и раскладка поля — собственные для этой игры.

export const CONST = {
  START_CASH: 300000,
  NOTES_PER_PLAYER: 3,          // векселей у каждого игрока
  LICENSE_PRICE: 10000,
  LICENSES_PER_INDUSTRY: 6,
  COMPONENT_STOCK: 12,          // карт Материалы / Оборудование / Персонал в банке
  CREDIT_AMOUNT: 100000,
  CREDIT_RATES: [5, 5, 5, 5, 10, 10, 10, 10, 15, 15, 15, 15, 20, 20, 20, 20],
  INSURANCE_PRICE: 20000,
  INSURANCE_MAX: 3,
  INSURANCE_STOCK: 12,
  INSURANCE_COVER: 100000,
  SCHOOL_FEE: 40000,
  RESEARCH_FEE: 60000,
  ENTERPRISE_INCOME: 35000,
  DIVIDEND: 10000,
  TAX_RATE: 0.10,
  TRADE_COMMISSION: 0.20,       // биржа / агентство недвижимости
  FINISH_BONUS: 200000,
  SHARES_PER_COMPANY: 3,
  MIN_BID_STEP: 1000,
  MAX_ASK: 1000000,
};

export const COMPANIES = {
  bank:     { key: 'bank',     name: 'Банк',                     short: 'Банк',      price: 50000, cell: 5,
              income: 'Проценты по всем банковским кредитам игроков' },
  exchange: { key: 'exchange', name: 'Фондовая биржа',           short: 'Биржа',     price: 45000, cell: 12,
              income: '20% комиссионных с каждой продажи акций' },
  consult:  { key: 'consult',  name: 'Консалтинговая компания',  short: 'Консалтинг', price: 30000, cell: 18,
              income: 'Плата за консультации и маркетинговые исследования' },
  trade:    { key: 'trade',    name: 'Торговый дом',             short: 'Торг. дом', price: 40000, cell: 30,
              income: 'Комиссионные с продажи карт Материалы и Оборудование' },
  realty:   { key: 'realty',   name: 'Агентство недвижимости',   short: 'Недвижим.', price: 25000, cell: 36,
              income: '20% комиссионных с каждой продажи земельных участков' },
  hr:       { key: 'hr',       name: 'Кадровый центр',           short: 'Кадры',     price: 35000, cell: 39,
              income: 'Комиссионные с найма Персонала' },
  school:   { key: 'school',   name: 'Бизнес-школа',             short: 'Школа',     price: 20000, cell: 51,
              income: 'Плата за обучение с игроков, не являющихся акционерами' },
  insure:   { key: 'insure',   name: 'Страховая компания',       short: 'Страховая', price: 40000, cell: 55,
              income: 'Страховые взносы (накапливаются и выплачиваются в конце игры)' },
};
export const COMPANY_KEYS = Object.keys(COMPANIES);

export const INDUSTRIES = [
  { id: 'auto',  name: 'Автомобили',       mat: 45000, eq: 55000, pers: 40000, product: 330000, color: '#d94040', icon: 'car' },
  { id: 'elec',  name: 'Электроника',      mat: 35000, eq: 50000, pers: 45000, product: 310000, color: '#3f7fe0', icon: 'chip' },
  { id: 'chem',  name: 'Нефтехимия',       mat: 55000, eq: 45000, pers: 35000, product: 340000, color: '#3a3a46', icon: 'drop' },
  { id: 'pharm', name: 'Фармацевтика',     mat: 40000, eq: 45000, pers: 50000, product: 320000, color: '#2fae8f', icon: 'pill' },
  { id: 'furn',  name: 'Мебель',           mat: 30000, eq: 35000, pers: 30000, product: 240000, color: '#a0703c', icon: 'chair' },
  { id: 'food',  name: 'Продукты питания', mat: 30000, eq: 30000, pers: 35000, product: 230000, color: '#e59a1c', icon: 'bread' },
];
export const INDUSTRY = Object.fromEntries(INDUSTRIES.map((x) => [x.id, x]));

export const COMPONENTS = {
  mat:  { key: 'mat',  name: 'Материалы',    company: 'trade' },
  eq:   { key: 'eq',   name: 'Оборудование', company: 'trade' },
  pers: { key: 'pers', name: 'Персонал',     company: 'hr' },
};

// Земельные участки: номер → цена
export const LANDS = [
  { no: 1, price: 20000 }, { no: 2, price: 25000 }, { no: 3, price: 30000 }, { no: 4, price: 40000 },
  { no: 5, price: 45000 }, { no: 6, price: 55000 }, { no: 7, price: 60000 }, { no: 8, price: 70000 },
  { no: 9, price: 80000 }, { no: 10, price: 95000 }, { no: 11, price: 110000 }, { no: 12, price: 130000 },
];

// Путь по полю. Индекс в массиве = порядок обхода.
// Внешний круг (0..35) идёт по часовой стрелке, внутренний (36..59) — против часовой.
// С 35 фишка поднимается на внутренний круг (36), с 59 (Налоговая инспекция) по красной стрелке
// возвращается на внешний круг к клетке 0 (Старт).
const T = (type, extra = {}) => ({ type, ...extra });
const DEAL = () => T('deal');
const LAND = (no) => T('land', { land: no });
const CO = (c) => T('company', { company: c });

export const BOARD = [
  /* 0 */ T('start'),
  /* 1 */ DEAL(),
  /* 2 */ LAND(1),
  /* 3 */ T('surprise'),
  /* 4 */ DEAL(),
  /* 5 */ CO('bank'),
  /* 6 */ DEAL(),
  /* 7 */ T('consultation'),
  /* 8 */ LAND(2),
  /* 9 */ DEAL(),
  /* 10 */ T('antimono'),
  /* 11 */ DEAL(),
  /* 12 */ CO('exchange'),
  /* 13 */ DEAL(),
  /* 14 */ LAND(3),
  /* 15 */ T('surprise'),
  /* 16 */ DEAL(),
  /* 17 */ DEAL(),
  /* 18 */ CO('consult'),
  /* 19 */ DEAL(),
  /* 20 */ LAND(4),
  /* 21 */ T('consultation'),
  /* 22 */ DEAL(),
  /* 23 */ T('dividends'),
  /* 24 */ DEAL(),
  /* 25 */ LAND(5),
  /* 26 */ T('surprise'),
  /* 27 */ DEAL(),
  /* 28 */ T('antimono'),
  /* 29 */ DEAL(),
  /* 30 */ CO('trade'),
  /* 31 */ DEAL(),
  /* 32 */ LAND(6),
  /* 33 */ T('consultation'),
  /* 34 */ DEAL(),
  /* 35 */ LAND(7),
  /* 36 */ CO('realty'),
  /* 37 */ DEAL(),
  /* 38 */ LAND(8),
  /* 39 */ CO('hr'),
  /* 40 */ DEAL(),
  /* 41 */ T('surprise'),
  /* 42 */ LAND(9),
  /* 43 */ T('income'),
  /* 44 */ DEAL(),
  /* 45 */ T('consultation'),
  /* 46 */ LAND(10),
  /* 47 */ DEAL(),
  /* 48 */ T('antimono'),
  /* 49 */ DEAL(),
  /* 50 */ LAND(11),
  /* 51 */ CO('school'),
  /* 52 */ DEAL(),
  /* 53 */ T('surprise'),
  /* 54 */ DEAL(),
  /* 55 */ CO('insure'),
  /* 56 */ LAND(12),
  /* 57 */ DEAL(),
  /* 58 */ DEAL(),
  /* 59 */ T('tax'),
];
export const BOARD_SIZE = BOARD.length;
export const LAND_CELL = {};
BOARD.forEach((c, i) => { c.i = i; if (c.type === 'land') LAND_CELL[c.land] = i; });
export const LAND_BY_NO = Object.fromEntries(LANDS.map((l) => [l.no, l]));

// Геометрия: координаты клеток в сетке колец (для 3D-поля)
function buildGeometry() {
  const g = [];
  // внешний круг 12x8
  for (let c = 5; c >= 1; c--) g.push({ ring: 'outer', col: c, row: 0 });
  g.push({ ring: 'outer', col: 0, row: 0, corner: true });
  for (let r = 1; r <= 6; r++) g.push({ ring: 'outer', col: 0, row: r });
  g.push({ ring: 'outer', col: 0, row: 7, corner: true });
  for (let c = 1; c <= 10; c++) g.push({ ring: 'outer', col: c, row: 7 });
  g.push({ ring: 'outer', col: 11, row: 7, corner: true });
  for (let r = 6; r >= 1; r--) g.push({ ring: 'outer', col: 11, row: r });
  g.push({ ring: 'outer', col: 11, row: 0, corner: true });
  for (let c = 10; c >= 6; c--) g.push({ ring: 'outer', col: c, row: 0 });
  // внутренний круг 9x5
  g.push({ ring: 'inner', col: 5, row: 0 });
  g.push({ ring: 'inner', col: 6, row: 0 });
  g.push({ ring: 'inner', col: 7, row: 0 });
  g.push({ ring: 'inner', col: 8, row: 0, corner: true });
  for (let r = 1; r <= 3; r++) g.push({ ring: 'inner', col: 8, row: r });
  g.push({ ring: 'inner', col: 8, row: 4, corner: true });
  for (let c = 7; c >= 1; c--) g.push({ ring: 'inner', col: c, row: 4 });
  g.push({ ring: 'inner', col: 0, row: 4, corner: true });
  for (let r = 3; r >= 1; r--) g.push({ ring: 'inner', col: 0, row: r });
  g.push({ ring: 'inner', col: 0, row: 0, corner: true });
  for (let c = 1; c <= 3; c++) g.push({ ring: 'inner', col: c, row: 0 });
  g.push({ ring: 'inner', col: 4, row: 0 });
  return g;
}
export const GEOMETRY = buildGeometry();
if (GEOMETRY.length !== BOARD.length) throw new Error('board geometry mismatch');

export const CELL_TITLES = {
  start: 'СТАРТ',
  deal: 'СДЕЛКА',
  land: 'УЧАСТОК',
  surprise: 'ДЕЛОВОЙ СЛУЧАЙ',
  consultation: 'КОНСУЛЬТАЦИЯ',
  antimono: 'АНТИМОНОПОЛЬНЫЙ КОМИТЕТ',
  dividends: 'ДИВИДЕНДЫ',
  income: 'ДОХОД ОТ ПРЕДПРИЯТИЙ',
  tax: 'НАЛОГОВАЯ ИНСПЕКЦИЯ',
};

export function cellTitle(i) {
  const c = BOARD[i];
  if (c.type === 'company') return COMPANIES[c.company].name;
  if (c.type === 'land') return `Участок №${c.land}`;
  return CELL_TITLES[c.type];
}

// Описание клетки для подсказок
export function cellHelp(i) {
  const c = BOARD[i];
  switch (c.type) {
    case 'start': return 'Отсюда начинают все игроки. Клетка без эффекта.';
    case 'deal': return 'Можно совершить одну сделку: купить или продать акцию, купить лицензию, купить карту Материалы/Оборудование/Персонал или продать участок.';
    case 'land': return `Свободный участок можно купить за ${fmt(LAND_BY_NO[c.land].price)}. Если отказаться — участок уходит на аукцион. Если вы встали на чужой участок, его владелец сразу получает право на одну сделку.`;
    case 'surprise': return 'Берётся карта «Деловой случай»: доход или убыток. Страховые свидетельства покрывают убытки (каждое до 100 000).';
    case 'consultation': return 'Берётся карта «Консультация». Указанную сумму платите акционерам Консалтинговой компании.';
    case 'antimono': return 'Если у вас 2 или 3 акции одной компании — вы монополист и обязаны продать на аукционе 1 (или 2) из них.';
    case 'dividends': return `При остановке или проходе: ${fmt(CONST.DIVIDEND)} за каждую вашу акцию.`;
    case 'income': return `При остановке или проходе: ${fmt(CONST.ENTERPRISE_INCOME)} за каждое ваше введённое предприятие.`;
    case 'tax': return 'При остановке или проходе по красной стрелке платится налог 10% от номинала ваших акций и участков. Затем фишка возвращается на внешний круг.';
    case 'company': {
      const co = COMPANIES[c.company];
      const base = `Акция: ${fmt(co.price)}. Доход компании: ${co.income.toLowerCase()}.`;
      const extra = {
        bank: ' Можно купить акцию банка и/или взять кредит под наименьший процент, либо продать свою акцию банка. При каждом проходе через Банк вы платите проценты по своим кредитам.',
        exchange: ' Можно купить свободную акцию любой компании или продать любую свою акцию.',
        consult: ` Не акционеры платят за маркетинговое исследование ${fmt(CONST.RESEARCH_FEE)}, затем могут купить акцию.`,
        trade: ' Можно купить акцию, карту Материалы или Оборудование, либо продать свою акцию.',
        realty: ' Можно купить акцию, любой свободный участок, продать свой участок или акцию.',
        hr: ' Можно купить акцию, карту Персонал, либо продать свою акцию.',
        school: ` Не акционеры платят за обучение ${fmt(CONST.SCHOOL_FEE)}, затем могут купить акцию.`,
        insure: ' Можно купить или продать акцию. Взносы за страховые свидетельства копятся и в конце игры делятся между акционерами.',
      }[c.company];
      return base + extra;
    }
  }
  return '';
}

// Игровая валюта — дукаты (в честь венецианского рынка Риальто)
export const CURRENCY = 'дк';
export function fmt(n) {
  const s = Math.round(n).toString();
  const neg = s.startsWith('-');
  const d = neg ? s.slice(1) : s;
  return (neg ? '−' : '') + d.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0' + CURRENCY;
}

// Карты «Деловой случай» (amount > 0 — доход, < 0 — убыток)
export const SURPRISES = [
  { text: 'Ваш стартап выиграл грант инновационного фонда', amount: 60000 },
  { text: 'Выгодный контракт с зарубежным партнёром', amount: 80000 },
  { text: 'Возврат переплаты по налогам', amount: 30000 },
  { text: 'Рекламный ролик стал вирусным — продажи выросли', amount: 50000 },
  { text: 'Премия «Предприниматель года»', amount: 40000 },
  { text: 'Продали списанное оборудование', amount: 20000 },
  { text: 'Удачные вложения в облигации', amount: 70000 },
  { text: 'Курсовая разница сыграла вам на руку', amount: 45000 },
  { text: 'Пожар на складе', amount: -120000 },
  { text: 'Наводнение затопило офис', amount: -80000 },
  { text: 'Хакерская атака на серверы компании', amount: -60000 },
  { text: 'Штраф за просроченную отчётность', amount: -30000 },
  { text: 'Сорвана поставка — неустойка партнёру', amount: -90000 },
  { text: 'Авария на производственной линии', amount: -150000 },
  { text: 'Проигран судебный иск конкурента', amount: -100000 },
  { text: 'Ураган повредил крышу цеха', amount: -200000 },
  { text: 'Кража со склада', amount: -50000 },
  { text: 'Отзыв бракованной партии товара', amount: -110000 },
  { text: 'Сбой энергосети — простой производства', amount: -250000 },
  { text: 'Санитарная проверка — устранение нарушений', amount: -40000 },
];

// Карты «Консультация» — сумма платится акционерам Консалтинговой компании
export const CONSULTS = [
  { text: 'Юридическая экспертиза договора', amount: 10000 },
  { text: 'Аудит бухгалтерии', amount: 30000 },
  { text: 'Разработка бизнес-плана', amount: 40000 },
  { text: 'Исследование рынка сбыта', amount: 50000 },
  { text: 'Консультация по налогам', amount: 20000 },
  { text: 'Оптимизация логистики', amount: 35000 },
  { text: 'Тренинг для отдела продаж', amount: 25000 },
  { text: 'Подбор надёжных поставщиков', amount: 15000 },
  { text: 'Разработка фирменного стиля', amount: 30000 },
  { text: 'IT-консалтинг', amount: 45000 },
  { text: 'Финансовый анализ', amount: 20000 },
  { text: 'Консультация по экспорту', amount: 35000 },
  { text: 'Стратегическая сессия с экспертами', amount: 50000 },
  { text: 'Оценка рисков', amount: 25000 },
  { text: 'Патентный поиск', amount: 15000 },
  { text: 'Сертификация продукции', amount: 30000 },
  { text: 'Кадровый аудит', amount: 20000 },
  { text: 'Консультация по лизингу', amount: 10000 },
  { text: 'Энергоаудит предприятия', amount: 25000 },
  { text: 'Антикризисный консалтинг', amount: 60000 },
];

export const PLAYER_COLORS = [
  { id: 'red',    name: 'Красный',    hex: '#e53935' },
  { id: 'blue',   name: 'Синий',      hex: '#1e88e5' },
  { id: 'green',  name: 'Зелёный',    hex: '#43a047' },
  { id: 'yellow', name: 'Жёлтый',     hex: '#fdd835' },
  { id: 'purple', name: 'Фиолетовый', hex: '#8e24aa' },
  { id: 'orange', name: 'Оранжевый',  hex: '#fb8c00' },
];
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
