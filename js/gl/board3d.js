// FRACTION CHESS — WebGL-поле боя (three.js r170).
// Получает от ui.js модель клеток (FC.GL.render) и отдаёт обратно клики/наведение (FC.UI.click / hover / deselect).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { OrbitControls } from '../vendor/OrbitControls.js';

const FC = window.FC;
const MOBILE = matchMedia('(pointer: coarse)').matches;   // сенсорный экран (телефон/планшет)

/* ---------- разметка доски диорамы (координаты Blender: Z вверх) ----------
   Диорама собрана tools/make_board8.py: болото Meshy + модельная доска 8×8 из квадратных плиток.
   Значения — из models/boards/swamp.glb.json. */
const BOARD = {
  X0: -0.4434, CW: 0.11036,        // левая граница колонки a и ширина клетки
  Y0: -0.58601, RH: 0.11036,       // нижняя граница ряда 1 (сторона белых, −Y) и высота клетки
  ZS: -0.1056,                     // высота верха плиток
};
BOARD.CX = BOARD.X0 + 4 * BOARD.CW;                       // центр игровой области
BOARD.CY = BOARD.Y0 + 4 * BOARD.RH;
const S = 1 / ((BOARD.CW + BOARD.RH) / 2);                // масштаб: средняя клетка = 1
const CELL_W = BOARD.CW * S, CELL_H = BOARD.RH * S;
const cellPos = (gx, gy) => new THREE.Vector3(
  (BOARD.X0 + (gx + 0.5) * BOARD.CW - BOARD.CX) * S, 0,
  -(BOARD.Y0 + (gy + 0.5) * BOARD.RH - BOARD.CY) * S);
function worldToCell(p) {
  const bx = p.x / S + BOARD.CX, by = -p.z / S + BOARD.CY;
  const gx = Math.floor((bx - BOARD.X0) / BOARD.CW), gy = Math.floor((by - BOARD.Y0) / BOARD.RH);
  return gx >= 0 && gx < 8 && gy >= 0 && gy < 8 ? [gx, gy] : null;
}

/* ---------- модели фигур ---------- */
const MODEL_FOR = {
  skeleton: 'undead/skeleton', skeleton_mage: 'undead/skeleton', skeleton_warrior: 'undead/skeleton',
  lich: 'undead/lich', phylactery: 'undead/phylactery', graveyard: 'undead/graveyard',
  soul_eater: 'undead/soul_eater', death_knight: 'undead/death_knight',
};
const HEIGHT = { pawn: 1.15, knight: 1.4, bishop: 1.4, rook: 1.45, queen: 1.7, king: 1.75 };
const OWNER_COLOR = [0xefe8d8, 0x1d2029];

let renderer, scene, camera, controls, clock, raycaster, pointer;
let boardGroup, piecesGroup, hlGroup, fxGroup, pickPlane, hoverMark;
const models = {};                 // путь → { scene, size }
const pieces = new Map();          // id фигуры → { obj, x, y, type, owner, stat }
const anims = [];                  // активные анимации
let ready = false, pendingModel = null, lastTurn = null;

/* ---------- старт ---------- */
function init() {
  const host = document.getElementById('glhost');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));   // телефон: меньше пикселей — плавнее и холоднее
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c12);
  scene.fog = new THREE.FogExp2(0x0a0c12, 0.028);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 6; controls.maxDistance = 24; controls.maxPolarAngle = 1.42;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };   // палец — вращать, щипок — масштаб

  // свет: лунный направленный + небо/земля + тёплые свечи на диораме
  scene.add(new THREE.HemisphereLight(0x8193c4, 0x1b140c, 1.5));
  const moon = new THREE.DirectionalLight(0xd2e0ff, 3.0);
  moon.position.set(6, 13, 9); moon.castShadow = true;
  moon.shadow.mapSize.setScalar(MOBILE ? 1024 : 2048);
  Object.assign(moon.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  moon.shadow.bias = -0.0004;
  scene.add(moon);
  const rim = new THREE.DirectionalLight(0x7cff9a, 0.6); rim.position.set(-8, 5, -9); scene.add(rim);
  for (const [bx, by] of [[-0.371, 0.389], [0.367, 0.395]]) {
    const l = new THREE.PointLight(0xffa64d, 6, 7, 2);
    l.position.set((bx - BOARD.CX) * S, 1.2, -(by - BOARD.CY) * S);
    scene.add(l);
  }

  boardGroup = new THREE.Group(); piecesGroup = new THREE.Group(); hlGroup = new THREE.Group(); fxGroup = new THREE.Group();
  scene.add(boardGroup, piecesGroup, hlGroup, fxGroup);

  // земля под диорамой и невидимая плоскость для кликов
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1.05; ground.receiveShadow = true; scene.add(ground);
  pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2; scene.add(pickPlane);
  hoverMark = cellFrame(0xffffff, 0.35); hoverMark.visible = false; scene.add(hoverMark);

  addFireflies();
  addLabels();
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
  clock = new THREE.Clock();
  bindInput();
  bindCameraUI();
  new ResizeObserver(resize).observe(host); resize();
  setView(true);
  renderer.setAnimationLoop(tick);
  loadAssets();
}

function resize() {
  const host = renderer.domElement.parentElement;
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = camera.aspect > 1.4 ? 38 + Math.min(10, (camera.aspect - 1.4) * 20) : 38;   // широкий низкий экран (телефон) — шире угол, чтобы доска влезла по высоте
  camera.updateProjectionMatrix();
}

/* ---------- загрузка моделей ---------- */
function loadAssets() {
  const status = document.getElementById('glstatus');
  const loader = new GLTFLoader();
  const paths = ['boards/swamp', ...new Set(Object.values(MODEL_FOR))];
  let done = 0;
  const one = p => new Promise(res => loader.load(`models/${p}.glb`, g => {
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    models[p] = { scene: root, size };
    status.textContent = `Загрузка 3D-моделей… ${++done}/${paths.length}`;
    res(true);
  }, undefined, () => { status.textContent = `Не удалось загрузить models/${p}.glb`; res(false); }));
  Promise.all(paths.map(one)).then(ok => {
    if (!ok[0]) proceduralBoard(); else placeDiorama();
    ready = true;
    status.classList.add('hidden');
    if (location.protocol === 'file:') {
      status.classList.remove('hidden');
      status.textContent = 'Для 3D-моделей откройте игру через FractionChess.exe (или serve.ps1) — браузер не загружает модели с file://';
    }
    if (pendingModel) render(pendingModel);
  });
}
function placeDiorama() {
  const d = models['boards/swamp'].scene;
  d.scale.setScalar(S);
  d.position.set(-BOARD.CX * S, -BOARD.ZS * S, BOARD.CY * S);
  d.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
  boardGroup.add(d);
}
function proceduralBoard() {   // запасной вариант без диорамы
  const g = new THREE.BoxGeometry(CELL_W, 0.2, CELL_H);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: (x + y) % 2 ? 0x8f7a5c : 0x3b3026, roughness: 0.8 }));
    m.position.copy(cellPos(x, y)); m.position.y = -0.1; m.receiveShadow = true; boardGroup.add(m);
  }
}

/* ---------- фигуры ---------- */
function textSprite(text, color, bg, size = 128, scale = 0.5) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(size * (text.length > 2 ? 0.34 : 0.55))}px "Segoe UI Symbol","Segoe UI Emoji",sans-serif`;
  g.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.setScalar(scale); s.renderOrder = 5;
  return s;
}
function baseRing(owner, faction) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.46, 0.08, 40),
    new THREE.MeshStandardMaterial({ color: OWNER_COLOR[owner], roughness: 0.45, metalness: 0.3 }));
  disc.position.y = 0.04; disc.castShadow = disc.receiveShadow = true;
  const fc = new THREE.Color(FC.FACTIONS[faction].color);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.445, 0.025, 8, 48),
    new THREE.MeshStandardMaterial({ color: fc, emissive: fc, emissiveIntensity: 1.2 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.085;
  g.add(disc, rim);
  return g;
}
const LATHE = {
  pawn: [[0, 0], [0.3, 0], [0.28, 0.1], [0.14, 0.18], [0.12, 0.5], [0.2, 0.6], [0.16, 0.78], [0, 0.85]],
  knight: [[0, 0], [0.34, 0], [0.3, 0.12], [0.16, 0.25], [0.15, 0.8], [0.26, 0.95], [0.12, 1.1], [0, 1.12]],
  bishop: [[0, 0], [0.34, 0], [0.3, 0.12], [0.15, 0.25], [0.13, 0.85], [0.22, 1.0], [0.08, 1.2], [0, 1.25]],
  rook: [[0, 0], [0.36, 0], [0.32, 0.12], [0.22, 0.25], [0.22, 0.85], [0.32, 0.9], [0.32, 1.12], [0, 1.12]],
  queen: [[0, 0], [0.37, 0], [0.33, 0.13], [0.16, 0.3], [0.13, 1.05], [0.3, 1.25], [0.18, 1.38], [0, 1.45]],
  king: [[0, 0], [0.38, 0], [0.34, 0.13], [0.17, 0.3], [0.14, 1.1], [0.3, 1.3], [0.12, 1.42], [0.06, 1.62], [0, 1.65]],
};
function makePiece(p, def) {
  const root = new THREE.Group();
  root.add(baseRing(p.owner, def.faction));
  const path = MODEL_FOR[p.type], m = path && models[path];
  let top;
  if (m) {
    const inst = m.scene.clone(true);
    const h = HEIGHT[def.cls] || 1.4;
    let k = h / m.size.y;
    const wide = Math.max(m.size.x, m.size.z) * k;
    if (wide > 0.92) k *= 0.92 / wide;
    inst.scale.setScalar(k);
    inst.position.y = 0.08;
    inst.rotation.y = p.owner === 0 ? Math.PI : 0;     // фигуры смотрят на соперника
    root.add(inst);
    top = m.size.y * k + 0.15;
  } else {
    const pts = LATHE[def.cls].map(([r, y]) => new THREE.Vector2(r, y * (HEIGHT[def.cls] / 1.6)));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({
      color: OWNER_COLOR[p.owner], roughness: 0.35, metalness: 0.25,
      emissive: new THREE.Color(FC.FACTIONS[def.faction].color), emissiveIntensity: 0.08 }));
    body.position.y = 0.08; body.castShadow = body.receiveShadow = true;
    root.add(body);
    top = pts[pts.length - 1].y + 0.1;
    const glyph = textSprite(FC.GLYPH[def.cls], p.owner ? '#f3f4f6' : '#111827', FC.FACTIONS[def.faction].color, 128, 0.42);
    glyph.position.y = top + 0.25; root.add(glyph);
    top += 0.5;
  }
  root.userData.top = top;
  root.userData.pid = p.id;
  root.traverse(o => { o.userData.pid = p.id; });
  return root;
}
function statusText(p) {
  return (p.cooldown > 0 ? '⏳' : '') + (p.bloodlust > 0 ? '🩸' : '') + (p.cursedTtl > 0 ? '☠' : '') + (p.stolen ? '🎭' : '');
}

/* ---------- подсветка ---------- */
const HL_COLOR = { move: 0x22c55e, capture: 0xef4444, ranged: 0xf97316, summon: 0xa855f7, revive: 0x14b8a6,
  convert: 0xc084fc, special: 0x3b82f6, pending: 0xfbbf24, block: 0x6b7280 };
const matCache = {};
const hlMat = (color, opacity = 0.85) => matCache[color + ':' + opacity] = matCache[color + ':' + opacity] ||
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
function flat(geo, mat, y = 0.03) { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 3; return m; }
function cellFrame(color, opacity = 0.9) {
  const g = new THREE.Group(), t = 0.06, w = CELL_W * 0.94, h = CELL_H * 0.94, m = hlMat(color, opacity);
  for (const [sx, sz, px, pz] of [[w, t, 0, h / 2], [w, t, 0, -h / 2], [t, h, w / 2, 0], [t, h, -w / 2, 0]]) {
    const b = flat(new THREE.PlaneGeometry(sx, sz), m, 0.035); b.position.x = px; b.position.z = pz; g.add(b);
  }
  return g;
}
// мигающая подсветка — со своими копиями материалов, чтобы не мигали остальные
function makePulse(g) {
  g.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.userData.base = o.material.opacity; } });
  g.userData.pulse = true;
  return g;
}
function highlight(c) {
  const g = new THREE.Group(), hl = c.hl, col = HL_COLOR[hl.k] || 0xffffff;
  const op = hl.ghost ? 0.5 : 0.9, m = hlMat(col, op), occ = !!c.p;
  switch (hl.k) {
    case 'move': g.add(flat(new THREE.CircleGeometry(0.24, 32), m), flat(new THREE.RingGeometry(0.3, 0.34, 40), hlMat(col, op * 0.6))); break;
    case 'capture': g.add(flat(new THREE.RingGeometry(0.4, 0.5, 40), m)); break;
    case 'ranged':
      for (let i = 0; i < 8; i++) g.add(flat(new THREE.RingGeometry(0.4, 0.5, 6, 1, i * Math.PI / 4, Math.PI / 6), m));
      if (!occ) g.add(flat(new THREE.CircleGeometry(0.1, 16), m));
      break;
    case 'convert': g.add(flat(new THREE.RingGeometry(0.38, 0.44, 40), m), flat(new THREE.RingGeometry(0.48, 0.52, 40), m)); break;
    case 'special': { const d = flat(new THREE.PlaneGeometry(0.3, 0.3), m); d.rotation.z = Math.PI / 4; g.add(occ ? flat(new THREE.RingGeometry(0.4, 0.5, 4, 1, Math.PI / 4), m) : d); break; }
    case 'summon': case 'revive': g.add(flat(new THREE.PlaneGeometry(CELL_W * 0.6, CELL_H * 0.6), hlMat(col, hl.ghost ? 0.3 : 0.55))); break;
    case 'pending': g.add(cellFrame(col, 1), flat(new THREE.PlaneGeometry(CELL_W * 0.9, CELL_H * 0.9), hlMat(col, 0.25))); break;
  }
  if (hl.stolen) g.add(flat(new THREE.RingGeometry(0.54, 0.58, 40), hlMat(0xec4899, 0.9)));
  if (hl.ghost || hl.k === 'pending') makePulse(g);
  return g;
}

/* ---------- отрисовка состояния ---------- */
function render(model) {
  if (!ready) { pendingModel = model; return; }
  pendingModel = null;
  const seen = new Set();
  for (const c of model.cells) {
    if (!c.p) continue;
    const p = c.p; seen.add(p.id);
    let e = pieces.get(p.id);
    if (e && (e.type !== p.type || e.owner !== p.owner)) { piecesGroup.remove(e.obj); pieces.delete(p.id); e = null; }
    const target = cellPos(c.x, c.y);
    if (!e) {
      const obj = makePiece(p, c.def);
      obj.position.copy(target);
      piecesGroup.add(obj);
      e = { obj, x: c.x, y: c.y, type: p.type, owner: p.owner, stat: '' };
      pieces.set(p.id, e);
      if (lastTurn !== null) { obj.scale.setScalar(0.01); anims.push({ t: 0, dur: 0.35, f: k => obj.scale.setScalar(Math.max(0.01, easeOut(k))) }); }
    } else if (e.x !== c.x || e.y !== c.y) {
      const from = e.obj.position.clone();
      if (model.mover && model.mover.pid === p.id) {
        const obj = e.obj;
        anims.push({ obj, t: 0, dur: 0.45, f: k => { const q = easeInOut(k); obj.position.lerpVectors(from, target, q); obj.position.y = Math.sin(q * Math.PI) * 0.7; } });
      } else e.obj.position.copy(target);
      e.x = c.x; e.y = c.y;
    }
    // статусы и приподнятая выбранная фигура
    const st = statusText(p);
    if (st !== e.stat) {
      if (e.statSprite) e.obj.remove(e.statSprite);
      e.statSprite = st ? textSprite(st, '#fff', 'rgba(0,0,0,0.55)', 128, 0.42) : null;
      if (e.statSprite) { e.statSprite.position.y = e.obj.userData.top + 0.2; e.obj.add(e.statSprite); }
      e.stat = st;
    }
    e.lifted = !!(model.sel && model.sel.x === c.x && model.sel.y === c.y);
    e.threatened = c.threatened;
  }
  for (const [id, e] of pieces) if (!seen.has(id)) {
    const obj = e.obj; pieces.delete(id);
    anims.push({ obj, t: 0, dur: 0.3, f: k => { obj.scale.setScalar(Math.max(0.01, 1 - k)); obj.position.y = -k * 0.5; }, end: () => piecesGroup.remove(obj) });
  }

  // подсветка клеток (старые геометрии освобождаем)
  hlGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData.base != null) o.material.dispose(); });
  hlGroup.clear();
  for (const c of model.cells) {
    const pos = cellPos(c.x, c.y);
    const add = o => { o.position.x += pos.x; o.position.z += pos.z; hlGroup.add(o); };
    if (c.cursed) add(flat(new THREE.PlaneGeometry(CELL_W * 0.96, CELL_H * 0.96), hlMat(0x6d28d9, 0.35), 0.02));
    if (c.hl) add(highlight(c));
    if (c.block) { for (const r of [Math.PI / 4, -Math.PI / 4]) { const b = flat(new THREE.PlaneGeometry(0.7, 0.09), hlMat(HL_COLOR.block, 0.9)); b.rotation.z = r; add(b); } }
    if (c.threatened) add(makePulse(flat(new THREE.RingGeometry(0.5, 0.6, 40), hlMat(0xef4444, 0.9), 0.1)));
    if (c.boom) boom(pos);
  }
  if (model.sel) {
    const f = cellFrame(model.sel.mode === 'special' ? 0x22d3ee : 0xfacc15, 1);
    const pos = cellPos(model.sel.x, model.sel.y); f.position.x = pos.x; f.position.z = pos.z; hlGroup.add(f);
  }
  if (model.turn !== lastTurn) { lastTurn = model.turn; setView(); }
}
function boom(pos) {
  const r = flat(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.06);
  r.position.x = pos.x; r.position.z = pos.z; fxGroup.add(r);
  anims.push({ t: 0, dur: 0.7, f: k => { r.scale.setScalar(0.4 + k * 1.6); r.material.opacity = 1 - k; }, end: () => fxGroup.remove(r) });
}

/* ---------- кадр ---------- */
const easeOut = k => 1 - Math.pow(1 - k, 3);
const easeInOut = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
let fireflies;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += dt; const k = Math.min(1, a.t / a.dur); a.f(k);
    if (k >= 1) { anims.splice(i, 1); if (a.end) a.end(); }
  }
  for (const e of pieces.values()) {
    const goal = e.lifted ? 0.18 : 0;
    if (!anims.some(a => a.obj === e.obj)) e.obj.position.y += (goal - e.obj.position.y) * Math.min(1, dt * 10);
  }
  const pulse = 0.55 + 0.45 * Math.sin(t * 5);
  hlGroup.traverse(o => { if (o.material && o.material.userData.base != null) o.material.opacity = o.material.userData.base * pulse; });
  if (fireflies) {
    const a = fireflies.geometry.attributes.position, seed = fireflies.userData.seed;
    for (let i = 0; i < a.count; i++) a.setY(i, seed[i * 3 + 1] + Math.sin(t * 0.8 + seed[i * 3]) * 0.4);
    a.needsUpdate = true; fireflies.rotation.y = t * 0.02;
  }
  camTween(dt);
  controls.update();
  renderer.render(scene, camera);
}

/* ---------- атмосфера ---------- */
function addFireflies() {
  const n = 70, pos = new Float32Array(n * 3), seed = [];
  for (let i = 0; i < n; i++) {
    const r = 6 + Math.random() * 9, a = Math.random() * Math.PI * 2, y = 0.3 + Math.random() * 3.5;
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3); seed.push(Math.random() * 10, y, 0);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9dff7a, size: 0.09, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  fireflies.userData.seed = seed; scene.add(fireflies);
}
function addLabels() {
  for (let i = 0; i < 8; i++) {
    const f = textSprite('abcdefgh'[i], '#d6c9a8', null, 64, 0.32); f.position.copy(cellPos(i, -0.62)); f.position.y = 0.15; scene.add(f);
    const r = textSprite(String(i + 1), '#d6c9a8', null, 64, 0.32); r.position.copy(cellPos(-0.62, i)); r.position.y = 0.15; scene.add(r);
  }
}

/* ---------- ввод ---------- */
function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitP = raycaster.intersectObjects(piecesGroup.children, true)[0];
  if (hitP && hitP.object.userData.pid != null) {
    for (const [id, e] of pieces) if (id === hitP.object.userData.pid) return [e.x, e.y];
  }
  const hit = raycaster.intersectObject(pickPlane)[0];
  return hit ? worldToCell(hit.point) : null;
}
function bindInput() {
  const el = renderer.domElement;
  let down = null;
  let touches = 0;                   // сколько пальцев на экране: щипок (2 пальца) — не нажатие
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') touches++;
    down = touches > 1 ? null : { x: e.clientX, y: e.clientY, b: e.button, t: performance.now(), touch: e.pointerType === 'touch' };
  });
  const lift = e => { if (e.pointerType === 'touch') touches = Math.max(0, touches - 1); };
  el.addEventListener('pointercancel', e => { lift(e); down = null; });
  el.addEventListener('pointerup', e => {
    lift(e);
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.touch ? 12 : 6);
    if (!moved && down.b === 0) {
      const c = pick(e);
      if (c) {
        if (down.touch) { const p = cellPos(c[0], c[1]); hoverMark.position.set(p.x, 0, p.z); hoverMark.visible = true; }
        FC.UI.click(c[0], c[1]);
      } else if (down.touch) FC.UI.deselect();     // тап мимо доски — снять выбор (на телефоне нет правой кнопки)
    }
    down = null;
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); FC.UI.deselect(); });
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;          // на сенсорном экране нет наведения
    if (e.buttons) { FC.UI.hover(null); hoverMark.visible = false; return; }
    const c = pick(e);
    if (c) { const p = cellPos(c[0], c[1]); hoverMark.position.set(p.x, 0, p.z); hoverMark.visible = true; FC.UI.hover(c[0], c[1], e.clientX, e.clientY); }
    else { hoverMark.visible = false; FC.UI.hover(null); }
  });
  el.addEventListener('pointerleave', () => { hoverMark.visible = false; FC.UI.hover(null); });
}

/* ---------- камера ---------- */
const PRESETS = { iso: { polar: 0.95, az: Math.PI / 4, dist: 14 }, angled: { polar: 0.72, az: 0, dist: 13 }, top: { polar: 0.02, az: 0, dist: 15 } };
let preset = 'iso', rot = 0, follow = true, tween = null;
function viewSide() {
  const G = FC.UI.G, ai = FC.UI.ai || [false, false];
  if (!follow || !G) return 0;
  if (ai[0] !== ai[1]) return ai[0] ? 1 : 0;
  return G.turn;
}
function setView(instant) {
  const p = PRESETS[preset];
  const goal = { polar: p.polar, az: p.az + rot + viewSide() * Math.PI, dist: p.dist };
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  if (instant || !camera.position.lengthSq()) {
    camera.position.setFromSpherical(new THREE.Spherical(goal.dist, goal.polar, goal.az)); return;
  }
  let daz = goal.az - sph.theta; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
  tween = { t: 0, dur: 0.9, from: { polar: sph.phi, az: sph.theta, dist: sph.radius }, to: { polar: goal.polar, az: sph.theta + daz, dist: goal.dist } };
}
function camTween(dt) {
  if (!tween) return;
  tween.t += dt; const k = easeInOut(Math.min(1, tween.t / tween.dur)), f = tween.from, g = tween.to;
  camera.position.setFromSpherical(new THREE.Spherical(f.dist + (g.dist - f.dist) * k, f.polar + (g.polar - f.polar) * k, f.az + (g.az - f.az) * k));
  if (k >= 1) tween = null;
}
function bindCameraUI() {
  for (const b of document.querySelectorAll('#camctl [data-preset]')) b.onclick = () => {
    preset = b.dataset.preset; rot = 0;
    for (const o of document.querySelectorAll('#camctl [data-preset]')) o.classList.toggle('on', o === b);
    setView();
  };
  const turn = d => { rot += d; setView(); };
  const zoom = f => { const p = PRESETS[preset]; p.dist = Math.min(24, Math.max(6, p.dist * f)); setView(); };
  document.getElementById('rotL').onclick = () => turn(-Math.PI / 2);
  document.getElementById('rotR').onclick = () => turn(Math.PI / 2);
  document.getElementById('zoomIn').onclick = () => zoom(1 / 1.15);
  document.getElementById('zoomOut').onclick = () => zoom(1.15);
  document.getElementById('follow').onchange = e => { follow = e.target.checked; setView(); };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || /INPUT|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'й') turn(-Math.PI / 2); else if (k === 'e' || k === 'у') turn(Math.PI / 2);
    else if (k === '+' || k === '=') zoom(1 / 1.15); else if (k === '-') zoom(1.15);
    else if ('123'.includes(k) && k) document.querySelectorAll('#camctl [data-preset]')[+k - 1].click();
  });
}

FC.GL = { render };
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init); else init();
