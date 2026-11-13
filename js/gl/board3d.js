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
/* Доски: болото (по умолчанию) и адская доска Демонов (tools/convert_board.py, поворот 90° — a1 тёмная).
   X0/CW — левая граница колонки a и ширина клетки; Y0/RH — нижняя граница ряда 1 (сторона белых, −Y) и высота клетки;
   ZS — высота верха светлых плиток; ZD — насколько ниже тёмные плитки (у демонов они утоплены).
   lights — точечные источники [x, y (Blender), цвет, сила]; rim — контровой свет; fog — цвет тумана; flies — цвет искр. */
const BOARDS = {
  swamp: { path: 'boards/swamp', X0: -0.4434, CW: 0.11036, Y0: -0.58601, RH: 0.11036, ZS: -0.1056, ZD: 0,
    lights: [[-0.371, 0.389, 0xffa64d, 6], [0.367, 0.395, 0xffa64d, 6]], rim: 0x7cff9a, fog: 0x0a0c12, flies: 0x9dff7a, own: 'north' },
  demons: { path: 'boards/demons', X0: -0.664, CW: 0.1663, Y0: -0.592, RH: 0.154, ZS: -0.1592, ZD: -0.0296,
    lights: [[-0.8, 0.5, 0xff5a1f, 9], [0.62, -0.72, 0xff3b1f, 9], [0.27, -0.78, 0xff7a2a, 6], [0.75, 0.75, 0xff4020, 5]],
    rim: 0xff4a2a, fog: 0x120707, flies: 0xff8a3a, own: 'south' },
};
// у какой фракции какая доска (остальные — болото)
const FACTION_BOARD = { demons: 'demons', undead: 'swamp' };
for (const b of Object.values(BOARDS)) { b.CX = b.X0 + 4 * b.CW; b.CY = b.Y0 + 4 * b.RH; }
/* Игровое поле общее для обеих половин: клетка 1×1, центр доски в (0,0); ряды 1–4 (белые) — z > 0, ряды 5–8 — z < 0.
   Каждая диорама масштабируется так, чтобы её клетки совпали с этой сеткой, и обрезается по середине доски. */
const CELL_W = 1, CELL_H = 1;
let halves = [null, null];          // ключи досок: [половина белых, половина чёрных]
// захваченные клетки: 'x,y' → ключ доски, в дизайн которой клетка перекрашена (фигура чужой фракции встала на неё)
const conv = new Map();
const TILE_TOP = 0.004;            // верх плитки-«заплатки» захваченной клетки
// высота клетки: на демонической половине тёмные плитки утоплены
const cellY = (gx, gy) => {
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return 0;
  if (conv.has(gx + ',' + gy)) return TILE_TOP;
  if ((gx + gy) % 2 !== 0) return 0;
  const b = BOARDS[halves[gy < 4 ? 0 : 1] || 'swamp'];
  return b.ZD / b.RH;
};
const cellPos = (gx, gy) => new THREE.Vector3(gx + 0.5 - 4, cellY(gx, gy), -(gy + 0.5 - 4));
function worldToCell(p) {
  const gx = Math.floor(p.x + 4), gy = Math.floor(-p.z + 4);
  return gx >= 0 && gx < 8 && gy >= 0 && gy < 8 ? [gx, gy] : null;
}
// точка диорамы (координаты Blender x, y) → мир
const boardToWorld = (b, bx, by, h = 0) => new THREE.Vector3((bx - b.CX) / b.CW, h, -(by - b.CY) / b.RH);

/* ---------- модели фигур ---------- */
const MODEL_FOR = {
  skeleton: 'undead/skeleton', skeleton_mage: 'undead/skeleton', skeleton_warrior: 'undead/skeleton',
  lich: 'undead/lich', phylactery: 'undead/phylactery', graveyard: 'undead/graveyard',
  soul_eater: 'undead/soul_eater', death_knight: 'undead/death_knight',
  imp: 'demons/imp', demon_king: 'demons/demon_king', summoner: 'demons/summoner', devourer: 'demons/devourer', obelisk: 'demons/obelisk', guard: 'demons/guard', satyr: 'demons/satyr',
};
const MODEL_H = { satyr: 1.45 };   // своя высота модели (Сатир по правилам пешка, но это превращённый Имп — крупнее)
const HEIGHT = { pawn: 1.15, knight: 1.4, bishop: 1.4, rook: 1.45, queen: 1.7, king: 1.75 };
const OWNER_COLOR = [0xefe8d8, 0x1d2029];

let renderer, scene, camera, controls, clock, raycaster, pointer;
let boardGroup, piecesGroup, hlGroup, fxGroup, pickPlane, hoverMark;
let rimLight, boardLights, ground, labelGroup;
const models = {};                 // путь → { scene, size }
const pieces = new Map();          // id фигуры → { obj, x, y, type, owner, stat }
const anims = [];                  // активные анимации
let ready = false, pendingModel = null, lastTurn = null, lastGame = null;

/* ---------- старт ---------- */
function init() {
  const host = document.getElementById('glhost');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));   // телефон: меньше пикселей — плавнее и холоднее
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;          // доска из двух половин разных фракций
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
  rimLight = new THREE.DirectionalLight(0x7cff9a, 0.6); rimLight.position.set(-8, 5, -9); scene.add(rimLight);
  boardLights = new THREE.Group(); scene.add(boardLights);       // свечи / лава — у каждой доски свои

  boardGroup = new THREE.Group(); piecesGroup = new THREE.Group(); hlGroup = new THREE.Group(); fxGroup = new THREE.Group();
  scene.add(boardGroup, piecesGroup, hlGroup, fxGroup);

  // земля под диорамой и невидимая плоскость для кликов
  ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 1 }));
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
  camera.fov = camera.aspect > 1.4 ? 38 + Math.min(6, (camera.aspect - 1.4) * 12) : 38;   // широкий низкий экран (телефон) — шире угол, чтобы доска влезла по высоте
  camera.updateProjectionMatrix();
}

/* ---------- загрузка моделей ---------- */
function loadAssets() {
  const status = document.getElementById('glstatus');
  const loader = new GLTFLoader();
  const paths = [...Object.values(BOARDS).map(b => b.path), ...new Set(Object.values(MODEL_FOR))];
  let done = 0;
  const one = p => new Promise(res => loader.load(`models/${p}.glb`, g => {
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    models[p] = { scene: root, size, min: box.min.clone() };
    status.textContent = `Загрузка 3D-моделей… ${++done}/${paths.length}`;
    res(true);
  }, undefined, () => { status.textContent = `Не удалось загрузить models/${p}.glb`; res(false); }));
  Promise.all(paths.map(one)).then(() => {
    switchBoard(pendingModel ? boardFor(pendingModel.game) : ['swamp', 'swamp'], true);
    ready = true;
    status.classList.add('hidden');
    if (location.protocol === 'file:') {
      status.classList.remove('hidden');
      status.textContent = 'Для 3D-моделей откройте игру через FractionChess.exe (или serve.ps1) — браузер не загружает модели с file://';
    }
    if (pendingModel) render(pendingModel);
  });
}
// доска партии: каждая половина — доска фракции, которая на ней стоит (белые — ряды 1–4, чёрные — 5–8)
function boardFor(G) {
  const f = G && G.players ? G.players.map(p => p.faction) : [];
  return [0, 1].map(i => FACTION_BOARD[f[i]] || 'swamp');
}
// своя копия диорамы со своими материалами (у двух половин разные плоскости обрезки)
const dioramaCache = {};
function diorama(key, side) {
  const id = key + ':' + side;
  if (dioramaCache[id]) return dioramaCache[id];
  const m = models[BOARDS[key].path]; if (!m) return null;
  const d = m.scene.clone(true);
  d.traverse(o => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); } });
  return dioramaCache[id] = d;
}
function switchBoard(keys, force) {
  if (!force && keys[0] === halves[0] && keys[1] === halves[1]) return;
  halves = keys.slice();
  clearConv(); convGame = null;
  for (const k in tileTex) { tileTex[k].dispose(); delete tileTex[k]; }
  boardGroup.clear();
  // фигуры стоят по старой высоте клеток — снимаем, render() расставит заново
  piecesGroup.clear(); pieces.clear();
  const same = keys[0] === keys[1];
  let groundY = -1.05, any = false;
  boardLights.clear();
  keys.forEach((key, side) => {
    if (same && side === 1) return;                       // одна и та же доска — целиком, без шва
    const b = BOARDS[key], d = diorama(key, side), m = models[b.path];
    if (!d) return;
    any = true;
    d.scale.set(1 / b.CW, 1 / ((b.CW + b.RH) / 2), 1 / b.RH);
    d.position.set(-b.CX / b.CW, -b.ZS / ((b.CW + b.RH) / 2), b.CY / b.RH);
    // фракции всегда достаётся «своя» половина доски (b.own: south — ряды 1–4 диорамы, у демонов сторона с котлом;
    // north — ряды 5–8, у болота сторона со свечами). Если она не с той стороны — разворот на 180° (цвета клеток не меняются).
    const flip = !same && ((b.own === 'south') !== (side === 0));
    const pivot = new THREE.Group(); pivot.add(d);
    pivot.rotation.y = flip ? Math.PI : 0;
    const plane = same ? null : new THREE.Plane(new THREE.Vector3(0, 0, side ? -1 : 1), 0);
    d.traverse(o => { if (o.isMesh) o.material.clippingPlanes = plane ? [plane] : null; });
    boardGroup.add(pivot);
    groundY = Math.min(groundY, (m.min.y - b.ZS) / ((b.CW + b.RH) / 2) - 0.02);
    // свет этой доски — только тот, что стоит на её «своей» половине
    for (const [bx, by, col, pow] of b.lights) {
      const p = boardToWorld(b, bx, by, 1.2);
      if (!same && (b.own === 'south' ? p.z < 0 : p.z > 0)) continue;
      if (flip) { p.x = -p.x; p.z = -p.z; }
      const l = new THREE.PointLight(col, pow, 7, 2); l.position.copy(p); boardLights.add(l);
    }
  });
  if (!any) proceduralBoard();
  ground.position.y = groundY;
  // атмосфера — смесь двух досок
  const B0 = BOARDS[keys[0]], B1 = BOARDS[keys[1]];
  const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), 0.5);
  rimLight.color.copy(mix(B0.rim, B1.rim));
  scene.fog.color.copy(mix(B0.fog, B1.fog)); scene.background.copy(scene.fog.color);
  ground.material.color.copy(mix(keys[0] === 'demons' ? 0x160909 : 0x0d1210, keys[1] === 'demons' ? 0x160909 : 0x0d1210));
  if (fireflies) fireflies.material.color.copy(mix(B0.flies, B1.flies));
  addLabels();
  scene.remove(hoverMark); hoverMark = cellFrame(0xffffff, 0.35); hoverMark.visible = false; scene.add(hoverMark);
}
/* ---------- захват клеток: клетка на чужой половине перекрашивается в дизайн доски фракции, которая на неё встала ----------
   Картинку клетки снимаем ортокамерой сверху с настоящей доски этой фракции (без фигур и подсветки), по одной на цвет клетки. */
let tileGroup = null, convGame = null;
const tileTex = {};
function captureTile(key, parity) {
  const id = key + ':' + parity;
  if (tileTex[id]) return tileTex[id];
  const s = halves[0] === key ? 0 : 1, gy = s === 0 ? 1 : 6;
  const gx = (3 + gy) % 2 === parity ? 3 : 4;
  const p = cellPos(gx, gy);
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.05, 20);
  cam.up.set(0, 0, -1); cam.position.set(p.x, 4, p.z); cam.lookAt(p.x, -1, p.z);
  const hide = [piecesGroup, hlGroup, fxGroup, labelGroup, hoverMark, fireflies, tileGroup].filter(Boolean);
  const vis = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; });
  const pr = renderer.getPixelRatio(), sz = renderer.getSize(new THREE.Vector2()), fog = scene.fog;
  scene.fog = null; renderer.setPixelRatio(1); renderer.setSize(256, 256, false);
  renderer.render(scene, cam);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(renderer.domElement, 0, 0, 256, 256);
  renderer.setPixelRatio(pr); renderer.setSize(sz.x, sz.y, false); scene.fog = fog;
  hide.forEach((o, i) => { o.visible = vis[i]; });
  renderer.render(scene, camera);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tileTex[id] = tex;
}
const homeBoard = (x, y) => halves[y < 4 ? 0 : 1];
function clearConv() {
  conv.clear();
  if (tileGroup) { tileGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach(m => m.dispose()); } }); tileGroup.clear(); }
}
// клетка (x, y) теперь в дизайне доски key; delay — когда фигура до неё дойдёт
function setConv(x, y, key, delay) {
  const k = x + ',' + y;
  const old = tileGroup.children.find(o => o.userData.cell === k);
  if (old) { tileGroup.remove(old); old.geometry.dispose(); [].concat(old.material).forEach(m => m.dispose()); }
  if (key === homeBoard(x, y)) { conv.delete(k); return; }          // вернулась к хозяину половины
  conv.set(k, key);
  const top = new THREE.MeshBasicMaterial({ map: captureTile(key, (x + y) % 2), transparent: true, opacity: 0 });
  const side = new THREE.MeshStandardMaterial({ color: key === 'demons' ? 0x3a0d0a : 0x23261f, roughness: 0.9, transparent: true, opacity: 0 });
  const h = 0.3, mesh = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1), [side, side, top, side, side, side]);
  const p = cellPos(x, y); mesh.position.set(p.x, TILE_TOP - h / 2, p.z);
  mesh.receiveShadow = true; mesh.userData.cell = k;
  tileGroup.add(mesh);
  // плитка проявляется, когда фигура встаёт на клетку
  anims.push({ t: -delay, dur: 0.45, f: q => { const v = Math.max(0, q); top.opacity = side.opacity = v; },
    end: () => { top.transparent = side.transparent = false; top.opacity = side.opacity = 1; top.needsUpdate = side.needsUpdate = true; } });
}
// у каждой фигуры на доске — дизайн доски её фракции под ногами
function updateConv(model, delayFor) {
  if (!tileGroup) { tileGroup = new THREE.Group(); scene.add(tileGroup); }
  if (model.game !== convGame) { clearConv(); convGame = model.game; }
  if (halves[0] === halves[1]) return;                                  // одна доска на всех — нечего перекрашивать
  for (const c of model.cells) {
    if (!c.p || !c.def) continue;
    const key = FACTION_BOARD[c.def.faction] || 'swamp', k = c.x + ',' + c.y;
    if ((conv.get(k) || homeBoard(c.x, c.y)) !== key) setConv(c.x, c.y, key, delayFor(c));
  }
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
    const h = MODEL_H[p.type] || HEIGHT[def.shape || def.cls] || 1.4;
    let k = h / m.size.y;
    const wide = Math.max(m.size.x, m.size.z) * k;
    if (wide > 0.92) k *= 0.92 / wide;
    inst.scale.setScalar(k);
    inst.position.y = 0.08;
    inst.rotation.y = p.owner === 0 ? Math.PI : 0;     // фигуры смотрят на соперника
    root.add(inst); root.userData.body = inst;
    top = m.size.y * k + 0.15;
  } else {
    const shape = def.shape || def.cls;   // def.shape — свой силуэт фигуры (например, Инженер не похож на пешку)
    const pts = LATHE[shape].map(([r, y]) => new THREE.Vector2(r, y * (HEIGHT[shape] / 1.6)));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({
      color: OWNER_COLOR[p.owner], roughness: 0.35, metalness: 0.25,
      emissive: new THREE.Color(FC.FACTIONS[def.faction].color), emissiveIntensity: 0.08 }));
    body.position.y = 0.08; body.castShadow = body.receiveShadow = true;
    root.add(body); root.userData.body = body;
    top = pts[pts.length - 1].y + 0.1;
    const glyph = textSprite(def.glyph || FC.GLYPH[def.cls], p.owner ? '#f3f4f6' : '#111827', FC.FACTIONS[def.faction].color, 128, 0.42);
    glyph.position.y = top + 0.25; root.add(glyph); root.userData.glyph = glyph;
    top += 0.5;
  }
  root.userData.top = top;
  root.userData.pid = p.id;
  root.traverse(o => { o.userData.pid = p.id; });
  return root;
}
function statusText(p) {
  return (p.cooldown > 0 ? '⏳' : '') + (p.bloodlust > 0 ? '🩸' : '') + (p.cursedTtl > 0 ? '☠' : '') + (p.stolen ? '🎭' : '') +
    (FC.statusIcons ? FC.statusIcons(p).map(s => s[0]).join('') : '');
}

/* ---------- подсветка ---------- */
const HL_COLOR = { move: 0x22c55e, capture: 0xef4444, ranged: 0xf97316, summon: 0xa855f7, revive: 0x14b8a6,
  convert: 0xc084fc, special: 0x3b82f6, pending: 0xfbbf24, block: 0x6b7280, zone: 0xfb923c };
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
    // зона выстрела: прозрачная оранжевая клетка с прицелом — сюда фигура может выстрелить
    case 'zone': {
      g.add(flat(new THREE.PlaneGeometry(CELL_W * 0.86, CELL_H * 0.86), hlMat(col, 0.16)));
      g.add(flat(new THREE.RingGeometry(0.16, 0.2, 28), hlMat(col, 0.55)));
      for (const r of [0, Math.PI / 2]) { const l = flat(new THREE.PlaneGeometry(0.5, 0.025), hlMat(col, 0.45)); l.rotation.z = r; g.add(l); }
      break;
    }
  }
  if (hl.stolen) g.add(flat(new THREE.RingGeometry(0.54, 0.58, 40), hlMat(0xec4899, 0.9)));
  if (hl.ghost || hl.k === 'pending') makePulse(g);
  return g;
}

// стрелка сдвига линии (ТХ'Зсал): плоская, лежит на клетке и смотрит туда, куда сдвинутся фигуры
let arrowGeo = null;
function lineArrow([dx, dy]) {
  if (!arrowGeo) {
    const s = new THREE.Shape();
    s.moveTo(-0.3, -0.07); s.lineTo(0.06, -0.07); s.lineTo(0.06, -0.19); s.lineTo(0.32, 0);
    s.lineTo(0.06, 0.19); s.lineTo(0.06, 0.07); s.lineTo(-0.3, 0.07); s.closePath();
    arrowGeo = new THREE.ShapeGeometry(s);
  }
  // flat() кладёт фигуру на доску: локальная ось Y смотрит в -Z мира, а +y клетки — тоже в -Z
  // рисуется поверх фигур, чтобы стрелку было видно и на занятых клетках
  if (!lineArrow.mat) lineArrow.mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const m = flat(arrowGeo.clone(), lineArrow.mat, 0.06);
  m.rotation.z = Math.atan2(dy * CELL_H, dx * CELL_W);
  m.renderOrder = 20;
  return m;
}

// мерцание клеток при выборе сдвига линии (ТХ'Зсал, Ксал'Таргон): медленно и плавно, светло-фиолетовым
// lvl 1 — всё доступное поле (ещё не выбрана клетка), 2 — линии через выбранную клетку, 3 — сама выбранная клетка
function shiftPulse(lvl) {
  const g = new THREE.Group();
  const op = lvl === 1 ? 0.4 : lvl === 2 ? 0.62 : 0.78;
  g.add(flat(new THREE.PlaneGeometry(CELL_W * 0.96, CELL_H * 0.96), hlMat(lvl === 3 ? 0xc4b5fd : 0xa78bfa, op), 0.025));
  if (lvl >= 2) g.add(cellFrame(lvl === 3 ? 0xf5f3ff : 0xd8b4fe, 0.8));
  makePulse(g);
  g.traverse(o => { if (o.material) o.material.userData.slow = true; });
  return g;
}

/* ---------- отрисовка состояния ---------- */
function render(model) {
  if (!ready) { pendingModel = model; return; }
  pendingModel = null;
  switchBoard(boardFor(model.game));          // каждая половина — доска своей фракции
  if (model.game !== convGame) { clearConv(); convGame = model.game; }   // новая партия — захваченных клеток нет
  const seen = new Set();
  let moveInfo = null;     // { fx, fy, tx, ty, dur } — ход фигуры: когда она доберётся до клетки жертвы
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
      e = { obj, x: c.x, y: c.y, type: p.type, owner: p.owner, stat: '', baseY: target.y };
      pieces.set(p.id, e);
      if (lastTurn !== null) { obj.scale.setScalar(0.01); anims.push({ t: 0, dur: 0.35, f: k => obj.scale.setScalar(Math.max(0.01, easeOut(k))) }); }
    } else if (e.x !== c.x || e.y !== c.y) {
      if (model.mover && model.mover.pid === p.id) moveInfo = animateMove(e, c, target);
      else e.obj.position.copy(target);
      e.x = c.x; e.y = c.y; e.baseY = target.y;
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
  // захват клеток: под фигурой — дизайн доски её фракции (проявляется, когда ходящая фигура дойдёт)
  updateConv(model, c => moveInfo && c.x === moveInfo.tx && c.y === moveInfo.ty ? moveInfo.dur * 0.85 : 0);
  for (const e of pieces.values()) e.baseY = cellPos(e.x, e.y).y;
  // выстрел: стрелок достаёт трубу и стреляет; когда снаряд долетит — жертвы разбиваются
  let shotImpact = null, shotDeath = 'shatter';
  if (model.shot) { const se = pieces.get(model.shot.pid); if (se) { const r = fireShot(se, model.shot); shotImpact = r.impact; shotDeath = r.death; } }
  const isShotHit = (x, y) => shotImpact != null && model.shot.hits.some(h => h[0] === x && h[1] === y);
  const boomCells = new Set(model.cells.filter(c => c.boom).map(c => c.x + ',' + c.y));
  // когда событие на клетке (x,y) должно «случиться»: попадание снаряда или приход атакующей фигуры
  const hitDelay = (x, y) => {
    if (shotImpact != null && model.shot.hits.some(h => h[0] === x && h[1] === y)) return shotImpact;
    if (moveInfo) {
      const all = Math.hypot(moveInfo.tx - moveInfo.fx, moveInfo.ty - moveInfo.fy) || 1;
      const part = Math.hypot(x - moveInfo.fx, y - moveInfo.fy);
      return moveInfo.dur * Math.min(1, part / all) * 0.92;
    }
    return 0;
  };
  for (const [id, e] of pieces) if (!seen.has(id)) {
    const obj = e.obj; pieces.delete(id);
    if (boomCells.has(e.x + ',' + e.y)) {                                          // убита
      const d = hitDelay(e.x, e.y), shotHit = isShotHit(e.x, e.y);
      if (shotHit && shotDeath === 'abduct') abductLater(obj, d);                    // НЛО забирает фигуру
      else if (shotHit && shotDeath === 'sink') sinkLater(obj, d);                   // Обелиск: фигура тонет в доске
      else shatterLater(obj, d, shotHit && shotDeath === 'burn');                   // осколки (после молнии — обугленные)
    }
    else anims.push({ obj, t: 0, dur: 0.3, f: k => { obj.scale.setScalar(Math.max(0.01, 1 - k)); obj.position.y = -k * 0.5; }, end: () => piecesGroup.remove(obj) });
  }

  // подсветка клеток (старые геометрии освобождаем)
  hlGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData.base != null) o.material.dispose(); });
  hlGroup.clear();
  for (const c of model.cells) {
    const pos = cellPos(c.x, c.y);
    const add = o => { o.position.x += pos.x; o.position.y += pos.y; o.position.z += pos.z; hlGroup.add(o); };
    if (c.cursed) add(flat(new THREE.PlaneGeometry(CELL_W * 0.96, CELL_H * 0.96), hlMat(0x6d28d9, 0.35), 0.02));
    if (c.pulse) add(shiftPulse(c.pulse));
    if (c.hl) add(highlight(c));
    if (c.arrow) add(lineArrow(c.arrow));
    if (c.block) { for (const r of [Math.PI / 4, -Math.PI / 4]) { const b = flat(new THREE.PlaneGeometry(0.7, 0.09), hlMat(HL_COLOR.block, 0.9)); b.rotation.z = r; add(b); } }
    if (c.threatened) add(makePulse(flat(new THREE.RingGeometry(0.5, 0.6, 40), hlMat(0xef4444, 0.9), 0.1)));
    if (c.boom && !(shotDeath !== 'shatter' && isShotHit(c.x, c.y))) boom(pos, hitDelay(c.x, c.y));
  }
  if (model.sel) {
    const f = cellFrame(model.sel.mode === 'special' ? 0x22d3ee : 0xfacc15, 1);
    const pos = cellPos(model.sel.x, model.sel.y); f.position.copy(pos); hlGroup.add(f);
  }
  // новая партия — показать поле со своей стороны; смена хода — поворот только в режиме «к игроку»
  if (model.game !== lastGame) { lastGame = model.game; lastTurn = model.turn; rot = 0; startPreset(); setView(); clearScorches(); }
  else if (model.turn !== lastTurn) { lastTurn = model.turn; if (camMode === 'turn') setView(); }
}
function boom(pos, delay = 0) {
  later(delay, () => {
    const r = flat(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.06);
    r.position.x = pos.x; r.position.z = pos.z; fxGroup.add(r);
    anims.push({ t: 0, dur: 0.7, f: k => { r.scale.setScalar(0.4 + k * 1.6); r.material.opacity = 1 - k; }, end: () => { fxGroup.remove(r); r.geometry.dispose(); r.material.dispose(); } });
  });
}
const later = (delay, fn) => { if (delay <= 0) fn(); else anims.push({ t: 0, dur: delay, f: () => { }, end: fn }); };

/* ---------- анимации ходов ---------- */
// Перемещение: «скользящие» фигуры едут по доске, прыгуны (конь и все непрямые ходы) перепрыгивают по дуге
function animateMove(e, c, target) {
  const obj = e.obj, from = obj.position.clone(), fx = e.x, fy = e.y;
  const dx = c.x - fx, dy = c.y - fy, cells = Math.max(Math.abs(dx), Math.abs(dy));
  const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  const jump = !straight || c.def.cls === 'knight';
  const dir = new THREE.Vector3().subVectors(target, from).setY(0).normalize();
  let dur;
  if (jump) {
    dur = 0.42 + 0.07 * cells;
    const h = 0.75 + 0.18 * cells;
    anims.push({ obj, t: 0, dur, f: k => {
      const q = easeInOut(k);
      obj.position.lerpVectors(from, target, q); obj.position.y += Math.sin(q * Math.PI) * h;
      // кувырок вперёд в полёте и «приседание» при отрыве и приземлении
      obj.rotation.x = dir.z * Math.sin(q * Math.PI) * 0.35; obj.rotation.z = -dir.x * Math.sin(q * Math.PI) * 0.35;
      const sq = k < 0.12 ? 1 - Math.sin(k / 0.12 * Math.PI) * 0.12 : k > 0.88 ? 1 - Math.sin((k - 0.88) / 0.12 * Math.PI) * 0.12 : 1;
      obj.scale.set(1, sq, 1);
    }, end: () => { obj.rotation.x = obj.rotation.z = 0; obj.scale.set(1, 1, 1); } });
  } else {
    dur = Math.min(1.15, 0.3 + 0.14 * cells);
    anims.push({ obj, t: 0, dur, f: k => {
      const q = easeInOut(k);
      obj.position.lerpVectors(from, target, q);
      obj.position.y += Math.abs(Math.sin(q * Math.PI * Math.max(1, cells))) * 0.05;   // лёгкое покачивание на каждой клетке
      const lean = Math.sin(k * Math.PI) * 0.16;                                         // наклон в сторону движения
      obj.rotation.x = dir.z * lean; obj.rotation.z = -dir.x * lean;
    }, end: () => { obj.rotation.x = obj.rotation.z = 0; } });
  }
  return { fx, fy, tx: c.x, ty: c.y, dur };
}

/* Выстрел: у стрелка появляется большая труба, он целится, стреляет огненным снарядом; взрыв на цели */
let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); return glowTex;
}
function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); s.renderOrder = 6; return s;
}
function makeLauncher(color) {
  const g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x6b7385, metalness: 0.7, roughness: 0.3 });
  const fc = new THREE.Color(color);
  const glowMat = new THREE.MeshStandardMaterial({ color: fc, emissive: fc, emissiveIntensity: 1.6 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.68, 18), metal); tube.rotation.x = Math.PI / 2;
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.024, 8, 24), glowMat); muzzle.position.z = 0.34;
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.12, 18), metal); back.rotation.x = Math.PI / 2; back.position.z = -0.38;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.012, 6, 24), glowMat); band.position.z = 0.05;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), metal); grip.position.set(0, -0.12, -0.05);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), metal); sight.position.set(0, 0.1, 0.1);
  const band2 = band.clone(); band2.position.z = -0.22;
  g.add(tube, muzzle, back, band, band2, grip, sight);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const outer = new THREE.Group(); g.scale.setScalar(1.45); outer.add(g);   // большая «базука»
  return outer;
}
/* Выбор анимации выстрела: у Жреца людей — по настройке в меню «Анимации», у остальных — базука.
   Возвращает { impact: когда поражена цель (с), death: 'shatter' | 'burn' | 'abduct' }. */
const animPref = (key, def) => { try { return localStorage.getItem('fc.anim.' + key) || def; } catch (e) { return def; } };
function fireShot(se, shot) {
  if (se.type === 'priest') {
    const mode = animPref('priest', 'prayer');
    if (mode === 'ufo') return priestUfo(se, shot);
    if (mode === 'lightning') return priestLightning(se, shot);
    return priestPrayer(se, shot);
  }
  if (se.type === 'obelisk') return obeliskSink(se, shot);
  return bazookaShot(se, shot);
}

/* ---------- Демонический обелиск: вытягивается вдвое, под ним и под целью горят красные пентаграммы,
   цель дрожит и тонет в своей пентаграмме, по «воде» расходятся красные круги ---------- */
const T_SINK_SHAKE = 0.75, T_SINK = 1.15, T_OB_HIT = 0.6;
let pentaTex = null;
function pentagramTexture() {
  if (pentaTex) return pentaTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  g.strokeStyle = '#ff2a2a'; g.shadowColor = '#ff0000'; g.shadowBlur = 14; g.lineJoin = 'round';
  const circ = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke(); };
  circ(S * 0.46, 7); circ(S * 0.40, 3);
  g.lineWidth = 6; g.beginPath();                                   // звезда одной линией: через вершину
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 4 / 5), r = S * 0.40;
    const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#ff2a2a';                                          // руны-точки между кругами
  for (let i = 0; i < 15; i++) { const a = i / 15 * Math.PI * 2; g.beginPath(); g.arc(m + Math.cos(a) * S * 0.43, m + Math.sin(a) * S * 0.43, 3, 0, Math.PI * 2); g.fill(); }
  pentaTex = new THREE.CanvasTexture(c); return pentaTex;
}
// пентаграмма на клетке: появляется, медленно вращается и пульсирует; возвращает { mesh, fade(dur) }
function pentagram(pos, size = 1.0) {
  const mat = new THREE.MeshBasicMaterial({ map: pentagramTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const m = flat(new THREE.PlaneGeometry(CELL_W * size, CELL_W * size), mat, 0.04);
  m.position.x = pos.x; m.position.z = pos.z; m.renderOrder = 5; fxGroup.add(m);
  const glowS = glowSprite(0xff1a1a, CELL_W * 1.2); glowS.position.set(pos.x, 0.08, pos.z); glowS.material.opacity = 0; fxGroup.add(glowS);
  const st = { alive: true, target: 1 };
  const tick = { t: 0, dur: 1e9, f: () => {
    const t = tick.t;                                             // секунды с появления (tick.t копит dt)
    m.rotation.z = t * 0.6;
    const cur = mat.opacity, want = st.target * (0.85 + Math.sin(t * 9) * 0.15);
    mat.opacity = cur + (want - cur) * 0.15;
    glowS.material.opacity = mat.opacity * 0.45;
    if (!st.alive && mat.opacity < 0.02) tick.t = tick.dur;     // погасла — убрать
  }, end: () => { disposeObj(m); fxGroup.remove(glowS); glowS.material.dispose(); } };
  anims.push(tick);
  return { fade() { st.target = 0; st.alive = false; } };
}
function obeliskSink(se, shot) {
  const obj = se.obj;
  const total = T_OB_HIT + T_SINK_SHAKE + T_SINK + 0.2;               // обелиск вытянут, пока цель не утонет
  // пентаграмма под обелиском
  const own = pentagram(obj.position, 1.45);
  later(total, () => own.fade());
  // обелиск плавно увеличивается (равномерно, без вытягивания) и в конце возвращается к обычному размеру;
  // меняется только сама фигура, значок над ней не деформируется — просто поднимается вместе с верхушкой
  const GROW = 0.25;
  const b = obj.userData.body || obj, g = obj.userData.glyph;
  const s0 = b.scale.clone(), gy0 = g ? g.position.y : 0;
  const set = s => { b.scale.copy(s0).multiplyScalar(s); if (g) g.position.y = gy0 * s; };
  anims.push({ t: 0, dur: total + 0.4, f: k => {
    const t = k * (total + 0.4);
    const up = t < 0.45 ? easeOut(t / 0.45) : t > total ? 1 - easeInOut((t - total) / 0.4) : 1;
    set(1 + up * GROW + (t > 0.45 && t < total ? Math.sin(t * 6) * 0.015 : 0));
  }, end: () => set(1) });
  // пентаграммы под целями загораются чуть позже; цель тонет в них (см. sinkLater)
  return { impact: T_OB_HIT, death: 'sink' };
}
function sinkLater(obj, delay) {
  later(delay, () => {
    const p0 = obj.position.clone(), depth = (obj.userData.top || 1.4) + 0.3;
    // тёмная «трясина» и горящая пентаграмма под фигурой
    const pool = flat(new THREE.CircleGeometry(CELL_W * 0.44, 40), new THREE.MeshBasicMaterial({ color: 0x1a0202, transparent: true, opacity: 0, depthWrite: false }), 0.035);
    pool.position.x = p0.x; pool.position.z = p0.z; pool.renderOrder = 3; fxGroup.add(pool);
    const pent = pentagram(p0, 1.0);
    const D = T_SINK_SHAKE + T_SINK;
    anims.push({ obj, t: 0, dur: D, f: k => {
      const t = k * D;
      const shake = t < T_SINK_SHAKE ? 0.015 + 0.04 * (t / T_SINK_SHAKE) : 0.05 * (1 - (t - T_SINK_SHAKE) / T_SINK);
      const s = easeIn(Math.max(0, t - T_SINK_SHAKE) / T_SINK);
      obj.position.set(p0.x + (Math.random() - 0.5) * shake * 2, p0.y - s * depth, p0.z + (Math.random() - 0.5) * shake * 2);
      obj.rotation.x = Math.sin(t * 37) * shake * 1.4; obj.rotation.z = Math.cos(t * 41) * shake * 1.4;
      pool.material.opacity = 0.8 * Math.min(1, t / 0.4);
    }, end: () => {
      piecesGroup.remove(obj);
      pent.fade();
      anims.push({ t: 0, dur: 0.6, f: k => { pool.material.opacity = 0.8 * (1 - k); }, end: () => disposeObj(pool) });
      // фигура исчезла — по поверхности, как по воде, расходятся красные круги
      for (let i = 0; i < 4; i++) later(i * 0.3, () => {
        const r = flat(new THREE.RingGeometry(0.2, 0.26, 64), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), 0.045 + i * 0.001);
        r.renderOrder = 4;
        r.position.x = p0.x; r.position.z = p0.z; fxGroup.add(r);
        anims.push({ t: 0, dur: 2.0, f: k => {
          r.scale.setScalar(0.6 + easeOut(k) * 3.4);
          r.material.opacity = (k < 0.1 ? k / 0.1 : 1) * (1 - k) * 1.0;
        }, end: () => disposeObj(r) });
      });
      // красный всплеск в центре
      const fl = glowSprite(0xff3030, 0.3); fl.position.set(p0.x, 0.15, p0.z); fxGroup.add(fl);
      anims.push({ t: 0, dur: 0.6, f: k => { fl.scale.setScalar(0.3 + k * 0.9); fl.material.opacity = 1 - k; }, end: () => { fxGroup.remove(fl); fl.material.dispose(); } });
    } });
  });
}
function bazookaShot(se, shot) {
  const obj = se.obj, top = obj.userData.top || 1.4;
  const tgt = cellPos(shot.hits[0][0], shot.hits[0][1]); tgt.y = 0.45;
  const dir = new THREE.Vector3().subVectors(tgt, obj.position).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);                               // «плечо» стрелка
  const shoulder = obj.position.clone().addScaledVector(side, 0.36); shoulder.y = Math.max(0.6, top * 0.62);
  const L = makeLauncher(FC.FACTIONS[FC.PIECES[se.type].faction].color);
  L.position.copy(obj.position); L.position.y = 0.1; L.scale.setScalar(0.01); fxGroup.add(L);
  const cells = Math.max(1, shot.hits[0] ? Math.hypot(shot.hits[0][0] - se.x, shot.hits[0][1] - se.y) : 1);
  const T_OUT = 0.4, T_FIRE = 0.8, travel = 0.16 + 0.07 * cells, T_HIT = T_FIRE + travel;
  // 1) труба «достаётся»: вырастает и поднимается на плечо, разворачиваясь к цели
  anims.push({ t: 0, dur: T_OUT, f: k => {
    const q = easeOut(k);
    L.position.lerpVectors(new THREE.Vector3(obj.position.x, 0.1, obj.position.z), shoulder, q);
    L.scale.setScalar(Math.max(0.01, q));
    L.lookAt(tgt); L.rotateZ((1 - q) * 2.5);
  } });
  // 2) выстрел: отдача, вспышка, снаряд со шлейфом
  later(T_FIRE, () => {
    const back = dir.clone().multiplyScalar(-0.14), base = L.position.clone();
    anims.push({ t: 0, dur: 0.3, f: k => L.position.copy(base).addScaledVector(back, Math.sin(Math.min(1, k * 2.2) * Math.PI) * (1 - k)) });
    const muzzle = L.position.clone().add(new THREE.Vector3().subVectors(tgt, L.position).normalize().multiplyScalar(0.55));
    const flash = glowSprite(0xffd27a, 0.2); flash.position.copy(muzzle); fxGroup.add(flash);
    anims.push({ t: 0, dur: 0.22, f: k => { flash.scale.setScalar(0.2 + k * 1.1); flash.material.opacity = 1 - k; }, end: () => { fxGroup.remove(flash); flash.material.dispose(); } });
    const ball = glowSprite(0xff8a3d, 0.42), core = glowSprite(0xffffff, 0.16);
    fxGroup.add(ball, core);
    let trailT = 0;
    anims.push({ t: 0, dur: travel, f: k => {
      const p = new THREE.Vector3().lerpVectors(muzzle, tgt, k); p.y += Math.sin(k * Math.PI) * 0.18;
      ball.position.copy(p); core.position.copy(p);
      if (k - trailT > 0.06) {                       // шлейф: гаснущие огоньки позади снаряда
        trailT = k; const s = glowSprite(0xff6a1a, 0.26); s.position.copy(p); fxGroup.add(s);
        anims.push({ t: 0, dur: 0.35, f: q => { s.material.opacity = 0.8 * (1 - q); s.scale.setScalar(0.26 * (1 - q * 0.6)); }, end: () => { fxGroup.remove(s); s.material.dispose(); } });
      }
    }, end: () => { fxGroup.remove(ball, core); ball.material.dispose(); core.material.dispose(); } });
  });
  // 3) взрыв на всех поражённых клетках
  later(T_HIT, () => { for (const [hx, hy] of shot.hits) explosion(cellPos(hx, hy)); });
  // 4) труба убирается
  later(T_HIT + 0.45, () => {
    const s0 = L.position.clone();
    anims.push({ t: 0, dur: 0.3, f: k => { L.scale.setScalar(Math.max(0.01, 1 - easeInOut(k))); L.position.y = s0.y - k * 0.3; },
      end: () => { fxGroup.remove(L); L.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } });
  });
  return { impact: T_HIT, death: 'shatter' };
}

/* ---------- анимации Жреца людей ---------- */
const disposeObj = o => { fxGroup.remove(o); o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); };
const addMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
// поза фигуры: k=0 — стоит, k=1 — на коленях (сжата и склонилась к цели); stretch>0 — наоборот, тянется вверх
function pose(obj, dir, kneel, stretch = 0) {
  const b = obj.userData.body, g = obj.userData.glyph; if (!b) return;
  if (b.userData.y0 == null) { b.userData.y0 = b.position.y; b.userData.s0 = b.scale.clone(); if (g) g.userData.y0 = g.position.y; }
  const s0 = b.userData.s0, sy = 1 - 0.38 * kneel + 0.14 * stretch, sx = 1 + 0.1 * kneel - 0.04 * stretch;
  b.scale.set(s0.x * sx, s0.y * sy, s0.z * sx);
  const bow = 0.32 * kneel;
  b.rotation.x = dir.z * bow; b.rotation.z = -dir.x * bow;
  if (g) g.position.y = g.userData.y0 * (sy * 0.9 + 0.1);
}
function targetOf(shot) { const t = cellPos(shot.hits[0][0], shot.hits[0][1]); return t; }

// 1) Молитва: Жрец опускается на колени, над ним нимб и золотые искры, с неба бьёт столб света
function priestPrayer(se, shot) {
  const obj = se.obj, top = obj.userData.top || 1.4, tgt = targetOf(shot);
  const dir = new THREE.Vector3().subVectors(tgt, obj.position).setY(0).normalize();
  const T_BEAM = 1.05, T_HIT = 1.25, T_END = 2.3;
  anims.push({ t: 0, dur: T_END, f: k => {
    const t = k * T_END, kn = t < 0.45 ? easeInOut(t / 0.45) : t > T_END - 0.45 ? easeInOut((T_END - t) / 0.45) : 1;
    pose(obj, dir, kn);
  }, end: () => pose(obj, dir, 0) });
  // нимб
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 36), addMat(0xffd76a, 0));
  halo.rotation.x = Math.PI / 2; fxGroup.add(halo);
  anims.push({ t: 0, dur: T_END, f: k => {
    const t = k * T_END;
    halo.position.set(obj.position.x, top * 0.7 + 0.15 + Math.sin(t * 6) * 0.03, obj.position.z);
    halo.material.opacity = Math.min(1, t / 0.4) * Math.min(1, (T_END - t) / 0.4);
    halo.rotation.z = t * 2;
  }, end: () => disposeObj(halo) });
  // золотые искры молитвы, поднимающиеся вверх
  for (let i = 0; i < 14; i++) later(0.25 + i * 0.05, () => {
    const s = glowSprite(0xffe08a, 0.12), a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.2;
    s.position.set(obj.position.x + Math.cos(a) * r, 0.3, obj.position.z + Math.sin(a) * r); fxGroup.add(s);
    anims.push({ t: 0, dur: 1.0, f: k => { s.position.y = 0.3 + k * 2.2; s.material.opacity = Math.sin(k * Math.PI); }, end: () => { fxGroup.remove(s); s.material.dispose(); } });
  });
  // столб света с неба
  later(T_BEAM, () => {
    const H = 16, beam = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, H, 24, 1, true), addMat(0xffffff, 0));
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, H, 32, 1, true), addMat(0xffd76a, 0));
    beam.add(core, outer); beam.position.set(tgt.x, H / 2, tgt.z); fxGroup.add(beam);
    const ring = flat(new THREE.RingGeometry(0.2, 0.5, 40), addMat(0xffe7a0, 0), 0.05); ring.position.x = tgt.x; ring.position.z = tgt.z; fxGroup.add(ring);
    anims.push({ t: 0, dur: 1.0, f: k => {
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      core.material.opacity = a; outer.material.opacity = a * 0.45;
      beam.scale.set(1 + Math.sin(k * 30) * 0.06, 1, 1 + Math.sin(k * 30) * 0.06);
      ring.material.opacity = a; ring.scale.setScalar(1 + k * 1.8);
    }, end: () => { disposeObj(beam); disposeObj(ring); } });
    const flash = glowSprite(0xfff3c4, 0.4); flash.position.set(tgt.x, 0.6, tgt.z); fxGroup.add(flash);
    anims.push({ t: 0, dur: 0.6, f: k => { flash.scale.setScalar(0.4 + k * 2.4); flash.material.opacity = 1 - k; }, end: () => { fxGroup.remove(flash); flash.material.dispose(); } });
  });
  return { impact: T_HIT, death: 'shatter' };
}

// 2) НЛО: Жрец подаёт сигнал, прилетает тарелка, луч прожектора поднимает фигуру, вращая её, и тарелка улетает
function makeSaucer() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 12), new THREE.MeshStandardMaterial({ color: 0x9aa4b5, metalness: 0.85, roughness: 0.25 }));
  hull.scale.set(1, 0.22, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7ef9ff, emissive: 0x2bd9ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.75, metalness: 0.2, roughness: 0.1 }));
  dome.position.y = 0.12;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.05, 8, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f4b, metalness: 0.9, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  g.add(hull, dome, rim);
  const lights = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2, l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9dff7a }));
    l.position.set(Math.cos(a) * 0.82, -0.04, Math.sin(a) * 0.82); g.add(l); lights.push(l);
  }
  g.userData.lights = lights;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function priestUfo(se, shot) {
  const obj = se.obj, tgt = targetOf(shot);
  const dir = new THREE.Vector3().subVectors(tgt, obj.position).setY(0).normalize();
  const HOVER = 3.4, T_ARRIVE = 1.0, T_BEAM = 1.15, T_HIT = 1.35, T_UP = 1.3, T_LEAVE = T_HIT + T_UP + 0.15;
  // сигнал Жреца: тянется вверх, от него расходятся зелёные кольца
  anims.push({ t: 0, dur: 1.0, f: k => pose(obj, dir, 0, Math.sin(k * Math.PI)), end: () => pose(obj, dir, 0) });
  for (let i = 0; i < 3; i++) later(i * 0.22, () => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 36), addMat(0x9dff7a, 1)); r.rotation.x = Math.PI / 2;
    r.position.set(obj.position.x, 1.2, obj.position.z); fxGroup.add(r);
    anims.push({ t: 0, dur: 0.8, f: k => { r.position.y = 1.2 + k * 2; r.scale.setScalar(1 + k * 2); r.material.opacity = 1 - k; }, end: () => disposeObj(r) });
  });
  // тарелка
  const ufo = makeSaucer(); fxGroup.add(ufo);
  const from = new THREE.Vector3(tgt.x - 9, 9, tgt.z - 7), hover = new THREE.Vector3(tgt.x, HOVER, tgt.z), away = new THREE.Vector3(tgt.x + 11, 10, tgt.z + 4);
  ufo.position.copy(from);
  const TOTAL = T_LEAVE + 0.9;
  anims.push({ t: 0, dur: TOTAL, f: k => {
    const t = k * TOTAL;
    if (t < T_ARRIVE) { const q = easeOut(t / T_ARRIVE); ufo.position.lerpVectors(from, hover, q); ufo.rotation.z = (1 - q) * 0.4; }
    else if (t < T_LEAVE) { ufo.position.copy(hover); ufo.position.y += Math.sin(t * 4) * 0.06; ufo.rotation.z = Math.sin(t * 3) * 0.05; }
    else { const q = easeInOut((t - T_LEAVE) / 0.9); ufo.position.lerpVectors(hover, away, q); ufo.rotation.z = -q * 0.5; }
    ufo.rotation.y = t * 2.5;
    ufo.userData.lights.forEach((l, i) => l.material.color.setHSL(((t * 0.8 + i / 10) % 1), 1, 0.6));
  }, end: () => disposeObj(ufo) });
  // луч прожектора
  later(T_BEAM, () => {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.62, HOVER, 32, 1, true), addMat(0xb7ffcf, 0));
    cone.position.set(tgt.x, HOVER / 2, tgt.z); fxGroup.add(cone);
    const spot = flat(new THREE.CircleGeometry(0.6, 40), addMat(0xb7ffcf, 0), 0.05); spot.position.x = tgt.x; spot.position.z = tgt.z; fxGroup.add(spot);
    const D = T_LEAVE - T_BEAM;
    anims.push({ t: 0, dur: D, f: k => {
      const a = Math.min(1, k * D / 0.2) * Math.min(1, (1 - k) * D / 0.25);
      cone.material.opacity = 0.32 * a * (0.85 + 0.15 * Math.sin(k * 40)); spot.material.opacity = 0.5 * a;
    }, end: () => { disposeObj(cone); disposeObj(spot); } });
  });
  return { impact: T_HIT, death: 'abduct', hover: HOVER, up: T_UP };
}
function abductLater(obj, delay) {
  later(delay, () => {
    const y0 = obj.position.y, D = 1.3;
    anims.push({ obj, t: 0, dur: D, f: k => {
      const q = easeInOut(k);
      obj.position.y = y0 + q * 3.1;
      obj.rotation.y += 0.25 + k * 0.4;
      obj.rotation.z = Math.sin(k * 12) * 0.12;
      obj.scale.setScalar(Math.max(0.05, 1 - q * 0.65));
    }, end: () => piecesGroup.remove(obj) });
  });
}

// 3) Молния: Жрец вскидывает руки, над целью сгущается туча, молния бьёт в фигуру, на клетке остаётся чёрный след
let scorchGroup = null, scorchTex = null;
function clearScorches() { if (scorchGroup) { scorchGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scorchGroup.clear(); } }
function scorchTexture() {
  if (scorchTex) return scorchTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.45, 'rgba(10,8,6,0.8)'); gr.addColorStop(0.8, 'rgba(20,14,8,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {                     // трещины от удара
    let a = i / 9 * Math.PI * 2 + Math.random() * 0.4, x = 64, y = 64; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 5; s++) { a += (Math.random() - 0.5) * 0.8; x += Math.cos(a) * 11; y += Math.sin(a) * 11; g.lineTo(x, y); }
    g.stroke();
  }
  scorchTex = new THREE.CanvasTexture(c); return scorchTex;
}
function addScorch(pos) {
  if (!scorchGroup) { scorchGroup = new THREE.Group(); scene.add(scorchGroup); }
  const m = flat(new THREE.PlaneGeometry(CELL_W * 1.1, CELL_H * 1.1), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, opacity: 0 }), 0.032);
  m.rotation.z = Math.random() * Math.PI * 2; m.position.x = pos.x; m.position.z = pos.z; m.renderOrder = 2;
  scorchGroup.add(m);
  anims.push({ t: 0, dur: 0.4, f: k => { m.material.opacity = k * 0.9; } });
  while (scorchGroup.children.length > 24) { const o = scorchGroup.children[0]; scorchGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
}
function boltPath(a, b, segs, jag) {
  const pts = [a.clone()];
  for (let i = 1; i < segs; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / segs);
    const j = jag * (1 - Math.abs(i / segs - 0.5));
    p.x += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j * 0.3;
    pts.push(p);
  }
  pts.push(b.clone()); return pts;
}
function boltMesh(pts, radius, color) {
  const g = new THREE.Group(), mat = addMat(color, 1), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6, 1, true), mat);
    m.position.lerpVectors(a, b, 0.5);
    m.quaternion.setFromUnitVectors(up, new THREE.Vector3().subVectors(b, a).normalize());
    g.add(m);
  }
  return g;
}
function priestLightning(se, shot) {
  const obj = se.obj, tgt = targetOf(shot);
  const dir = new THREE.Vector3().subVectors(tgt, obj.position).setY(0).normalize();
  const T_STRIKE = 0.85, T_END = 1.6;
  anims.push({ t: 0, dur: T_END, f: k => { const t = k * T_END; pose(obj, dir, 0, t < 0.35 ? easeOut(t / 0.35) : t > T_END - 0.4 ? (T_END - t) / 0.4 : 1); }, end: () => pose(obj, dir, 0) });
  // искры у поднятых рук Жреца
  const charge = glowSprite(0x9fd4ff, 0.2); charge.position.set(obj.position.x, (obj.userData.top || 1.4) + 0.1, obj.position.z); fxGroup.add(charge);
  anims.push({ t: 0, dur: T_STRIKE + 0.1, f: k => { charge.scale.setScalar(0.2 + k * 0.5 + Math.random() * 0.15); charge.material.opacity = 0.9; }, end: () => { fxGroup.remove(charge); charge.material.dispose(); } });
  // грозовая туча над целью
  const cloud = new THREE.Group(); fxGroup.add(cloud);
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0x1a1d26, transparent: true, depthWrite: false, opacity: 0 }));
    s.position.set(tgt.x + (Math.random() - 0.5) * 1.6, 5.2 + Math.random() * 0.5, tgt.z + (Math.random() - 0.5) * 1.6);
    s.scale.setScalar(1.4 + Math.random()); cloud.add(s);
  }
  anims.push({ t: 0, dur: T_END + 0.4, f: k => {
    const t = k * (T_END + 0.4), a = Math.min(1, t / 0.5) * Math.min(1, (T_END + 0.4 - t) / 0.5);
    cloud.children.forEach(s => { s.material.opacity = 0.85 * a; });
  }, end: () => disposeObj(cloud) });
  // удар молнии: несколько вспышек подряд, ветвления, свет в туче
  later(T_STRIKE - 0.18, () => {
    const top = new THREE.Vector3(tgt.x + (Math.random() - 0.5) * 0.8, 5.3, tgt.z + (Math.random() - 0.5) * 0.8), hit = new THREE.Vector3(tgt.x, 0.15, tgt.z);
    const pts = boltPath(top, hit, 12, 1.0);
    const bolt = new THREE.Group();
    bolt.add(boltMesh(pts, 0.035, 0xffffff), boltMesh(pts, 0.11, 0x6fb6ff));
    for (let b = 0; b < 3; b++) {                     // ветки
      const from = pts[2 + Math.floor(Math.random() * 6)];
      const end = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -1 - Math.random() * 1.2, (Math.random() - 0.5) * 2));
      bolt.add(boltMesh(boltPath(from, end, 5, 0.5), 0.02, 0xbfe0ff));
    }
    fxGroup.add(bolt);
    const skyFlash = glowSprite(0xbfe0ff, 3); skyFlash.position.copy(top); fxGroup.add(skyFlash);
    const D = 0.5;
    anims.push({ t: 0, dur: D, f: k => {
      const on = (k < 0.15) || (k > 0.28 && k < 0.42) || (k > 0.55 && k < 0.8);   // мерцание молнии
      const a = on ? 1 - k * 0.6 : 0.08;
      bolt.traverse(o => { if (o.material) o.material.opacity = a; });
      skyFlash.material.opacity = a * 0.8;
    }, end: () => { disposeObj(bolt); fxGroup.remove(skyFlash); skyFlash.material.dispose(); } });
  });
  later(T_STRIKE, () => {
    const flash = glowSprite(0xe6f2ff, 0.5); flash.position.set(tgt.x, 0.5, tgt.z); fxGroup.add(flash);
    anims.push({ t: 0, dur: 0.5, f: k => { flash.scale.setScalar(0.5 + k * 3); flash.material.opacity = 1 - k; }, end: () => { fxGroup.remove(flash); flash.material.dispose(); } });
    addScorch(tgt);
    for (let i = 0; i < 6; i++) later(i * 0.08, () => {                 // дым от удара
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0x3a3a3a, transparent: true, depthWrite: false, opacity: 0.6 }));
      s.position.set(tgt.x + (Math.random() - 0.5) * 0.3, 0.2, tgt.z + (Math.random() - 0.5) * 0.3); s.scale.setScalar(0.4); fxGroup.add(s);
      anims.push({ t: 0, dur: 1.6, f: k => { s.position.y = 0.2 + k * 1.6; s.scale.setScalar(0.4 + k * 1.1); s.material.opacity = 0.55 * (1 - k); }, end: () => { fxGroup.remove(s); s.material.dispose(); } });
    });
  });
  return { impact: T_STRIKE, death: 'burn' };
}
function explosion(pos) {
  const c = pos.clone(); c.y = 0.5;
  const fire = glowSprite(0xff7a1a, 0.3), white = glowSprite(0xfff3c4, 0.2);
  fire.position.copy(c); white.position.copy(c); fxGroup.add(fire, white);
  anims.push({ t: 0, dur: 0.55, f: k => {
    fire.scale.setScalar(0.3 + easeOut(k) * 2.2); fire.material.opacity = 1 - k;
    white.scale.setScalar(0.2 + easeOut(k) * 1.2); white.material.opacity = Math.max(0, 1 - k * 2);
  }, end: () => { fxGroup.remove(fire, white); fire.material.dispose(); white.material.dispose(); } });
  // искры
  const n = 36, pos3 = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos3.set([c.x, c.y, c.z], i * 3);
    const a = Math.random() * Math.PI * 2, u = Math.random() * 0.9 + 0.1, sp = 2 + Math.random() * 3;
    vel.push(Math.cos(a) * sp * (1 - u * 0.5), u * sp * 0.9 + 1, Math.sin(a) * sp * (1 - u * 0.5));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos3, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb347, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  fxGroup.add(pts);
  let last = 0;
  anims.push({ t: 0, dur: 0.8, f: k => {
    const dt = (k - last) * 0.8; last = k;
    const a = g.attributes.position;
    for (let i = 0; i < n; i++) {
      vel[i * 3 + 1] -= 9 * dt;
      a.setXYZ(i, a.getX(i) + vel[i * 3] * dt, Math.max(0.03, a.getY(i) + vel[i * 3 + 1] * dt), a.getZ(i) + vel[i * 3 + 2] * dt);
    }
    a.needsUpdate = true; pts.material.opacity = 1 - k;
  }, end: () => { fxGroup.remove(pts); g.dispose(); pts.material.dispose(); } });
}

/* Гибель: фигура разлетается на осколки, они падают на доску и постепенно тают */
function shatterLater(obj, delay, burn) {
  later(delay, () => { shatter(obj, burn); piecesGroup.remove(obj); });
}
function shatter(obj, burn) {
  obj.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
  const CS = 0.2;                                                 // размер «ячейки» осколка
  const buckets = new Map(), mats = new Map();
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], nrm = new THREE.Matrix3();
  obj.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const geo = m.geometry, pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, idx = geo.index;
    nrm.getNormalMatrix(m.matrixWorld);
    let mat = mats.get(m.material);
    if (!mat) {
      mat = m.material.clone(); mat.transparent = true; mat.side = THREE.DoubleSide; mat.depthWrite = true;
      if (burn && mat.color) {                       // после молнии осколки обуглены и тлеют
        mat.color.multiplyScalar(0.12);
        if (mat.emissive) { mat.emissive.setHex(0x5a1a00); mat.emissiveIntensity = 0.8; }
      }
      mats.set(m.material, mat);
    }
    const triCount = (idx ? idx.count : pa.count) / 3;
    const n3 = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const ids = idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
      for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(pa, ids[j]).applyMatrix4(m.matrixWorld);
      const cx = (v[0].x + v[1].x + v[2].x) / 3, cy = (v[0].y + v[1].y + v[2].y) / 3, cz = (v[0].z + v[1].z + v[2].z) / 3;
      const key = mat.uuid + ':' + Math.floor(cx / CS) + ',' + Math.floor(cy / CS) + ',' + Math.floor(cz / CS);
      let b = buckets.get(key);
      if (!b) { b = { mat, p: [], n: [], uv: ua ? [] : null }; buckets.set(key, b); }
      for (let j = 0; j < 3; j++) {
        b.p.push(v[j].x, v[j].y, v[j].z);
        if (na) { n3.fromBufferAttribute(na, ids[j]).applyMatrix3(nrm).normalize(); b.n.push(n3.x, n3.y, n3.z); }
        if (b.uv) b.uv.push(ua.getX(ids[j]), ua.getY(ids[j]));
      }
    }
  });
  const shards = [];
  for (const b of buckets.values()) {
    if (b.p.length < 9) continue;
    let sx = 0, sy = 0, sz = 0; const cnt = b.p.length / 3;
    for (let i = 0; i < b.p.length; i += 3) { sx += b.p[i]; sy += b.p[i + 1]; sz += b.p[i + 2]; }
    const c = new THREE.Vector3(sx / cnt, sy / cnt, sz / cnt);
    for (let i = 0; i < b.p.length; i += 3) { b.p[i] -= c.x; b.p[i + 1] -= c.y; b.p[i + 2] -= c.z; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    if (b.n.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); else g.computeVertexNormals();
    if (b.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const mesh = new THREE.Mesh(g, b.mat); mesh.position.copy(c); mesh.castShadow = true;
    const out = new THREE.Vector3().subVectors(c, center).setY(0);
    if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize().multiplyScalar(0.5 + Math.random() * 1.2);
    mesh.userData = { vel: new THREE.Vector3(out.x, 1.0 + Math.random() * 1.8 + (c.y - center.y) * 1.2, out.z),
      spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9), rest: false };
    fxGroup.add(mesh); shards.push(mesh);
  }
  // вспышка в момент разрушения
  const f = glowSprite(0xffe0b0, 0.4); f.position.copy(center); fxGroup.add(f);
  anims.push({ t: 0, dur: 0.3, f: k => { f.scale.setScalar(0.4 + k * 1.4); f.material.opacity = 0.9 * (1 - k); }, end: () => { fxGroup.remove(f); f.material.dispose(); } });
  const DUR = 2.6, FADE_FROM = 0.9;
  let last = 0;
  anims.push({ t: 0, dur: DUR, f: k => {
    const t = k * DUR, dt = t - last; last = t;
    for (const s of shards) {
      const u = s.userData;
      if (!u.rest) {
        u.vel.y -= 9.8 * dt;
        s.position.addScaledVector(u.vel, dt);
        s.rotation.x += u.spin.x * dt; s.rotation.y += u.spin.y * dt; s.rotation.z += u.spin.z * dt;
        if (s.position.y < 0.04) {                 // удар о доску: отскок с потерей скорости
          s.position.y = 0.04; u.vel.y *= -0.28; u.vel.x *= 0.55; u.vel.z *= 0.55; u.spin.multiplyScalar(0.5);
          if (Math.abs(u.vel.y) < 0.4) { u.rest = true; }
        }
      }
    }
    const op = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (DUR - FADE_FROM);
    for (const m of mats.values()) { m.opacity = Math.max(0, op); m.depthWrite = op > 0.6; }
  }, end: () => {
    for (const s of shards) { fxGroup.remove(s); s.geometry.dispose(); }
    for (const m of mats.values()) m.dispose();
  } });
}

/* ---------- кадр ---------- */
const easeOut = k => 1 - Math.pow(1 - k, 3);
const easeIn = k => k * k * k;
const easeInOut = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
let fireflies;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const spd = +(FC.SET && FC.SET.animSpeed) || 1;            // скорость анимаций из настроек
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += dt * spd; const k = Math.min(1, a.t / a.dur); a.f(k);
    if (k >= 1) { anims.splice(i, 1); if (a.end) a.end(); }
  }
  for (const e of pieces.values()) {
    const goal = (e.baseY || 0) + (e.lifted ? 0.18 : 0);   // baseY — высота клетки (тёмные клетки демонической доски утоплены)
    if (!anims.some(a => a.obj === e.obj)) e.obj.position.y += (goal - e.obj.position.y) * Math.min(1, dt * 10);
  }
  const pulse = 0.55 + 0.45 * Math.sin(t * 5);
  const slow = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.2));     // медленное мерцание сдвига линий
  hlGroup.traverse(o => { if (o.material && o.material.userData.base != null) o.material.opacity = o.material.userData.base * (o.material.userData.slow ? slow : pulse); });
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
function addLabels() {   // буквы и цифры по краю доски — пересобираются при смене доски
  if (!labelGroup) { labelGroup = new THREE.Group(); scene.add(labelGroup); }
  labelGroup.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  labelGroup.clear();
  for (let i = 0; i < 8; i++) {
    const f = textSprite('abcdefgh'[i], '#d6c9a8', null, 64, 0.32); f.position.copy(cellPos(i, -0.62)); f.position.y = 0.15; labelGroup.add(f);
    const r = textSprite(String(i + 1), '#d6c9a8', null, 64, 0.32); r.position.copy(cellPos(-0.62, i)); r.position.y = 0.15; labelGroup.add(r);
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
        if (down.touch) { const p = cellPos(c[0], c[1]); hoverMark.position.copy(p); hoverMark.visible = true; }
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
    if (c) { const p = cellPos(c[0], c[1]); hoverMark.position.copy(p); hoverMark.visible = true; FC.UI.hover(c[0], c[1], e.clientX, e.clientY); }
    else { hoverMark.visible = false; FC.UI.hover(null); }
  });
  el.addEventListener('pointerleave', () => { hoverMark.visible = false; FC.UI.hover(null); });
}

/* ---------- камера ---------- */
const PRESETS = { iso: { polar: 0.95, az: Math.PI / 4, dist: 14 }, angled: { polar: 0.72, az: 0, dist: 13 }, top: { polar: 0.02, az: 0, dist: 15 } };
/* Режимы камеры: 'free' — остаётся там, куда её повернул игрок (по умолчанию);
   'turn' — после каждого хода поворачивается к стороне ходящего (против компьютера — к человеку). */
const readMode = () => { try { return localStorage.getItem('fc.cam') === 'turn' ? 'turn' : 'free'; } catch (e) { return 'free'; } };
let preset = 'iso', rot = 0, camMode = readMode(), tween = null;
function viewSide() {
  const G = FC.UI.G, ai = FC.UI.ai || [false, false];
  if (!G) return 0;
  if (FC.UI.netSide != null) return FC.UI.netSide;   // онлайн-игра — всегда со своей стороны
  if (ai[0] !== ai[1]) return ai[0] ? 1 : 0;   // против компьютера — всегда со стороны человека
  return camMode === 'turn' ? G.turn : 0;
}
// opts: { instant, keepAz } — keepAz: не менять поворот (свободная камера), только наклон и расстояние
function setView(instant, keepAz) {
  const p = PRESETS[preset];
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const az = keepAz && camera.position.lengthSq() ? sph.theta + rot : p.az + rot + viewSide() * Math.PI;
  rot = keepAz ? 0 : rot;
  const goal = { polar: p.polar, az, dist: p.dist };
  if (instant || !camera.position.lengthSq()) {
    camera.position.setFromSpherical(new THREE.Spherical(goal.dist, goal.polar, goal.az)); return;
  }
  let daz = goal.az - sph.theta; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
  tween = { t: 0, dur: 0.9, from: { polar: sph.phi, az: sph.theta, dist: sph.radius }, to: { polar: goal.polar, az: sph.theta + daz, dist: goal.dist } };
}
// вид при старте партии — из настроек (Камера → «Вид при старте партии»)
function startPreset() {
  const v = FC.SET && FC.SET.view;
  if (!v || !PRESETS[v]) return;
  preset = v;
  for (const o of document.querySelectorAll('#views [data-preset]')) o.classList.toggle('on', o.dataset.preset === v);
}
function camTween(dt) {
  if (!tween) return;
  tween.t += dt; const k = easeInOut(Math.min(1, tween.t / tween.dur)), f = tween.from, g = tween.to;
  camera.position.setFromSpherical(new THREE.Spherical(f.dist + (g.dist - f.dist) * k, f.polar + (g.polar - f.polar) * k, f.az + (g.az - f.az) * k));
  if (k >= 1) tween = null;
}
function bindCameraUI() {
  const presetBtns = document.querySelectorAll('#views [data-preset]');
  for (const b of presetBtns) b.onclick = () => {
    preset = b.dataset.preset;
    for (const o of presetBtns) o.classList.toggle('on', o === b);
    if (camMode === 'free') setView(false, true); else { rot = 0; setView(); }
  };
  const turn = d => { if (camMode === 'free') { rot = d; setView(false, true); } else { rot += d; setView(); } };
  const zoom = f => { const p = PRESETS[preset]; p.dist = Math.min(24, Math.max(6, p.dist * f)); setView(false, camMode === 'free'); };
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('rotL', () => turn(-Math.PI / 2));
  on('rotR', () => turn(Math.PI / 2));
  for (const r of document.querySelectorAll('input[name="cammode"]')) {
    r.checked = r.value === camMode;
    r.onchange = () => {
      camMode = r.value;
      try { localStorage.setItem('fc.cam', camMode); } catch (e) { }
      rot = 0; setView();                 // сразу показать поле со стороны нужного игрока
    };
  }
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || /INPUT|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'й') turn(-Math.PI / 2); else if (k === 'e' || k === 'у') turn(Math.PI / 2);
    else if (k === '+' || k === '=') zoom(1 / 1.15); else if (k === '-') zoom(1.15);
    else if ('123'.includes(k) && k) presetBtns[+k - 1].click();
  });
}

/* ---------- жеребьёвка: монетка подлетает над центром доски и падает стороной «Б» или «Ч» ---------- */
function coinFace(letter, fg, bg) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8860b'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = bg; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#facc15'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.stroke();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 130px "Segoe UI",sans-serif';
  g.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function coinToss(first, done) {
  if (!ready) { setTimeout(() => coinToss(first, done), 200); return; }
  const R = 0.62;
  const rim = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.85, roughness: 0.3, emissive: 0x3a2a00, emissiveIntensity: 0.4 });
  const top = new THREE.MeshStandardMaterial({ map: coinFace('Б', '#111827', '#f3f4f6'), metalness: 0.4, roughness: 0.4 });
  const bot = new THREE.MeshStandardMaterial({ map: coinFace('Ч', '#f3f4f6', '#111827'), metalness: 0.4, roughness: 0.4 });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.09, 56), [rim, top, bot]);
  coin.castShadow = true;
  const c0 = cellPos(3.5, 3.5);
  // монетка в «подвесе», развёрнутом к камере, — чтобы буква читалась ровно, откуда бы ни смотрел игрок
  const holder = new THREE.Group();
  holder.position.set(c0.x, 0, c0.z);
  holder.rotation.y = Math.atan2(camera.position.x - c0.x, camera.position.z - c0.z) + Math.PI;
  holder.add(coin); fxGroup.add(holder);
  coin.position.set(0, 0.15, 0);
  const glow = glowSprite(0xffd76a, 0.1); glow.position.set(c0.x, 0.2, c0.z); fxGroup.add(glow);
  const D = 2.3, finalA = first === 0 ? 0 : Math.PI, spins = 7 * Math.PI * 2;
  anims.push({ t: 0, dur: D, f: k => {
    const h = Math.sin(Math.PI * k) * 3.4 * (1 - 0.15 * k);
    coin.position.y = 0.15 + h;
    coin.rotation.x = (spins + finalA) * easeOut(k);
    coin.rotation.z = Math.sin(k * 9) * 0.25 * (1 - k);
    glow.position.y = coin.position.y; glow.scale.setScalar(0.4 + h * 0.25); glow.material.opacity = 0.6 * Math.sin(Math.PI * k);
  }, end: () => {
    // приземление: лёгкий отскок, вспышка, затем монетка тает
    const ring = flat(new THREE.RingGeometry(0.5, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.05);
    ring.position.x = c0.x; ring.position.z = c0.z; fxGroup.add(ring);
    anims.push({ t: 0, dur: 0.7, f: k => { ring.scale.setScalar(1 + k * 2.2); ring.material.opacity = 1 - k; coin.position.y = 0.15 + Math.abs(Math.sin(k * Math.PI * 2)) * 0.25 * (1 - k); },
      end: () => { fxGroup.remove(ring); ring.geometry.dispose(); ring.material.dispose(); } });
    later(1.6, () => anims.push({ t: 0, dur: 0.45, f: k => { coin.scale.setScalar(Math.max(0.01, 1 - k)); coin.position.y = 0.15 + k * 0.6; }, end: () => {
      fxGroup.remove(holder, glow); coin.geometry.dispose(); [rim, top, bot].forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); glow.material.dispose();
      if (done) done();
    } }));
  } });
}

// куда на экране смотрит направление доски (dx, dy) — угол в радианах (0 — вправо, +π/2 — вверх); для джойстика сдвига
function screenAngle(dx, dy) {
  if (!camera) return Math.atan2(dy, dx);
  const a = cellPos(3.5, 3.5).project(camera), b = cellPos(3.5 + dx, 3.5 + dy).project(camera);
  const aspect = renderer ? renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight) : 1;
  return Math.atan2(b.y - a.y, (b.x - a.x) * aspect);
}
FC.GL = { render, coinToss, screenAngle, fxCount: () => fxGroup.children.length, hlCount: () => hlGroup.children.length,
  hlSnap: () => { const r = []; hlGroup.traverse(o => { if (o.material) r.push([o.material.opacity.toFixed(2), !!o.material.userData.slow, o.position.y.toFixed(3), o.parent && o.parent.position.x.toFixed(2)]); }); return r.slice(0, 6); },
  shot: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.6); } };   // fxCount, hlCount, hlSnap, shot — для автопроверки
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init); else init();
