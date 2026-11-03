// Геометрия поля в «единицах поля». Начало координат — левый нижний угол, ось y вверх.
import { GEOMETRY } from '../engine/data.js';

export const BW = 31.2;           // ширина поля
export const BH = 20.8;           // высота поля
export const OC = 2.6;            // размер клетки внешнего круга
export const GAP = 0.8;           // зазор между кругами
export const IX0 = OC + GAP;
export const IY0 = OC + GAP;
export const IW = BW - 2 * IX0;
export const IH = BH - 2 * IY0;
export const ICW = IW / 9;        // клетка внутреннего круга
export const ICH = IH / 5;
// Центральная область (таблица цен, колоды)
export const CENTER = { x: IX0 + ICW, y: IY0 + ICH, w: IW - 2 * ICW, h: IH - 2 * ICH };

export function cellRect(i) {
  const g = GEOMETRY[i];
  if (g.ring === 'outer') return { x: g.col * OC, y: g.row * OC, w: OC, h: OC };
  return { x: IX0 + g.col * ICW, y: IY0 + g.row * ICH, w: ICW, h: ICH };
}

export function cellCenter(i) {
  const r = cellRect(i);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// В 3D: X вправо, Z «к зрителю» (нижний край поля ближе к камере)
export function toWorld(x, y) {
  return { x: x - BW / 2, z: -(y - BH / 2) };
}

export function worldToBoard(x, z) {
  return { x: x + BW / 2, y: BH / 2 - z };
}

export function cellAt(x, y) {
  for (let i = 0; i < GEOMETRY.length; i++) {
    const r = cellRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// Точки на клетке в долях (0..1) от левого нижнего угла
export function cellPoint(i, fx, fy) {
  const r = cellRect(i);
  return toWorld(r.x + r.w * fx, r.y + r.h * fy);
}
