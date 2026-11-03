// Отрисовка игрового поля на canvas (используется как текстура 3D-поля).
import { BOARD, COMPANIES, INDUSTRIES, LAND_BY_NO, CELL_TITLES, CONST, fmt } from '../engine/data.js';
import { BW, BH, CENTER, cellRect, OC, GAP, IX0, IY0, ICW } from './layout.js';

export const TYPE_STYLE = {
  start:        { color: '#1f3b73', icon: '🏁' },
  deal:         { color: '#e8951f', icon: '🤝' },
  land:         { color: '#2e9e6a', icon: '🌳' },
  surprise:     { color: '#8e5bd6', icon: '⚡' },
  consultation: { color: '#2f8fd8', icon: '💡' },
  antimono:     { color: '#c8455b', icon: '⚖️' },
  dividends:    { color: '#b8891c', icon: '💰' },
  income:       { color: '#4c7a34', icon: '🏭' },
  tax:          { color: '#b83232', icon: '🧾' },
  company:      { color: '#16285a', icon: '🏢' },
};
export const COMPANY_ICON = { bank: '🏦', exchange: '📈', consult: '📊', trade: '🚚', realty: '🏘️', hr: '👥', school: '🎓', insure: '☂️' };

const FONT = "Roboto, 'Segoe UI', 'DejaVu Sans', Arial, sans-serif";
const EMOJI = "'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW, size, weight = 'bold', minSize = 10) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > minSize) { s -= 1; ctx.font = `${weight} ${s}px ${FONT}`; }
  return s;
}

// Перенос заголовка на 1–2 строки
function drawTitle(ctx, text, cx, cy, maxW, size) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size}px ${FONT}`;
  if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, cx, cy); return; }
  const words = text.split(' ');
  if (words.length > 1) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || w < best.w) best = { a, b, w };
    }
    let s = size;
    while (best.w > maxW && s > 10) {
      s--; ctx.font = `bold ${s}px ${FONT}`;
      best.w = Math.max(ctx.measureText(best.a).width, ctx.measureText(best.b).width);
    }
    ctx.fillText(best.a, cx, cy - s * 0.55);
    ctx.fillText(best.b, cx, cy + s * 0.55);
    return;
  }
  const s = fitText(ctx, text, maxW, size);
  ctx.font = `bold ${s}px ${FONT}`;
  ctx.fillText(text, cx, cy);
}

function emoji(ctx, ch, cx, cy, size) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${EMOJI}`;
  ctx.fillText(ch, cx, cy);
}

export function cellTitleShort(i) {
  const c = BOARD[i];
  if (c.type === 'company') return COMPANIES[c.company].name.toUpperCase();
  if (c.type === 'land') return `УЧАСТОК №${c.land}`;
  return CELL_TITLES[c.type];
}

export function drawBoard(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const S = W / BW;
  const X = (x) => x * S;
  const Y = (y) => (BH - y) * S;

  // Фон: «вода венецианских каналов»
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#12485a');
  g.addColorStop(1, '#0b2c3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 3;
  for (let k = -10; k < 70; k++) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 24) {
      const y = k * 40 + Math.sin(x / 70 + k) * 8;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Рамка
  ctx.strokeStyle = '#d9b45a';
  ctx.lineWidth = 10;
  roundRect(ctx, 8, 8, W - 16, H - 16, 24);
  ctx.stroke();

  // Дорожка между кругами
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(X(OC), Y(BH - OC), X(BW - 2 * OC), (BH - 2 * OC) * S);

  // Клетки
  for (let i = 0; i < BOARD.length; i++) drawCell(ctx, i, S, X, Y);

  // Стрелки переходов между кругами
  drawArrow(ctx, X(cellRect(35).x + OC / 2), Y(OC - 0.35), X(cellRect(36).x + ICW / 2), Y(IY0 + 0.35), '#3d8bff', S);
  drawArrow(ctx, X(cellRect(59).x + ICW / 2), Y(IY0 + 0.35), X(cellRect(0).x + OC / 2), Y(OC - 0.35), '#ff4040', S);
  // Направление движения в зазорах
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const chev = (x, y, ang) => {
    ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-0.16 * S, -0.16 * S); ctx.lineTo(0.12 * S, 0); ctx.lineTo(-0.16 * S, 0.16 * S); ctx.lineTo(-0.06 * S, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const gm = OC + GAP / 2; // середина зазора
  for (let y = 5; y < BH - 4; y += 3) chev(gm, y, -Math.PI / 2);           // внешний: вверх по левой стороне
  for (let x = 5; x < BW - 4; x += 3) chev(x, BH - gm, 0);                 // вправо по верху
  for (let y = BH - 5; y > 4; y -= 3) chev(BW - gm, y, Math.PI / 2);       // вниз по правой
  // Центр
  drawCenter(ctx, S, X, Y);
}

function drawArrow(ctx, x1, y1, x2, y2, color, S) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.16 * S;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const hx = x2 - Math.cos(ang) * 0.3 * S, hy = y2 - Math.sin(ang) * 0.3 * S;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(ang - 0.5) * 0.45 * S, y2 - Math.sin(ang - 0.5) * 0.45 * S);
  ctx.lineTo(x2 - Math.cos(ang + 0.5) * 0.45 * S, y2 - Math.sin(ang + 0.5) * 0.45 * S);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawCell(ctx, i, S, X, Y) {
  const c = BOARD[i];
  const r = cellRect(i);
  const px = X(r.x), py = Y(r.y + r.h), pw = r.w * S, ph = r.h * S;
  const pad = 0.06 * S;
  const x = px + pad, y = py + pad, w = pw - 2 * pad, h = ph - 2 * pad;
  const st = TYPE_STYLE[c.type];
  // тень
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fbf6ea';
  roundRect(ctx, x, y, w, h, 0.18 * S);
  ctx.fill();
  ctx.restore();
  // заголовок
  const hh = h * 0.3;
  ctx.save();
  roundRect(ctx, x, y, w, h, 0.18 * S);
  ctx.clip();
  ctx.fillStyle = st.color;
  ctx.fillRect(x, y, w, hh);
  if (c.type === 'company') {
    ctx.fillStyle = '#f5d27a';
    ctx.fillRect(x, y + hh - 0.05 * S, w, 0.05 * S);
  }
  ctx.restore();
  ctx.fillStyle = c.type === 'company' ? '#f5d27a' : '#ffffff';
  drawTitle(ctx, cellTitleShort(i), x + w / 2, y + hh / 2, w - 0.16 * S, Math.round(0.26 * S));

  // номер клетки
  ctx.fillStyle = 'rgba(40,40,60,0.45)';
  ctx.font = `bold ${Math.round(0.2 * S)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(i), x + 0.1 * S, y + h - 0.1 * S);

  const icon = c.type === 'company' ? COMPANY_ICON[c.company] : st.icon;
  ctx.fillStyle = '#222';
  if (c.type === 'company') {
    emoji(ctx, icon, x + w / 2, y + h * 0.47, Math.round(0.58 * S));
    ctx.fillStyle = '#16285a';
    const s = fitText(ctx, 'акция ' + fmt(COMPANIES[c.company].price), w - 0.2 * S, Math.round(0.21 * S));
    ctx.font = `bold ${s}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('акция ' + fmt(COMPANIES[c.company].price), x + w / 2, y + h * 0.68);
    // гнёзда для 3 акций
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(px + pw * (0.27 + k * 0.23), py + ph * 0.86, 0.15 * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(22,40,90,0.5)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (c.type === 'land') {
    emoji(ctx, icon, x + w / 2, y + h * 0.5, Math.round(0.62 * S));
    ctx.fillStyle = '#1c5a3c';
    ctx.font = `bold ${Math.round(0.24 * S)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(LAND_BY_NO[c.land].price), x + w / 2, y + h * 0.75);
  } else {
    emoji(ctx, icon, x + w / 2, y + h * 0.58, Math.round(0.78 * S));
    let sub = null;
    if (c.type === 'dividends') sub = `+${fmt(CONST.DIVIDEND)} за акцию`;
    if (c.type === 'income') sub = `+${fmt(CONST.ENTERPRISE_INCOME)} за предпр.`;
    if (c.type === 'tax') sub = 'налог 10%';
    if (c.type === 'start') sub = 'начало пути';
    if (sub) {
      ctx.fillStyle = '#333';
      const s = fitText(ctx, sub, w - 0.2 * S, Math.round(0.19 * S));
      ctx.font = `bold ${s}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sub, x + w / 2, y + h * 0.86);
    }
  }
}

function drawCenter(ctx, S, X, Y) {
  const c = CENTER;
  const x0 = X(c.x) + 0.2 * S, y0 = Y(c.y + c.h) + 0.2 * S, w = c.w * S - 0.4 * S, h = c.h * S - 0.4 * S;
  ctx.save();
  ctx.fillStyle = 'rgba(251,246,234,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 16;
  roundRect(ctx, x0, y0, w, h, 0.3 * S);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#d9b45a';
  ctx.lineWidth = 6;
  roundRect(ctx, x0 + 0.12 * S, y0 + 0.12 * S, w - 0.24 * S, h - 0.24 * S, 0.24 * S);
  ctx.stroke();

  // Логотип
  ctx.fillStyle = '#16285a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(0.95 * S)}px Georgia, 'DejaVu Serif', serif`;
  const tableW = w * 0.66;
  const lx = x0 + 0.3 * S + tableW / 2;
  ctx.fillText('Р И А Л Ь Т О', lx, y0 + 0.85 * S);
  ctx.font = `italic ${Math.round(0.3 * S)}px Georgia, 'DejaVu Serif', serif`;
  ctx.fillStyle = '#9a7a2a';
  ctx.fillText('экономическая игра', lx, y0 + 1.5 * S);

  // Таблица цен
  const tx = x0 + 0.3 * S, ty = y0 + 1.9 * S, tw = tableW, th = h - 2.2 * S;
  const cols = [0.31, 0.17, 0.19, 0.16, 0.17];
  const heads = ['Отрасль', 'Материалы', 'Оборудов.', 'Персонал', 'Выручка'];
  const rows = INDUSTRIES.length + 1;
  const rh = th / rows;
  ctx.fillStyle = '#16285a';
  roundRect(ctx, tx, ty, tw, rh, 10);
  ctx.fill();
  let cx = tx;
  ctx.font = `bold ${Math.round(0.24 * S)}px ${FONT}`;
  heads.forEach((t, k) => {
    ctx.fillStyle = '#f5d27a';
    ctx.fillText(t, cx + (cols[k] * tw) / 2, ty + rh / 2);
    cx += cols[k] * tw;
  });
  INDUSTRIES.forEach((ind, r) => {
    const yy = ty + rh * (r + 1);
    ctx.fillStyle = r % 2 ? 'rgba(22,40,90,0.06)' : 'rgba(22,40,90,0.12)';
    ctx.fillRect(tx, yy, tw, rh);
    let xx = tx;
    const vals = [ind.name, fmt(ind.mat), fmt(ind.eq), fmt(ind.pers), fmt(ind.product)];
    vals.forEach((t, k) => {
      ctx.fillStyle = k === 0 ? ind.color : k === 4 ? '#1c6b3c' : '#222';
      ctx.font = `bold ${Math.round((k === 0 ? 0.25 : 0.24) * S)}px ${FONT}`;
      const s = fitText(ctx, t, cols[k] * tw - 12, Math.round(0.25 * S));
      ctx.font = `bold ${s}px ${FONT}`;
      ctx.fillText(t, xx + (cols[k] * tw) / 2, yy + rh / 2);
      xx += cols[k] * tw;
    });
  });
  ctx.font = `${Math.round(0.19 * S)}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText(`Лицензия ${fmt(CONST.LICENSE_PRICE)} · выручка + ½ цены участка`, tx + tw / 2, ty + th + 0.17 * S);

  // Места для колод
  const dx = tx + tw + 0.45 * S;
  const dw = (x0 + w - 0.3 * S - dx);
  const cardW = Math.min(dw / 2 - 0.2 * S, 2.3 * S), cardH = cardW * 1.4;
  const decks = [['ДЕЛОВОЙ', 'СЛУЧАЙ', TYPE_STYLE.surprise.color, '⚡'], ['КОНСУЛЬ-', 'ТАЦИЯ', TYPE_STYLE.consultation.color, '💡']];
  decks.forEach((d, k) => {
    const cx2 = dx + k * (cardW + 0.3 * S);
    const cy2 = y0 + (h - cardH) / 2 + 0.2 * S;
    ctx.strokeStyle = d[2];
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 10]);
    roundRect(ctx, cx2, cy2, cardW, cardH, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = d[2];
    ctx.font = `bold ${Math.round(0.22 * S)}px ${FONT}`;
    ctx.fillText(d[0], cx2 + cardW / 2, cy2 - 0.45 * S);
    ctx.fillText(d[1], cx2 + cardW / 2, cy2 - 0.18 * S);
  });
}

// Позиции колод в единицах поля (центр карт) — для 3D-стопок
export function deckSpots() {
  const c = CENTER;
  const x0 = c.x + 0.2, w = c.w - 0.4, h = c.h - 0.4, yTop = c.y + c.h - 0.2;
  const tableW = w * 0.66;
  const tx = x0 + 0.3;
  const dx = tx + tableW + 0.45;
  const dw = x0 + w - 0.3 - dx;
  const cardW = Math.min(dw / 2 - 0.2, 2.3), cardH = cardW * 1.4;
  const out = [];
  for (let k = 0; k < 2; k++) {
    const cx = dx + k * (cardW + 0.3) + cardW / 2;
    const cyTop = (h - cardH) / 2 + 0.2;  // от верхнего края центральной области
    const cy = yTop - cyTop - cardH / 2;
    out.push({ x: cx, y: cy, w: cardW, h: cardH });
  }
  return out;
}
