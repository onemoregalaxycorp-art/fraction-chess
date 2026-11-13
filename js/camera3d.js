'use strict';
/* Камера 3D-поля: пресеты (изометрия / под углом / сверху), поворот, масштаб, «камера за игроком» */
(function (FC) {
  const root = document.documentElement;
  const PRESETS = { iso: { rx: 58, rz: -45 }, angled: { rx: 40, rz: 0 }, top: { rx: 0, rz: 0 } };
  let preset = 'iso', rot = 0, zoomUser = 1, follow = true, side = 0, lastSide = null;
  const $ = id => document.getElementById(id);

  function viewSide(G, ai) {
    if (!follow || !G) return 0;
    if (ai[0] !== ai[1]) return ai[0] ? 1 : 0;     // против компьютера — камера всегда со стороны человека
    return G.turn;                                // два игрока — камера переходит к тому, чей ход
  }
  function apply() {
    const p = PRESETS[preset];
    root.style.setProperty('--rx', p.rx + 'deg');
    root.style.setProperty('--rz', (p.rz + rot + side * 180) + 'deg');
    fit();
  }
  function fit() {
    const st = $('stage'); if (!st) return;
    const cs = parseFloat(getComputedStyle(root).getPropertyValue('--cs3')) || 60;
    const span = 8 * cs + 40;
    const p = PRESETS[preset];
    const diagonal = Math.abs(((p.rz + rot) % 90 + 90) % 90 - 45) < 1;   // доска повёрнута ромбом
    const w = span * (diagonal ? 1.42 : 1.05);
    const h = w * Math.cos(p.rx * Math.PI / 180) + (p.rx ? cs * 1.3 : 0);
    const z = Math.min(1.6, (st.clientWidth - 30) / w, (st.clientHeight - 30) / h);
    root.style.setProperty('--zoom', (Math.max(0.35, z) * zoomUser).toFixed(3));
  }
  function setPreset(name) {
    preset = name;
    for (const b of document.querySelectorAll('#camctl [data-preset]')) b.classList.toggle('on', b.dataset.preset === name);
    apply();
  }
  const turn = d => { rot += d; apply(); };
  const zoom = f => { zoomUser = Math.min(2.2, Math.max(0.5, zoomUser * f)); fit(); };

  window.addEventListener('DOMContentLoaded', () => {
    for (const b of document.querySelectorAll('#camctl [data-preset]')) b.onclick = () => setPreset(b.dataset.preset);
    $('rotL').onclick = () => turn(-90); $('rotR').onclick = () => turn(90);
    $('zoomIn').onclick = () => zoom(1.15); $('zoomOut').onclick = () => zoom(1 / 1.15);
    $('follow').onchange = e => { follow = e.target.checked; lastSide = null; FC.UI.G && FC.UI.onRender(FC.UI.G, FC.UI.ai); };
    $('stage').addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || /INPUT|SELECT/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'й') turn(-90);
      else if (k === 'e' || k === 'у') turn(90);
      else if (k === '+' || k === '=') zoom(1.15);
      else if (k === '-') zoom(1 / 1.15);
      else if (k === '1') setPreset('iso'); else if (k === '2') setPreset('angled'); else if (k === '3') setPreset('top');
    });
    window.addEventListener('resize', fit);
    apply();
  });

  FC.UI.onRender = (G, ai) => {
    side = viewSide(G, ai);
    if (side !== lastSide) { lastSide = side; apply(); }
    else fit();
  };
})(window.FC);
