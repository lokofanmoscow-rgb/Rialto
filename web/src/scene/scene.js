// 3D-сцена игрового поля.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD, BOARD_SIZE, COMPANIES, COMPANY_KEYS, LAND_CELL, INDUSTRY, PLAYER_COLORS } from '../engine/data.js';
import { BW, BH, OC, IY0, ICW, CENTER, cellRect, cellCenter, toWorld, worldToBoard, cellAt, cellPoint } from './layout.js';
import { drawBoard, deckSpots, TYPE_STYLE } from './texture.js';
import { sfx } from '../ui/sound.js';

const TILE_H = 0.12;
const TOP = 0.2 + TILE_H;     // высота верхней грани клеток
const colorOf = (id) => (PLAYER_COLORS.find((c) => c.id === id) || PLAYER_COLORS[0]).hex;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class BoardScene {
  constructor(canvas, { onCellTap } = {}) {
    this.canvas = canvas;
    this.onCellTap = onCellTap || (() => {});
    this.tweens = [];
    this.queue = [];
    this.running = false;
    this.framesLeft = 60;
    this.follow = true;
    this.pawns = new Map();
    this.displayPos = new Map();
    this.lastCash = null;
    this.lastSeq = 0;
    this.state = null;
    this.idleCallbacks = [];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1820');
    scene.fog = new THREE.Fog('#0b1820', 60, 120);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 300);
    this.camera = camera;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 7;
    controls.maxDistance = 60;
    controls.maxPolarAngle = 1.3;
    controls.minPolarAngle = 0.05;
    controls.screenSpacePanning = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('change', () => this.wake());
    controls.addEventListener('start', () => { this.userInteracting = true; });
    controls.addEventListener('end', () => { this.userInteracting = false; });
    this.controls = controls;

    // Свет
    scene.add(new THREE.HemisphereLight(0xfff6e5, 0x26323d, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-12, 30, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 15; sc.bottom = -15; sc.near = 5; sc.far = 80;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    this.buildTable();
    this.buildBoard();
    this.buildDecks();
    this.buildDice();
    this.buildHighlights();
    this.markerGroup = new THREE.Group();
    scene.add(this.markerGroup);
    this.floatGroup = new THREE.Group();
    scene.add(this.floatGroup);

    this.setupPicking();
    this.resize();
    this.resetCamera(true);
    window.addEventListener('resize', () => { this.resize(); this.resetCamera(true); });
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  wake(frames = 40) { this.framesLeft = Math.max(this.framesLeft, frames); }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.applyInsets();
    this.wake();
  }

  // Свободная от панелей область: смещаем центр проекции, чтобы поле было по центру видимой части
  setInsets(ins) {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...ins };
    this.applyInsets();
    this.wake();
  }

  applyInsets() {
    const { w, h } = this.size || { w: 800, h: 450 };
    const ins = this.insets || { top: 0, right: 0, bottom: 0, left: 0 };
    const fw = Math.max(100, w - ins.left - ins.right), fh = Math.max(100, h - ins.top - ins.bottom);
    this.camera.aspect = w / h;
    // полный «виртуальный» кадр больше экрана так, чтобы его центр совпал с центром свободной области
    const fullW = w + Math.abs(ins.right - ins.left), fullH = h + Math.abs(ins.bottom - ins.top);
    const offX = ins.right > ins.left ? ins.right - ins.left : 0;
    const offY = ins.bottom > ins.top ? ins.bottom - ins.top : 0;
    if (fullW !== w || fullH !== h) this.camera.setViewOffset(fullW, fullH, offX, offY, w, h);
    else this.camera.clearViewOffset();
    this.freeAspect = fw / fh;
    this.freeFrac = Math.min(fw / w, fh / h);
    this.camera.updateProjectionMatrix();
  }

  // Подбор расстояния камеры, чтобы всё поле поместилось в свободную область
  fitDistance(dir, target) {
    const corners = [[-BW / 2, -BH / 2], [BW / 2, -BH / 2], [BW / 2, BH / 2], [-BW / 2, BH / 2]].map(([x, z]) => new THREE.Vector3(x, 0.3, z));
    const cam = this.camera.clone();
    const { w, h } = this.size || { w: 800, h: 450 };
    const ins = this.insets || { top: 0, right: 0, bottom: 0, left: 0 };
    const lim = (v) => {
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      return sx >= ins.left + 6 && sx <= w - ins.right - 6 && sy >= ins.top + 6 && sy <= h - ins.bottom - 6;
    };
    let lo = 8, hi = 90;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(dir).multiplyScalar(mid).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const fits = corners.every((c) => lim(c.clone().project(cam)));
      if (fits) hi = mid; else lo = mid;
    }
    return hi;
  }

  resetCamera(instant) {
    const target = new THREE.Vector3(0, 0, 0.6);
    const dir = new THREE.Vector3(0, 0.8, 0.6).normalize();
    const dist = this.fitDistance(dir, target);
    const pos = dir.clone().multiplyScalar(dist).add(target);
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
    } else {
      this.animateCamera(target, pos, 700);
    }
    this.wake();
  }

  animateCamera(target, pos, dur) {
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone();
    this.tween(dur, (k) => {
      const e = easeInOut(k);
      this.controls.target.lerpVectors(t0, target, e);
      this.camera.position.lerpVectors(p0, pos, e);
    });
  }

  focusCell(i, zoom) {
    const c = cellCenter(i);
    const w = toWorld(c.x, c.y);
    const target = new THREE.Vector3(w.x, 0, w.z);
    const off = this.camera.position.clone().sub(this.controls.target);
    if (zoom) off.setLength(zoom);
    this.animateCamera(target, target.clone().add(off), 600);
  }

  // ─────────── построение сцены ───────────

  buildTable() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 360);
    g.addColorStop(0, '#4a2f1f');
    g.addColorStop(1, '#22150d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < 90; k++) {
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(170, y + Math.random() * 20 - 10, 340, y + Math.random() * 20 - 10, 512, y + Math.random() * 10 - 5);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.01;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  buildBoard() {
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const big = maxTex >= 4096;
    const canvas = document.createElement('canvas');
    canvas.width = big ? 3072 : 2048;
    canvas.height = big ? 2048 : 1365;
    drawBoard(canvas);
    this.boardCanvas = canvas;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.boardTex = tex;

    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.0 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#7a5130', roughness: 0.6 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#c9a043', roughness: 0.35, metalness: 0.6 });
    // Основание поля
    const baseGeo = new THREE.BoxGeometry(BW, 0.2, BH);
    const base = new THREE.Mesh(baseGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    base.position.y = 0.1;
    base.receiveShadow = true;
    this.scene.add(base);
    this.base = base;
    // Обвязка
    const rim = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.7, 0.16, BH + 0.7), goldMat);
    rim.position.y = 0.04;
    this.scene.add(rim);

    // Клетки — приподнятые плитки с той же текстурой
    const tileMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    this.tiles = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const r = cellRect(i);
      const geo = new THREE.BoxGeometry(r.w - 0.12, TILE_H, r.h - 0.12);
      const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
      // UV = проекция на поле
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let k = 0; k < pos.count; k++) {
        const wx = pos.getX(k) + c.x, wz = pos.getZ(k) + c.z;
        const b = worldToBoard(wx, wz);
        uv.setXY(k, b.x / BW, b.y / BH);
      }
      uv.needsUpdate = true;
      const m = new THREE.Mesh(geo, tileMat);
      m.position.set(c.x, 0.2 + TILE_H / 2, c.z);
      m.receiveShadow = true;
      m.castShadow = true;
      m.userData.cell = i;
      this.scene.add(m);
      this.tiles.push(m);
    }
    // Стрелки переходов
    this.scene.add(this.makeArrow(35, 36, '#3d8bff'));
    this.scene.add(this.makeArrow(59, 0, '#ff3b3b'));
  }

  makeArrow(fromCell, toCell, color) {
    const a = cellRect(fromCell), b = cellRect(toCell);
    const up = toCell > fromCell; // 35→36: вверх
    const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2;
    const y1 = up ? a.y + a.h - 0.25 : a.y + 0.25;
    const y2 = up ? b.y + 0.25 : b.y + b.h - 0.25;
    const p1 = toWorld(x1, y1), p2 = toWorld(x2, y2);
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    const shape = new THREE.Shape();
    const sw = 0.14, hw = 0.36, hl = 0.5;
    shape.moveTo(0, -sw); shape.lineTo(len - hl, -sw); shape.lineTo(len - hl, -hw); shape.lineTo(len, 0);
    shape.lineTo(len - hl, hw); shape.lineTo(len - hl, sw); shape.lineTo(0, sw); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p1.x, TOP + 0.07, p1.z);
    m.rotation.y = -Math.atan2(dz, dx);
    m.castShadow = true;
    return m;
  }

  buildDecks() {
    this.decks = {};
    const spots = deckSpots();
    const mk = (title, color, icon) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 360;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 256, 360);
      ctx.strokeStyle = '#f5d27a';
      ctx.lineWidth = 10;
      ctx.strokeRect(12, 12, 232, 336);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = "120px 'Noto Color Emoji', sans-serif";
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, 128, 150);
      ctx.font = "bold 30px Roboto, 'DejaVu Sans', sans-serif";
      title.split('\n').forEach((t, k) => ctx.fillText(t, 128, 270 + k * 36));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const defs = [['surprise', 'ДЕЛОВОЙ\nСЛУЧАЙ', TYPE_STYLE.surprise.color, '⚡'], ['consult', 'КОНСУЛЬ-\nТАЦИЯ', TYPE_STYLE.consultation.color, '💡']];
    defs.forEach(([key, title, color, icon], k) => {
      const s = spots[k];
      const tex = mk(title, color, icon);
      const g = new THREE.Group();
      const side = new THREE.MeshStandardMaterial({ color: '#f2eee2' });
      const topM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
      for (let n = 0; n < 8; n++) {
        const card = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.92, 0.035, s.h * 0.92), [side, side, n === 7 ? topM : side, side, side, side]);
        card.position.y = 0.2 + 0.02 + n * 0.04;
        card.rotation.y = (Math.random() - 0.5) * 0.05;
        card.castShadow = true;
        g.add(card);
      }
      const w = toWorld(s.x, s.y);
      g.position.set(w.x, 0, w.z);
      this.scene.add(g);
      this.decks[key] = { group: g, tex, spot: s, topY: 0.2 + 0.02 + 8 * 0.04 };
    });
  }

  buildDice() {
    const faceTex = (n) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = n === 1 ? '#c62828' : '#1b1b25';
      const P = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]], 4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[30, 30], [98, 30], [64, 64], [30, 98], [98, 98]], 6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]] };
      for (const [x, y] of P[n]) { ctx.beginPath(); ctx.arc(x, y, n === 1 ? 17 : 12, 0, Math.PI * 2); ctx.fill(); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    // Порядок граней BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
    this.faceValues = [2, 5, 1, 6, 3, 4];
    const mats = this.faceValues.map((v) => new THREE.MeshStandardMaterial({ map: faceTex(v), roughness: 0.3 }));
    const geo = new RoundedBoxGeometry(0.9, 0.9, 0.9, 4, 0.13);
    this.dice = [0, 1].map((k) => {
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      const rest = this.diceRest(k);
      m.position.set(rest.x, TOP + 0.45 - TILE_H, rest.z);
      m.quaternion.copy(this.faceUpQuat(k ? 3 : 5, k * 0.4));
      this.scene.add(m);
      return m;
    });
  }

  diceRest(k) {
    const spots = deckSpots();
    const mid = (spots[0].x + spots[1].x) / 2;
    const x = mid + (k ? 0.7 : -0.7);
    const y = CENTER.y + 1.05;
    return toWorld(x, y);
  }

  faceUpQuat(value, yaw) {
    const normals = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    const idx = this.faceValues.indexOf(value);
    const q = new THREE.Quaternion().setFromUnitVectors(normals[idx], new THREE.Vector3(0, 1, 0));
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return qy.multiply(q);
  }

  buildHighlights() {
    const mk = (color, opacity) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.hlActive = mk('#ffffff', 0.28);
    this.hlTap = mk('#ffe27a', 0.45);
    // Маркер текущего игрока над фишкой
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 16), new THREE.MeshStandardMaterial({ color: '#ffd54a', emissive: '#ffb300', emissiveIntensity: 0.6 }));
    cone.rotation.x = Math.PI;
    cone.visible = false;
    this.scene.add(cone);
    this.turnCone = cone;
  }

  placeHighlight(mesh, i, pad = 0.0) {
    if (i === null || i === undefined || i < 0) { mesh.visible = false; this.wake(); return; }
    const r = cellRect(i);
    const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
    mesh.scale.set(r.w + pad, r.h + pad, 1);
    mesh.position.set(c.x, TOP + 0.012, c.z);
    mesh.visible = true;
    this.wake();
  }

  // ─────────── фишки ───────────

  makePawn(color) {
    const pts = [[0, 0], [0.34, 0], [0.35, 0.05], [0.3, 0.11], [0.2, 0.18], [0.15, 0.42], [0.12, 0.6], [0.21, 0.65], [0.21, 0.7], [0.1, 0.73], [0, 0.73]].map(([x, y]) => new THREE.Vector2(x, y));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.15 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), mat);
    head.position.y = 0.86;
    body.castShadow = head.castShadow = true;
    g.add(body, head);
    g.scale.setScalar(1.5);
    return g;
  }

  setPlayers(players) {
    for (const p of this.pawns.values()) this.scene.remove(p);
    this.pawns.clear();
    this.displayPos.clear();
    players.forEach((p) => {
      const pawn = this.makePawn(colorOf(p.color));
      this.scene.add(pawn);
      this.pawns.set(p.id, pawn);
      this.displayPos.set(p.id, p.pos);
    });
  }

  pawnSpot(pid, cell, positions) {
    const here = [...positions.entries()].filter(([id, pos]) => pos === cell && this.pawns.get(id)?.visible).map(([id]) => id).sort((a, b) => a - b);
    const n = Math.max(1, here.length);
    const k = Math.max(0, here.indexOf(pid));
    const layouts = {
      1: [[0, 0]], 2: [[-0.45, 0], [0.45, 0]], 3: [[-0.48, 0.25], [0.48, 0.25], [0, -0.38]],
      4: [[-0.46, 0.36], [0.46, 0.36], [-0.46, -0.36], [0.46, -0.36]],
      5: [[-0.7, 0.34], [0, 0.34], [0.7, 0.34], [-0.36, -0.38], [0.36, -0.38]],
      6: [[-0.7, 0.34], [0, 0.34], [0.7, 0.34], [-0.7, -0.38], [0, -0.38], [0.7, -0.38]],
    };
    const [dx, dy] = layouts[Math.min(6, n)][k] || [0, 0];
    const c = cellCenter(cell);
    const w = toWorld(c.x + dx, c.y + dy + 0.05);
    return new THREE.Vector3(w.x, TOP, w.z);
  }

  layoutPawns(except) {
    for (const [pid, pawn] of this.pawns) {
      if (pid === except || !pawn.visible) continue;
      const target = this.pawnSpot(pid, this.displayPos.get(pid), this.displayPos);
      if (pawn.position.distanceTo(target) > 0.01) {
        const from = pawn.position.clone();
        this.tween(250, (k) => pawn.position.lerpVectors(from, target, easeOut(k)));
      }
    }
  }

  // ─────────── анимации ───────────

  tween(dur, update, done) {
    return new Promise((resolve) => {
      this.tweens.push({ t0: performance.now(), dur: dur * (this.speed || 1), update, done: () => { done && done(); resolve(); } });
      this.wake();
    });
  }

  enqueue(fn) {
    this.queue.push(fn);
    if (!this.running) this.runQueue();
  }

  async runQueue() {
    this.running = true;
    while (this.queue.length) {
      const fn = this.queue.shift();
      try { await fn(); } catch (e) { console.error(e); }
    }
    this.running = false;
    if (this.state) this.syncStatic(this.state);
    const cbs = this.idleCallbacks;
    this.idleCallbacks = [];
    cbs.forEach((cb) => cb());
  }

  get busy() { return this.running || this.queue.length > 0; }
  whenIdle(cb) { if (!this.busy) cb(); else this.idleCallbacks.push(cb); }

  async animateDice(values) {
    sfx('dice');
    const starts = [new THREE.Vector3(-3, 3.5, 6), new THREE.Vector3(-2, 4, 6.8)];
    const promises = this.dice.map((die, k) => {
      const rest = this.diceRest(k);
      const end = new THREE.Vector3(rest.x + (Math.random() - 0.5) * 0.3, TOP + 0.45 - TILE_H, rest.z + (Math.random() - 0.5) * 0.3);
      const start = starts[k].clone().add(new THREE.Vector3(rest.x, 0, rest.z));
      const qEnd = this.faceUpQuat(values[k], Math.random() * Math.PI * 2);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spins = 3 + Math.random() * 2;
      return this.tween(1050 + k * 120, (t) => {
        const e = easeOut(t);
        die.position.lerpVectors(start, end, e);
        const bounce = Math.abs(Math.sin(t * Math.PI * 2.5)) * (1 - t) * 1.6;
        die.position.y = end.y + (1 - e) * (start.y - end.y) * 0.4 + bounce;
        const qs = new THREE.Quaternion().setFromAxisAngle(axis, (1 - e) * spins * Math.PI * 2);
        die.quaternion.copy(qEnd).premultiply(qs);
      });
    });
    await Promise.all(promises);
  }

  async animateMove(pid, from, steps) {
    const pawn = this.pawns.get(pid);
    if (!pawn) return;
    const dur = steps > 8 ? 170 : 210;
    let cur = from;
    for (let s = 0; s < steps; s++) {
      const next = (cur + 1) % BOARD_SIZE;
      const a = pawn.position.clone();
      this.displayPos.set(pid, next);
      const b = this.pawnSpot(pid, next, this.displayPos);
      if (this.follow && !this.userInteracting) this.followPoint(b, dur);
      await this.tween(dur, (t) => {
        pawn.position.lerpVectors(a, b, easeInOut(t));
        pawn.position.y = TOP + Math.sin(t * Math.PI) * 0.55;
      });
      sfx('step');
      cur = next;
    }
    this.displayPos.set(pid, cur);
    this.layoutPawns(pid);
  }

  followPoint(p, dur) {
    const target = this.controls.target;
    const desired = new THREE.Vector3(p.x * 0.55, 0, p.z * 0.55 + 0.6);
    const delta = desired.clone().sub(target);
    if (delta.length() < 0.05) return;
    const t0 = target.clone(), c0 = this.camera.position.clone();
    this.tween(dur * 1.2, (k) => {
      const e = easeOut(k);
      const d = delta.clone().multiplyScalar(e);
      this.controls.target.copy(t0).add(d);
      this.camera.position.copy(c0).add(d);
    });
  }

  async animateCard(deck) {
    const d = this.decks[deck];
    if (!d) return;
    sfx('card');
    const s = d.spot;
    const card = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.92, 0.035, s.h * 0.92), [null, null, null, null, null, null].map((_, k) => (k === 2 ? new THREE.MeshStandardMaterial({ map: d.tex }) : new THREE.MeshStandardMaterial({ color: '#f2eee2' }))));
    const w = toWorld(s.x, s.y);
    card.position.set(w.x, d.topY + 0.03, w.z);
    this.scene.add(card);
    const start = card.position.clone();
    const end = new THREE.Vector3(w.x, d.topY + 2.4, w.z + 1.2);
    await this.tween(650, (t) => {
      const e = easeOut(t);
      card.position.lerpVectors(start, end, e);
      card.rotation.x = -e * 1.1;
    });
    await this.tween(300, (t) => { card.material.forEach((m) => { m.transparent = true; m.opacity = 1 - t; }); });
    this.scene.remove(card);
  }

  floatText(pid, text, color) {
    const pawn = this.pawns.get(pid);
    if (!pawn) return;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = "bold 72px Roboto, 'DejaVu Sans', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(3.2, 0.8, 1);
    sp.renderOrder = 10;
    const p0 = pawn.position.clone().add(new THREE.Vector3(0, 1.8, 0));
    sp.position.copy(p0);
    this.floatGroup.add(sp);
    this.tween(1700, (t) => {
      sp.position.y = p0.y + t * 1.4;
      sp.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }, () => { this.floatGroup.remove(sp); tex.dispose(); sp.material.dispose(); });
  }

  // ─────────── синхронизация с состоянием игры ───────────

  clearGame() {
    this.state = null;
    this.queue = [];
    for (const p of this.pawns.values()) this.scene.remove(p);
    this.pawns.clear();
    this.displayPos.clear();
    while (this.markerGroup.children.length) this.markerGroup.remove(this.markerGroup.children[0]);
    this.hlActive.visible = false;
    this.hlTap.visible = false;
    this.turnCone.visible = false;
    this.wake();
  }

  // Вызывается при каждом новом состоянии. Анимирует новые события.
  update(state) {
    const first = !this.state || this.state.id !== state.id;
    this.state = state;
    if (first) {
      this.setPlayers(state.players);
      this.lastSeq = state.seq;
      this.lastCash = state.players.map((p) => p.cash);
      for (const p of state.players) this.displayPos.set(p.id, p.pos);
      this.syncStatic(state);
      for (const [pid, pawn] of this.pawns) pawn.position.copy(this.pawnSpot(pid, this.displayPos.get(pid), this.displayPos));
      return;
    }
    const events = state.events.filter((e) => e.s > this.lastSeq);
    this.lastSeq = state.seq;
    const prevCash = this.lastCash;
    this.lastCash = state.players.map((p) => p.cash);
    for (const e of events) {
      if (e.type === 'dice') this.enqueue(() => this.animateDice(e.dice));
      else if (e.type === 'move') this.enqueue(() => this.animateMove(e.pid, e.from, e.steps));
      else if (e.type === 'card') this.enqueue(() => this.animateCard(e.deck));
      else if (e.type === 'enterprise') this.enqueue(async () => { sfx('fanfare'); });
    }
    this.enqueue(async () => {
      if (prevCash) state.players.forEach((p, i) => {
        const d = p.cash - (prevCash[i] ?? p.cash);
        if (d) { this.floatText(p.id, (d > 0 ? '+' : '−') + Math.abs(d).toLocaleString('ru-RU'), d > 0 ? '#7CFF8A' : '#FF8A80'); if (d > 0) sfx('coin'); }
      });
    });
    if (!this.busy) this.syncStatic(state);
  }

  // Маркеры, подсветка — то, что не анимируется
  syncStatic(state) {
    const g = this.markerGroup;
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    }
    const matCache = {};
    const mat = (hex) => (matCache[hex] ||= new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35, metalness: 0.1 }));
    const pColor = (pid) => colorOf(state.players[pid].color);
    // Акции
    const discGeo = this._discGeo ||= new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24);
    for (const k of COMPANY_KEYS) {
      const cell = COMPANIES[k].cell;
      state.shares[k].forEach((o, slot) => {
        if (o === null) return;
        const m = new THREE.Mesh(discGeo, mat(pColor(o)));
        m.userData.shared = true;
        const p = cellPoint(cell, 0.27 + slot * 0.23, 0.14);
        m.position.set(p.x, TOP + 0.06, p.z);
        m.castShadow = true;
        g.add(m);
      });
    }
    // Участки: флажки владельцев, ход строительства, построенные заводы
    const poleGeo = this._poleGeo ||= new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
    const flagGeo = this._flagGeo ||= new THREE.BoxGeometry(0.42, 0.26, 0.03);
    const slotGeo = this._slotGeo ||= new THREE.BoxGeometry(0.34, 0.09, 0.34);
    const ghost = this._ghost ||= new THREE.MeshStandardMaterial({ color: '#888', transparent: true, opacity: 0.25 });
    for (const L of state.lands) {
      const cell = LAND_CELL[L.no];
      if (L.owner !== null) {
        const fl = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, mat('#dddddd'));
        pole.userData.shared = true;
        pole.position.y = 0.45;
        const flag = new THREE.Mesh(flagGeo, mat(pColor(L.owner)));
        flag.userData.shared = true;
        flag.position.set(0.22, 0.76, 0);
        pole.castShadow = flag.castShadow = true;
        fl.add(pole, flag);
        const p = cellPoint(cell, 0.84, 0.78);
        fl.position.set(p.x, TOP, p.z);
        g.add(fl);
      }
      if (L.ent.lic) {
        const parts = [['lic', INDUSTRY[L.ent.lic].color], ['mat', '#8d6e63'], ['eq', '#607d8b'], ['pers', '#ffb74d']];
        parts.forEach(([k, col], n) => {
          const has = k === 'lic' ? true : L.ent[k];
          const m = new THREE.Mesh(slotGeo, has ? mat(col) : ghost);
          m.userData.shared = true;
          const p = cellPoint(cell, 0.2 + n * 0.2, 0.12);
          m.position.set(p.x, TOP + 0.05, p.z);
          m.castShadow = has;
          g.add(m);
        });
      }
    }
    // Видимость выбывших
    for (const p of state.players) {
      const pawn = this.pawns.get(p.id);
      if (pawn) pawn.visible = !p.bankrupt;
    }
    if (!this.busy) {
      for (const p of state.players) this.displayPos.set(p.id, p.pos);
      this.layoutPawns();
    }
    // Подсветка клетки текущего игрока
    if (!state.over) {
      const cur = state.players[state.cur];
      this.placeHighlight(this.hlActive, cur.pos, 0.2);
      this.hlActive.material.color.set(colorOf(cur.color));
      this.activePid = cur.id;
      this.turnCone.visible = true;
    } else {
      this.hlActive.visible = false;
      this.turnCone.visible = false;
    }
    this.wake();
  }

  // ─────────── выбор клетки касанием ───────────

  setupPicking() {
    const ray = new THREE.Raycaster();
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 10 || dt > 500) return;
      const rect = this.canvas.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
      const hits = ray.intersectObjects([...this.tiles, this.base], false);
      if (!hits.length) { this.onCellTap(-1); return; }
      const b = worldToBoard(hits[0].point.x, hits[0].point.z);
      this.onCellTap(cellAt(b.x, b.y));
    });
  }

  // ─────────── цикл отрисовки ───────────

  loop() {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.tweens.length) {
      const keep = [];
      for (const tw of this.tweens) {
        const k = Math.min(1, (now - tw.t0) / tw.dur);
        tw.update(k);
        if (k >= 1) tw.done(); else keep.push(tw);
      }
      this.tweens = keep;
      this.wake(5);
    }
    if (this.turnCone.visible && this.activePid !== undefined) {
      const pawn = this.pawns.get(this.activePid);
      if (pawn) {
        this.turnCone.position.set(pawn.position.x, pawn.position.y + 2.05 + Math.sin(now / 300) * 0.12, pawn.position.z);
        this.turnCone.rotation.y = now / 600;
        // лёгкая анимация маркера хода — не чаще ~20 кадров/с, чтобы беречь батарею
        this._idleTick = (this._idleTick || 0) + 1;
        if (this._idleTick % 3 === 0) this.framesLeft = Math.max(this.framesLeft, 1);
      }
    }
    const changed = this.controls.update();
    if (changed) this.wake(5);
    if (this.framesLeft <= 0 || document.hidden) return;
    this.framesLeft--;
    this.renderer.render(this.scene, this.camera);
  }
}
