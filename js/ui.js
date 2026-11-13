'use strict';
/* FRACTION CHESS — интерфейс */
(function (FC) {
  const $ = id => document.getElementById(id);
  let G = null, sel = null, ctx = null, ai = [false, false], busy = false, specialHint = 0;
  let tutorMode = false;   // режим обучения: бот (Чёрные) объясняет свои ходы в окне наставника
  let threatCache = { key: '', val: [false, false] };

  const ASSUMPTIONS = [
    'Шах: лидер (Король, Шаман, Филактерий) не может ходить под удар, и нельзя оставлять его под ударом. Мат — поражение. Пат (нет ни одного допустимого хода) — тоже поражение того, кому некуда ходить.',
    'Ничья: если одна и та же позиция повторилась 3 раза, или прошло 50 ходов каждой стороны без единого взятия (превращение Личем тоже считается взятием). Счётчики появляются вверху, когда ничья близко.',
    'У Демонов нет шаха и мата: Призыватель и Король демонов могут стоять и ходить под удар. Демоны проигрывают, только когда мертвы и Призыватель, и Король демонов (или Король пал, а Призывателю некого принести в жертву). Если Призыватель погиб, а Король жив — игра продолжается.',
    'Импы появляются у ближайшего Обелиска, когда любая фигура Демонов, кроме Импа, берёт вражескую фигуру.',
    'Нежить: на доске не больше 12 Скелетов — при попытке призвать больше вверху появится предупреждение.',
    'После гибели Короля демонов следующий ход Демонов уходит на жертвоприношение (2-е нажатие на Призывателя). Нет жертвы — поражение.',
    'У каждой фигуры Демонов свой похищенный ход (🎭 на фигуре).',
    'Орк-воин, Вождь, Хоп-гоблин и Шаман едят две фигуры подряд, если те стоят вплотную друг к другу; у Гоблина, Плута и Всадника этого нет. Дальность Орка-воина — 5 клеток. «Двойной прорыв» через промежуток (2-е нажатие) — у Орка-воина, Вождя орды и Гоблина-плута. Гоблин-плут ходит как слон, прыгает только через своих и после взятия шагает ещё на 1 клетку.',
    'Перезарядка дальней атаки: после выстрела следующий свой ход без дальней атаки.',
    'Пешка, оказавшаяся на дальнем краю доски любым способом (своим ходом, сдвигом линии, рокировкой, притягиванием, появившись там), сразу превращается.',
    'Проклятие Пожирателя душ держится до конца следующего хода Нежити.',
    'Ходы можно отматывать назад и вперёд без ограничений: «↶ Ход назад» (Ctrl+Z) и «↷ Ход вперёд» (Ctrl+Y). Новый ход после отмены стирает отменённые.',
    'Выбрать можно только фигуры стороны, чья сейчас очередь.',
    'Полный разбор — в файле ANALYSIS.md.'
  ];

  function init() {
    for (const i of [0, 1]) {
      const s = $('f' + i);
      for (const id in FC.FACTIONS) { const o = document.createElement('option'); o.value = id; o.textContent = FC.FACTIONS[id].name; s.appendChild(o); }
      s.value = Object.keys(FC.FACTIONS)[i === 0 ? 0 : 1];
      s.onchange = () => descFaction(i);
      descFaction(i);
    }
    $('startBtn').onclick = () => { tutorMode = false; startGame(); };
    if ($('tutorBtn')) $('tutorBtn').onclick = () => { tutorMode = true; $('ai0').checked = false; $('ai1').checked = true; startGame(); };
    if ($('tutorHead')) $('tutorHead').onclick = () => {
      const t = $('tutor'); t.classList.toggle('min'); t.classList.remove('unread');
      $('tutorMin').textContent = t.classList.contains('min') ? '+' : '–';
      $('tutorLog').scrollTop = $('tutorLog').scrollHeight;
    };
    $('newGame').onclick = () => { closeMenu(); modal('Начать новую игру?', [{ label: 'Да', fn: toSetup }, { label: 'Отмена' }]); };
    $('rulesBtn').onclick = () => { closeMenu(); modal('<b>Правила прототипа</b><ul>' + ASSUMPTIONS.map(a => `<li>${a}</li>`).join('') + '</ul>', [{ label: 'Понятно' }]); };
    $('undoBtn').onclick = undo;
    $('redoBtn').onclick = redo;
    for (const b of document.querySelectorAll('.cardsBtn')) b.onclick = () => { closeMenu(); openCards(); };
    $('cardsClose').onclick = () => $('cards').classList.add('hidden');
    initHud();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('cards').classList.add('hidden'); closeMenu(); closeSettings(); setPanel(false); }
      const k = e.key.toLowerCase();
      if (e.ctrlKey && (k === 'y' || k === 'н' || (e.shiftKey && (k === 'z' || k === 'я')))) { e.preventDefault(); redo(); }
      else if (e.ctrlKey && (k === 'z' || k === 'я')) { e.preventDefault(); undo(); }
    });
    const b = $('board');
    if (b) {   // на WebGL-странице доски из клеток нет — ввод идёт из js/gl/board3d.js
      b.addEventListener('click', e => { const c = e.target.closest('.cell'); if (c) onCell(+c.dataset.x, +c.dataset.y); });
      b.addEventListener('mousemove', onHover);
      b.addEventListener('mouseleave', () => $('tip').classList.add('hidden'));
      b.addEventListener('contextmenu', e => { e.preventDefault(); sel = null; ctx = null; render(); });
    }
    if ($('legend')) renderLegend();
  }

  /* ---------- HUD WebGL-страницы: меню, журнал, карточка фигуры, предупреждения ---------- */
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };
  let swallowUntil = 0;
  function closeMenu() { if ($('menu')) { $('menu').classList.add('hidden'); $('menuBtn').classList.remove('open'); } }
  function setPanel(open) {
    if (!$('piecePanel')) return;
    $('piecePanel').classList.toggle('hidden', !open);
    $('pieceBtn').classList.toggle('open', !!open);
  }
  /* ---------- настройки (хранятся в localStorage как fc.set; читает и js/gl/board3d.js) ---------- */
  const SET_DEF = { mm: true, mmOp: 85, mmSize: 'm', hist: true, histOp: 85, tips: true, view: 'iso', train: false, trThreat: true, trDef: false,
    animSpeed: '1', aiDepth: '3', aiPause: '700', lineConfirm: true };
  const SET = FC.SET = Object.assign({}, SET_DEF, (() => { try { return JSON.parse(store.get('fc.set') || '{}'); } catch (e) { return {}; } })());
  function saveSet() { store.set('fc.set', JSON.stringify(SET)); }
  function applySet() {
    const tl = $('hudTL') && $('game');                     // размер карты нужен и меню/настройкам (они открываются справа от неё)
    if (tl) { tl.classList.remove('mm-s', 'mm-l'); if (SET.mmSize !== 'm') tl.classList.add('mm-' + SET.mmSize); }
    if ($('minimap')) { $('minimap').classList.toggle('hidden', !SET.mm); $('minimap').style.setProperty('--mmop', SET.mmOp / 100); }
    if ($('logDock')) { $('logDock').classList.toggle('hidden', !SET.hist); $('logDock').style.setProperty('--histop', SET.histOp / 100); }
    if (FC.AI) FC.AI.depth = +SET.aiDepth;
    // все переключатели с одним ключом (в меню и в настройках) показывают одно и то же
    for (const el of document.querySelectorAll('[data-set]')) {
      const k = el.dataset.set, v = SET[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else el.value = v;
    }
    for (const o of document.querySelectorAll('[data-out]')) o.textContent = SET[o.dataset.out] + '%';
  }
  function bindSet() {
    for (const el of document.querySelectorAll('[data-set]')) {
      const k = el.dataset.set;
      const on = () => {
        if (el.type === 'checkbox') SET[k] = el.checked;
        else if (el.type === 'radio') { if (!el.checked) return; SET[k] = el.value; }
        else SET[k] = el.type === 'range' ? +el.value : el.value;
        saveSet(); applySet();
        if (G) render();
      };
      el.addEventListener(el.type === 'range' ? 'input' : 'change', on);
    }
    applySet();
  }
  function openSettings(sec) {
    const s = $('settings'); if (!s) return;
    closeMenu(); setPanel(false);
    s.classList.remove('hidden'); $('setBtn').classList.add('open');
    if (sec) showSec(sec);
  }
  function closeSettings() { if ($('settings')) { $('settings').classList.add('hidden'); $('setBtn').classList.remove('open'); } }
  function showSec(sec) {
    for (const b of document.querySelectorAll('#setTabs button')) b.classList.toggle('on', b.dataset.sec === sec);
    for (const p of document.querySelectorAll('#setPane section')) p.hidden = p.dataset.sec !== sec;
    $('setPane').scrollTop = 0;
  }
  function initHud() {
    bindSet();
    if (!$('menuBtn')) return;
    $('menuBtn').onclick = e => {
      e.stopPropagation();
      const open = $('menu').classList.contains('hidden');
      closeSettings();
      $('menu').classList.toggle('hidden', !open); $('menuBtn').classList.toggle('open', open);
      if (open) setPanel(false);
    };
    if ($('setBtn')) {
      $('setBtn').onclick = e => { e.stopPropagation(); if ($('settings').classList.contains('hidden')) openSettings(); else closeSettings(); };
      $('setClose').onclick = closeSettings;
      for (const b of document.querySelectorAll('#setTabs button')) b.onclick = () => showSec(b.dataset.sec);
    }
    $('menu').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('pointerdown', e => {          // нажатие мимо меню/настроек — закрыть их
      const menuOpen = !$('menu').classList.contains('hidden'), setOpen = $('settings') && !$('settings').classList.contains('hidden');
      if ((menuOpen || setOpen) && !e.target.closest('#menu, #menuBtn, #settings, #setBtn, #minimap')) {
        closeMenu(); closeSettings();
        swallowUntil = performance.now() + 600;          // это нажатие только закрывает окно, по доске не срабатывает
      }
    });
    $('logBtn').onclick = () => {
      closeMenu();
      modal('<b>Журнал событий</b><div class="fullLog">' + (G ? G.logs.slice().reverse().map(l => `<div>${l}</div>`).join('') : '') + '</div>', [{ label: 'Закрыть' }]);
    };
    if ($('minimap')) $('minimap').addEventListener('click', e => {
      const c = e.target.closest('.mc'); if (c) { closeMenu(); closeSettings(); onCell(+c.dataset.x, +c.dataset.y); }
    });
    $('pieceBtn').onclick = () => { closeMenu(); closeSettings(); setPanel($('piecePanel').classList.contains('hidden')); };
    $('pieceClose').onclick = () => setPanel(false);
    $('players').onclick = () => $('players').classList.toggle('expanded');
    // раздел «Анимации»: плитки, выбор хранится в localStorage (fc.anim.<ключ>), его читает js/gl/board3d.js
    const DEF = { priest: 'prayer', obelisk: 'sink' };
    $('animBtn').onclick = () => openSettings('anim');
    for (const box of document.querySelectorAll('.atiles')) {
      const key = box.dataset.key, cur = store.get('fc.anim.' + key) || DEF[key];
      for (const t of box.querySelectorAll('.atile')) {
        t.classList.toggle('on', t.dataset.val === cur);
        t.onclick = () => {
          store.set('fc.anim.' + key, t.dataset.val);
          for (const o of box.querySelectorAll('.atile')) o.classList.toggle('on', o === t);
        };
      }
    }
  }
  let toastTimer = 0;
  function toast(msg, icon) {
    const t = $('toast');
    if (!t) return;
    t.textContent = (icon == null ? '⚠' : icon) + ' ' + msg; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);   // уведомление держится 5 секунд
  }
  const diaCache = {};
  const neonDiagram = type => diaCache[type] || (diaCache[type] = `<div class="neon">${diagram(type)}<div class="neon-cap">схема ходов</div></div>`);

  function descFaction(i) {
    const F = FC.FACTIONS[$('f' + i).value];
    const types = [...new Set(F.back.concat(F.pawn))].map(t => FC.PIECES[t].name);
    $('fd' + i).innerHTML = `<p>${F.desc}</p><p class="small">${types.join(' · ')}</p>`;
    $('fd' + i).style.borderColor = F.color;
  }
  /* ---------- наставник (режим обучения) ---------- */
  const TUTOR_SIDE = 1;
  function tutorSay(html, cls) {
    const log = $('tutorLog'); if (!log || !tutorMode) return;
    const d = document.createElement('div');
    d.className = 'tmsg ' + (cls || 'bot');
    d.innerHTML = (G ? `<div class="tturn">ход ${G.turnNo}</div>` : '') + html;
    log.appendChild(d);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if ($('tutor').classList.contains('min')) $('tutor').classList.add('unread');   // свёрнуто — мигаем значком
  }
  function tutorStart() {
    const t = $('tutor'); if (!t) return;
    t.classList.toggle('hidden', !tutorMode);
    if (!tutorMode) return;
    $('tutorLog').innerHTML = '';
    const sp = FC.Tutor.speaker(G, TUTOR_SIDE);
    t.style.setProperty('--tc', sp.color);
    $('tutorAva').textContent = sp.glyph;
    $('tutorName').innerHTML = `${sp.name}<small>наставник · ${G.faction(TUTOR_SIDE).name} (Чёрные)</small>`;
    tutorSay(FC.Tutor.intro(G, TUTOR_SIDE), 'sys');
  }

  function toSetup() { G = null; busy = false; sel = null; ctx = null; closeMenu(); setPanel(false); if ($('tutor')) $('tutor').classList.add('hidden'); if ($('pieceBtn')) $('pieceBtn').classList.add('hidden'); $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); }

  function startGame() {
    G = new FC.Game($('f0').value, $('f1').value);
    ai = [$('ai0').checked, $('ai1').checked];
    sel = null; ctx = null; busy = false;
    const first = Math.random() < 0.5 ? 0 : 1;
    // 3D-поле: сначала открывается доска, и монетку подбрасывают прямо над ней
    if (FC.GL && FC.GL.coinToss) {
      closeMenu(); $('setup').classList.add('hidden'); $('game').classList.remove('hidden');
      G.turn = first; busy = true;
      const game = G;
      render();
      if ($('banner')) $('banner').innerHTML = '🪙 Жеребьёвка: монетка в воздухе…';
      FC.GL.coinToss(first, () => {
        if (game !== G) return;                           // за это время начали новую партию
        busy = false;
        G.log(`Бросок монеты: первыми ходят ${FC.COLOR_NAME[first]}`);
        toast(`Выпало «${first ? 'Ч' : 'Б'}» — первыми ходят ${FC.COLOR_NAME[first]} (${G.faction(first).name})`, '🪙');
        tutorStart();
        render(); maybeAI();
      });
      return;
    }
    const coin = $('coinEl');
    $('coin').classList.remove('hidden'); $('coinOk').classList.add('hidden'); $('coinText').innerHTML = 'Монета в воздухе…';
    coin.style.transition = 'none'; coin.style.transform = 'rotateY(0deg)';
    void coin.offsetWidth;
    coin.style.transition = 'transform 2.2s cubic-bezier(.2,.7,.2,1)';
    coin.style.transform = `rotateY(${1800 + (first ? 180 : 0)}deg)`;
    setTimeout(() => {
      $('coinText').innerHTML = `Выпало: <b>${first ? 'Ч' : 'Б'}</b> — первым ходят <b>${FC.COLOR_NAME[first]}</b> (${G.faction(first).name})`;
      $('coinOk').classList.remove('hidden');
    }, 2300);
    $('coinOk').onclick = () => {
      $('coin').classList.add('hidden'); $('setup').classList.add('hidden'); $('game').classList.remove('hidden');
      G.turn = first;
      G.log(`Бросок монеты: первыми ходят ${FC.COLOR_NAME[first]}`);
      tutorStart();
      render(); maybeAI();
    };
  }

  /* ---------- ввод ---------- */
  // действие относится к клетке: основная клетка или одна из клеток выбранной линии (сдвиги Хтони)
  const onCellOf = (a, x, y) => (a.x === x && a.y === y) || !!(a.alt && a.alt.some(c => c[0] === x && c[1] === y));
  const cellsOf = a => [[a.x, a.y]].concat(a.alt || []);
  function select(x, y, mode) {
    const p = G.at(x, y);
    sel = { x, y, mode, own: G.canAct(p, G.turn) };
    specialHint = 0;
    if (sel.own) {
      ctx = G.legalActionsFor(x, y, mode);
      ctx.ghost = [];
      const warns = (ctx.warns || []).slice();
      if (mode === 'normal') {
        // особые действия видны и кликабельны уже при 1-м нажатии (тусклыми маркерами)
        const sp = G.legalActionsFor(x, y, 'special');
        // по 1-му нажатию — только ходы: выстрелы и сдвиги линий видны лишь по 2-му нажатию на фигуру
        ctx.ghost = sp.acts.filter(a => !a.line && a.kind !== 'ranged');
        specialHint = ctx.ghost.length;
        for (const w of (sp.warns || [])) if (!warns.includes(w)) warns.push(w);
      }
      if (warns.length) toast(warns[0]);
      if (tutorMode && mode === 'normal' && !ai[p.owner]) { const h = FC.Tutor.pieceHint(G, x, y); if (h) tutorSay(h, 'hint'); }
    } else {
      ctx = { acts: [], obstacles: [], notes: ['Сейчас ход соперника — ходы этой фигуры не показываются.'] };
    }
  }
  function onCell(x, y) {
    if (!G || G.winner != null || busy) return;
    if (linePrev) { clearPreview(); render(); return; }        // нажатие на доску во время предпросмотра — отмена
    const pend = G.nextPending();
    if (pend) {
      if (ai[pend.owner]) return;
      if (pend.kind === 'cells') { const c = pend.cells.find(c => c.x === x && c.y === y); if (c) { G.resolvePending(c); afterAction(); } }
      return;
    }
    // сдвиг линий (ТХ'Зсал, Ксал'Таргон): нажатие на клетку выбирает её линии, дальше — джойстик справа
    const la = shiftActs();
    if (la) {
      if (x === sel.x && y === sel.y) { sel = null; ctx = null; shift = null; render(); return; }
      if (la.some(a => onCellOf(a, x, y))) { shift.cell = [x, y]; shift.dir = null; shift.dist = 0; render(); return; }
    }
    if (sel && ctx && sel.own && !ai[G.turn]) {
      const acts = ctx.acts.filter(a => onCellOf(a, x, y) && !(la && a.line));
      let ghost = (ctx.ghost || []).filter(a => onCellOf(a, x, y));
      // 1-е нажатие: если фигура вообще может пойти на эту клетку (например, Король), клик — это ход,
      // а не призыв; призыв туда — только 2-м нажатием на фигуру
      if (ghost.length && sel.mode === 'normal' && G.actionsFor(sel.x, sel.y, 'normal').acts.some(a => a.x === x && a.y === y)) {
        ghost = ghost.filter(a => a.kind !== 'summon' && a.kind !== 'revive');
        if (!acts.length && !ghost.length) { toast('Туда ходить нельзя: поле под ударом. Чтобы призвать фигуру — нажмите на неё ещё раз.'); return; }
      }
      if (acts.length || ghost.length) { chooseAction(acts.concat(ghost)); return; }
    }
    const p = G.at(x, y);
    if (p && G.canAct(p, G.turn) && !ai[G.turn]) {
      // 1-е нажатие — выбрать (фигура приподнимается), 2-е — способности (если есть), 3-е — снять выбор
      const same = sel && sel.x === x && sel.y === y;
      if (!same) select(x, y, 'normal');
      else if (sel.mode === 'normal' && hasAbility(x, y)) {
        select(x, y, 'special');
        if (shiftActs()) toast('Нажмите на клетку — замерцают её линии, а справа появится джойстик сдвига', '🌀');
      }
      else { sel = null; ctx = null; }
    } else if (p) {
      return; // фигура стороны, чья очередь ещё не наступила, — ничего не выделяем
    } else { sel = null; ctx = null; }
    render();
  }
  // есть ли у фигуры способности по 2-му нажатию (даже если сейчас они недоступны — тогда покажем причину)
  function hasAbility(x, y) {
    const p = G.at(x, y); if (!p) return false;
    const d = G.def(p);
    if (d.special || p.stolen) return true;
    const sp = G.legalActionsFor(x, y, 'special');
    return !!(sp.acts.length || (sp.notes && sp.notes.length));
  }
  function chooseAction(acts) {
    // сдвиг линии (ТХ'Зсал): сначала показать стрелками на доске, куда сдвинется линия, потом подтвердить
    const go = a => a.dir && SET.lineConfirm ? previewLine(a) : tryExec(a);
    if (acts.length === 1) return go(acts[0]);
    modal('Выберите действие:', acts.map(a => ({ label: a.label, cls: 'k-' + a.kind, fn: () => go(a) })).concat([{ label: 'Отмена' }]));
  }
  let linePrev = null;
  function lineBar(a) {
    let el = document.getElementById('lineBar');
    if (!el) { el = document.createElement('div'); el.id = 'lineBar'; document.body.appendChild(el); }
    if (!a) { el.classList.add('hidden'); return; }
    el.innerHTML = `<span>${a.label}</span>`;
    const ok = document.createElement('button'); ok.textContent = '✔ Применить'; ok.className = 'k-special';
    const no = document.createElement('button'); no.textContent = '✖ Отмена';
    ok.onclick = () => { const x = linePrev; linePrev = null; lineBar(null); if (x) tryExec(x); };
    no.onclick = () => { linePrev = null; lineBar(null); render(); };
    el.append(ok, no);
    el.classList.remove('hidden');
  }
  let linePrevKey = null;
  const posKey = () => G ? [G.turnNo, G.turn, G.history.length, G.logs.length].join(':') : '';
  function previewLine(a) { linePrev = a; linePrevKey = { G, k: posKey() }; lineBar(a); render(); }
  function clearPreview() { if (linePrev) { linePrev = null; lineBar(null); } }
  /* ---------- сдвиг линий: мерцающее поле + джойстик «коробка передач» ---------- */
  // shift = { sel, cell, dir: 'dx,dy', dist, part } — живёт, пока выбрана та же фигура во 2-м режиме
  let shift = null;
  function shiftActs() {
    if (!G || !sel || sel.mode !== 'special' || !sel.own || !ctx || ai[G.turn] || G.nextPending()) { shift = null; return null; }
    const la = ctx.acts.filter(a => a.line && a.dir);
    if (!la.length) { shift = null; return null; }
    if (!shift || shift.sel !== sel || shift.G !== G) shift = { sel, G, cell: null, dir: null, dist: 0, part: true };
    return la;
  }
  // варианты для выбранной клетки: { 'dx,dy': { dir, dists: { 1: [acts], 2: [...] } } }
  function shiftOptions(la) {
    const o = {};
    if (!shift || !shift.cell) return o;
    for (const a of la) {
      if (!onCellOf(a, shift.cell[0], shift.cell[1])) continue;
      const k = a.dir.join(',');
      const e = o[k] = o[k] || { dir: a.dir, dists: {} };
      (e.dists[a.dist || 1] = e.dists[a.dist || 1] || []).push(a);
    }
    return o;
  }
  function shiftPick(la) {
    if (!shift || !shift.dir || !shift.dist) return null;
    const e = shiftOptions(la)[shift.dir]; if (!e) return null;
    const v = e.dists[shift.dist]; if (!v) return null;
    return v.find(a => a.part == null || a.part === shift.part) || v[0];
  }
  // поворот звезды джойстика под камеру: направление «вправо по доске» округляется до 45°
  function padRot() {
    if (!FC.GL || !FC.GL.screenAngle) return 0;
    const a = FC.GL.screenAngle(1, 0);
    return Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  }
  function renderPad() {
    let el = document.getElementById('shiftPad');
    const la = shiftActs();
    if (!la || !shift.cell) { if (el) el.classList.add('hidden'); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'shiftPad';
      ($('game') || document.body).appendChild(el);
    }
    el.classList.remove('hidden');
    const opts = shiftOptions(la), pick = shiftPick(la);
    const R = 110, rot = padRot();
    // кристаллы стоят в каменном кольце с рунами; при сдвиге больше чем на 1 клетку ближние — внутри круга
    let maxD = 1;
    for (const k in opts) maxD = Math.max(maxD, ...Object.keys(opts[k].dists).map(Number));
    const RING = 106, STEP = maxD > 1 ? (RING - 50) / (maxD - 1) : 0;   // кристалл наполовину за ободом (r = 106)
    const PAD = 20, W = R * 2 + PAD * 2;                                 // поле вокруг круга, куда выступают кристаллы
    // экранное положение кристалла: направление (dx, dy) доски, k-я дальность
    const pt = (dir, k) => {
      const ang = Math.atan2(dir[1], dir[0]) + rot, r = RING - (maxD - k) * STEP;
      return [R + Math.cos(ang) * r, R - Math.sin(ang) * r];
    };
    let dots = '';
    for (const k in opts) {
      for (const d of Object.keys(opts[k].dists).map(Number)) {
        const [px, py] = pt(opts[k].dir, d), on = shift.dir === k && shift.dist === d;
        // острые концы ромба — по радиусу: наружу от центра и к центру
        const deg = Math.atan2(py - R, px - R) * 180 / Math.PI + 90;
        dots += `<g class="dot${on ? ' on' : ''}" data-dir="${k}" data-dist="${d}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${deg.toFixed(1)})">
          <polygon class="cr-f" points="0,-20 11,0 0,20 -11,0"/>
          <polygon class="cr-b" points="0,-15 7.5,0 0,15 -7.5,0"/>
          <polygon class="cr-1" points="0,-15 -7.5,0 0,0"/><polygon class="cr-2" points="0,-15 7.5,0 0,0"/>
          <polygon class="cr-3" points="-7.5,0 0,15 0,0"/><polygon class="cr-4" points="7.5,0 0,15 0,0"/>
          <polygon class="cr-h" points="-1,-11 -4.5,-2 -2,-2"/></g>`;
      }
    }
    // руны по кольцу и светящиеся трещины в камне
    const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    // трещина идёт от обода внутрь: шаги вдоль радиуса со сдвигами вбок + короткая ветка
    const crack = (a, len) => {
      const t = a * Math.PI / 180, ux = Math.cos(t), uy = -Math.sin(t), vx = -uy, vy = ux;
      const P = (r, s) => `${(R + ux * r + vx * s).toFixed(1)},${(R + uy * r + vy * s).toFixed(1)}`;
      const off = [0, 2.5, -1.5, 3, -2.5, 1], pts = [];
      for (let i = 0; i < off.length; i++) pts.push(P(84 - i * len / (off.length - 1), off[i]));
      const bi = 2, br = 84 - bi * len / (off.length - 1);
      return `<polyline points="${pts.join(' ')}" class="crk"/><polyline points="${P(br, off[bi])} ${P(br - 5, off[bi] + 6)} ${P(br - 8, off[bi] + 8)}" class="crk"/>`;
    };
    const cracks = [[22, 26], [68, 18], [118, 24], [160, 16], [205, 28], [250, 18], [292, 24], [338, 20]].map(([a, l]) => crack(a, l)).join('');
    // сфера встаёт вплотную к выбранному кристаллу (не закрывая его)
    const KGAP = 43;
    const toward = ([x, y]) => { const dx = x - R, dy = y - R, l = Math.hypot(dx, dy) || 1; return [R + dx * (l - KGAP) / l, R + dy * (l - KGAP) / l]; };
    const [kx, ky] = pick ? toward(pt(pick.dir, shift.dist)) : [R, R];
    const parts = pick ? (opts[shift.dir].dists[shift.dist] || []).filter(a => a.part != null) : [];
    const p = G.at(sel.x, sel.y), nm = p ? G.name(p) : '';
    el.innerHTML = `<div class="sp-h">${nm}: клетка ${FC.sq(shift.cell[0], shift.cell[1])}</div>
      <svg viewBox="${-PAD} ${-PAD} ${W} ${W}" width="${W}" height="${W}">
        <defs><radialGradient id="knobG" cx="40%" cy="35%"><stop offset="0" stop-color="#f5f3ff"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#5b21b6"/></radialGradient>
          <radialGradient id="plateG" cx="50%" cy="45%"><stop offset="0" stop-color="#2e2350"/><stop offset="1" stop-color="#171127"/></radialGradient>
          <path id="runeP" d="M ${R} ${R - 89} a 89 89 0 1 1 -0.01 0"/></defs>
        <circle cx="${R}" cy="${R}" r="82" fill="url(#plateG)"/>
        ${cracks}
        <circle cx="${R}" cy="${R}" r="94" class="ring"/>
        <circle cx="${R}" cy="${R}" r="94" class="seam"/>
        <circle cx="${R}" cy="${R}" r="106" class="rim"/><circle cx="${R}" cy="${R}" r="82" class="rim2"/>
        <text class="rune"><textPath href="#runeP" textLength="555" lengthAdjust="spacing">${RUNES}${RUNES.slice(0, 10)}</textPath></text>
        ${dots}
        <circle cx="${kx}" cy="${ky}" r="21" class="knob" fill="url(#knobG)"/>
      </svg>
      <div class="sp-t">Потяните сферу в желаемом направлении</div>
      ${parts.length > 1 ? `<div class="sp-part"><button data-part="1" class="${shift.part ? 'on' : ''}">ТХ'Зсал едет с линией</button><button data-part="0" class="${shift.part ? '' : 'on'}">ТХ'Зсал стоит</button></div>` : ''}
      <div class="sp-b"><button class="k-special" id="spOk"${pick ? '' : ' disabled'}>✔ Применить</button><button id="spNo">✖ Отмена</button></div>`;
    // нажатие на точку
    el.querySelectorAll('.dot').forEach(d => d.onclick = () => { shift.dir = d.dataset.dir; shift.dist = +d.dataset.dist; render(); });
    el.querySelectorAll('.sp-part button').forEach(b => b.onclick = () => { shift.part = b.dataset.part === '1'; render(); });
    $('spOk').onclick = () => { const a = shiftPick(shiftActs() || []); if (a) { shift = null; tryExec(a); } };
    $('spNo').onclick = () => { if (shift.dir) { shift.dir = null; shift.dist = 0; } else shift.cell = null; render(); };
    // перетаскивание кружка: он скользит по ближайшему пазу и защёлкивается на точке
    const svg = el.querySelector('svg'), knob = el.querySelector('.knob');
    const cand = [];
    for (const k in opts) for (const d of Object.keys(opts[k].dists).map(Number)) cand.push({ k, d, xy: pt(opts[k].dir, d) });
    let drag = false;
    const loc = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width - PAD, (e.clientY - r.top) * W / r.height - PAD]; };
    const near = ([x, y]) => {
      if (Math.hypot(x - R, y - R) < 26) return null;
      let best = null, bd = 1e9;
      for (const c of cand) { const dd = Math.hypot(c.xy[0] - x, c.xy[1] - y); if (dd < bd) { bd = dd; best = c; } }
      return best;
    };
    svg.onpointerdown = e => {
      if (e.target.closest('.dot')) return;
      drag = true; svg.setPointerCapture(e.pointerId); e.preventDefault();
    };
    svg.onpointermove = e => {
      if (!drag) return;
      const [x, y] = loc(e), c = near([x, y]);
      // сфера следует за пальцем, но только по прямой к ближайшему кристаллу
      el.querySelectorAll('.dot').forEach(d => d.classList.toggle('on', !!c && d.dataset.dir === c.k && +d.dataset.dist === c.d));
      if (!c) { knob.setAttribute('cx', R); knob.setAttribute('cy', R); return; }
      const ex = c.xy[0] - R, ey = c.xy[1] - R, len = Math.hypot(ex, ey), ux = ex / len, uy = ey / len;
      const dmax = Math.max(...cand.filter(q => q.k === c.k).map(q => Math.hypot(q.xy[0] - R, q.xy[1] - R))) - KGAP;
      const t = Math.max(0, Math.min(dmax, (x - R) * ux + (y - R) * uy));
      knob.setAttribute('cx', R + ux * t); knob.setAttribute('cy', R + uy * t);
    };
    svg.onpointerup = svg.onpointercancel = e => {
      if (!drag) return; drag = false;
      const c = near(loc(e));
      if (c) { shift.dir = c.k; shift.dist = c.d; } else { shift.dir = null; shift.dist = 0; }
      render();
    };
  }
  function tryExec(a) {
    if (a.confirm) modal(a.confirm, [{ label: 'Подтвердить', fn: () => exec(a) }, { label: 'Отмена' }]);
    else exec(a);
  }
  function exec(a) {
    if (tutorMode && !ai[G.turn]) { try { const r = FC.Tutor.reviewPlayer(G, G.turn, a); if (r) tutorSay(r, 'player'); } catch (e) { } }
    setAnim(a); record(a); G.doAction(a); sel = null; ctx = null; afterAction();
  }

  /* ---------- история ходов: только клетки, как в шахматах ---------- */
  let notesG = null, notes = [];
  function nota(a) {
    const sq = c => FC.sq(c[0], c[1]);
    const f = a.from ? sq(a.from) : '', t = FC.sq(a.x, a.y);
    const dd = a.dist > 1 ? '×' + a.dist : '';
    if (a.pull) return f + '*' + t + dd;                     // притяжение линии Ксал'Таргоном
    if (a.dir && a.line) {                                   // сдвиг линии ТХ'Зсала
      const [dx, dy] = a.dir, L = a.line;
      if (dy === 0) return '~' + (L[0][1] + 1) + (dx > 0 ? '→' : '←') + dd;
      if (dx === 0) return '~' + 'abcdefgh'[L[0][0]] + (dy > 0 ? '↑' : '↓') + dd;
      return '~' + sq(L[0]) + (dy > 0 ? (dx > 0 ? '↗' : '↖') : (dx > 0 ? '↘' : '↙')) + dd;
    }
    switch (a.kind) {
      case 'move': return f + '-' + t;
      case 'capture': case 'convert': return f + 'x' + t;
      case 'ranged': return f + '→' + t;
      case 'summon': case 'revive': return '@' + t;
      default: return f === t || !f ? (f || t) + '*' : f + '*' + t;
    }
  }
  function record(a) {
    if (notesG !== G) { notesG = G; notes = []; }
    const n = nota(a);
    if (G.queue.length && G.history.length) {                // продолжение того же хода (второй шаг)
      const i = G.history.length - 1; notes[i] = (notes[i] || '') + ' ' + n;
    } else notes[G.history.length] = n;
  }
  function renderHistory() {
    const el = $('log');
    if (notesG !== G) { notesG = G; notes = []; }
    const list = notes.slice(0, G.history.length);
    if (!list.length) { el.innerHTML = '<div class="empty">Ходов пока нет</div>'; return; }
    let h = '';
    for (let i = 0; i < list.length; i += 2)
      h += `<div class="hl1"><span class="n">${i / 2 + 1}.</span><span class="m">${list[i] || '…'}</span><span class="m">${list[i + 1] || ''}</span></div>`;
    el.innerHTML = h;
    el.scrollTop = el.scrollHeight;
  }

  let seenLogs = 0;
  // заметить превращение фигуры (пешка → Инженер и т. п.) и показать подсказку
  function noticeTransforms() {
    if (!G) return;
    if (seenLogs > G.logs.length) seenLogs = 0;
    const fresh = G.logs.slice(seenLogs); seenLogs = G.logs.length;
    const tr = fresh.filter(l => /превращается в/.test(l)).pop();
    if (tr) toast(tr.replace(/^\[\d+\]\s*/, ''), '✨');
  }
  function afterAction() {
    noticeTransforms();
    if (G.winner != null) { G.queue = []; render(); gameOver(); return; }
    const pend = G.nextPending();
    if (pend) {
      render();
      if (ai[pend.owner]) {
        busy = true;
        const game = G;
        setTimeout(() => {
          if (game !== G) return;   // за это время начали новую партию
          busy = false; G.resolvePending(FC.AI.resolve(G, pend)); afterAction();
        }, 500);
      } else if (pend.kind === 'options') {
        modal(pend.text, pend.options.map(o => ({ label: o.label, fn: () => { G.resolvePending(o); afterAction(); } })), true);
      }
      return;
    }
    if (G.winner != null) { render(); gameOver(); return; }
    G.endTurn(); sel = null; ctx = null; render();
    if (G.winner != null) { gameOver(); return; }
    maybeAI();
  }
  function maybeAI() {
    if (!G || G.winner != null || !ai[G.turn]) return;
    busy = true;
    const game = G, turnNo = G.turnNo;
    setTimeout(() => {
      busy = false;
      if (game !== G || G.turnNo !== turnNo || G.winner != null) return;
      const a = FC.AI.choose(G, G.turn);
      if (a) {
        if (tutorMode && G.turn === TUTOR_SIDE) { try { tutorSay(FC.Tutor.explainBot(G, G.turn, a).html, 'bot'); } catch (e) { console.warn('tutor', e); } }
        setAnim(a); record(a); G.doAction(a); afterAction();
      }
    }, +SET.aiPause || 450);
  }
  function undo() {
    if (!G || busy || !G.history.length) return;
    $('modal').classList.add('hidden');
    let ok = G.undo();
    // против компьютера — откатываем и его ход, чтобы вернуть ход человеку
    while (ok && ai[G.turn] && !ai[1 - G.turn] && G.history.length) ok = G.undo();
    tutorSay('↶ Ход отменён — попробуй другой вариант.', 'sys');
    sel = null; ctx = null; render();
    if (ai[G.turn] && ai[1 - G.turn]) return;
    maybeAI();
  }
  function redo() {
    if (!G || busy || !G.future.length) return;
    $('modal').classList.add('hidden');
    let ok = G.redo();
    while (ok && ai[G.turn] && !ai[1 - G.turn] && G.future.length) ok = G.redo();
    sel = null; ctx = null;
    if (G.queue.length) { afterAction(); return; } // ход был отменён посреди выбора — продолжить выбор
    render();
    if (G.winner != null) { gameOver(); return; }
    if (ai[G.turn] && ai[1 - G.turn]) return;
    maybeAI();
  }
  function gameOver() {
    const w = G.winner;
    const title = w === -1 ? 'Ничья' : `Победа: ${FC.COLOR_NAME[w]} (${G.faction(w).name})`;
    tutorSay(w === TUTOR_SIDE ? `Партия за мной: ${G.winReason}. Отмени пару ходов (↶) и попробуй найти защиту — так учиться быстрее всего.`
      : w === -1 ? `Ничья: ${G.winReason}.` : `Ты победил! ${G.winReason}. Отличная партия!`, 'sys');
    modal(`<h2>${title}</h2><p>${G.winReason}</p>`,
      [{ label: 'Новая игра', fn: toSetup }, { label: '↶ Отменить последний ход', fn: undo }, { label: 'Посмотреть доску' }], true);
  }

  /* ---------- модальное окно ---------- */
  function modal(html, buttons, noClose) {
    $('modalText').innerHTML = html;
    const box = $('modalBtns'); box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label; if (b.cls) el.className = b.cls;
      el.onclick = () => { $('modal').classList.add('hidden'); if (b.fn) b.fn(); };
      box.appendChild(el);
    }
    $('modal').classList.remove('hidden');
    $('modal').onclick = e => { if (!noClose && e.target === $('modal')) $('modal').classList.add('hidden'); };
  }

  /* ---------- отрисовка ---------- */
  function threats() {
    const key = G.turnNo + ':' + G.logs.length + ':' + G.history.length;
    if (threatCache.key !== key) threatCache = { key, val: [G.leaderThreatened(0), G.leaderThreatened(1)] };
    return threatCache.val;
  }
  function render() { renderBoard(); renderPad(); renderBanner(); renderPlayers(); renderInfo(); renderLog(); $('undoBtn').disabled = !G.history.length; $('redoBtn').disabled = !G.future.length; if (FC.UI.onRender) FC.UI.onRender(G, ai); }

  const KIND_ORDER = ['convert', 'revive', 'summon', 'ranged', 'capture', 'special', 'move', 'zone'];
  const IS3D = FC.VIEW === '3d';
  let anim = null; // анимация последнего хода: { pid, from, hit }
  // значки состояний новых фракций: объединение, заражение, контроль разума, механизм, усиление
  function statusIcons(p) {
    const r = [];
    if (p.parts && p.parts.length) r.push([`⧉${p.parts.length + 1}`, 'Объединение: ' + [p.type].concat(p.parts.map(c => c.type)).map(t => FC.PIECES[t].name).join(' + ')]);
    if (p.infBy) r.push(['🦠', 'Заражена Ползучей плотью — ею управляют Аберрации']);
    if (p.mind != null) r.push(['🌀', 'Контроль разума: Аберрации могут один раз сходить этой фигурой']);
    if (FC.PIECES[p.type].mech) r.push([p.armed ? '⚙⚔' : '⚙', p.armed ? 'Механизм (берёт фигуры и после взятия уничтожается)' : 'Механизм']);
    if (p.evolved) r.push(['⬆', 'Достигла края доски: может заражать несколько существ']);
    return r;
  }
  FC.statusIcons = p => statusIcons(p);
  function pieceHTML(p, def, extraCls, flat, sty) {
    sty = sty || '';
    const F = FC.FACTIONS[def.faction];
    let st = '';
    if (p.cooldown > 0) st += '<i title="Перезарядка">⏳</i>';
    if (p.bloodlust > 0) st += '<i title="Кровожадность">🩸</i>';
    if (p.cursedTtl > 0) st += '<i title="Проклят">☠</i>';
    if (p.stolen) st += `<i title="Похищенный ход: ${FC.PIECES[p.stolen].name}">🎭</i>`;
    st += statusIcons(p).map(([i, t]) => `<i title="${t}">${i}</i>`).join('');
    const glyph = `<span class="glyph">${def.glyph || FC.GLYPH[def.cls]}︎</span>`;
    if (IS3D && !flat)
      return `<div class="unit o${p.owner}${extraCls || ''}${def.royal ? ' royal' : ''}" style="--fc:${F.color}${sty}"><div class="ushadow"></div><div class="ubase"></div>` +
        `<div class="ustand"><div class="ucard">${glyph}<span class="abbr">${def.abbr}</span></div>${st ? `<span class="st">${st}</span>` : ''}</div></div>`;
    return `<div class="piece o${p.owner}${extraCls || ''}" style="--fc:${F.color}${sty}">${glyph}<span class="abbr">${def.abbr}</span>${st ? `<span class="st">${st}</span>` : ''}</div>`;
  }
  function setAnim(a) {
    anim = { pid: a.pid, from: a.from, hit: (a.kind === 'capture' || a.kind === 'ranged' || a.kind === 'convert') ? (a.hits || [[a.x, a.y]]) : [], kind: a.kind };
  }
  // что подсвечивать на клетке: вид действия, похищенный ход, «особое» (тусклое), число действий
  function hlFor(acts) {
    const main = acts.filter(a => !a.ghost);
    const use = main.length ? main : acts;
    const kinds = use.map(a => a.kind);
    return {
      k: kinds.includes('pending') ? 'pending' : KIND_ORDER.find(kk => kinds.includes(kk)),
      stolen: use.some(a => a.stolen), ghost: !main.length, cnt: acts.length
    };
  }
  function renderBoard() {
    const b = $('board'); if (b) b.innerHTML = '';
    const pend = G.nextPending();
    const map = {};
    // предпросмотр сдвига линии: подсвечена только эта линия, на клетках — стрелки направления сдвига
    const arrows = {};
    // предпросмотр живёт, пока та же партия, та же позиция и та же выбранная фигура
    if (linePrev && (!ctx || !ctx.acts.includes(linePrev) || !linePrevKey || linePrevKey.G !== G || linePrevKey.k !== posKey() || ai[G.turn])) clearPreview();
    if (linePrev) {
      for (const [cx, cy] of linePrev.line) {
        if (linePrev.stay && linePrev.stay[0] === cx && linePrev.stay[1] === cy) continue;
        arrows[cx + ',' + cy] = linePrev.dir;
        map[cx + ',' + cy] = [linePrev];
      }
    }
    else if (pend && pend.kind === 'cells') for (const c of pend.cells) (map[c.x + ',' + c.y] = map[c.x + ',' + c.y] || []).push({ kind: 'pending' });
    // сдвиг линий: клетки мерцают (1 — всё доступное поле, 2 — линии выбранной клетки, 3 — сама клетка)
    const pulse = {};
    const la = !linePrev && !(pend && pend.kind === 'cells') ? shiftActs() : null;
    if (la) {
      const pick = shiftPick(la);
      if (pick) {
        for (const [cx, cy] of pick.line) {
          pulse[cx + ',' + cy] = 2;
          if (!(pick.stay && pick.stay[0] === cx && pick.stay[1] === cy)) arrows[cx + ',' + cy] = pick.dir;
        }
      } else if (shift.cell) {
        for (const a of la) if (onCellOf(a, shift.cell[0], shift.cell[1])) for (const [cx, cy] of a.line) pulse[cx + ',' + cy] = 2;
      } else for (const a of la) for (const [cx, cy] of a.line) pulse[cx + ',' + cy] = 1;
      if (shift.cell) pulse[shift.cell.join(',')] = 3;
    }
    if (linePrev || (pend && pend.kind === 'cells')) { }
    else if (ctx) {
      for (const a of ctx.acts) if (!(la && a.line)) for (const [cx, cy] of cellsOf(a)) (map[cx + ',' + cy] = map[cx + ',' + cy] || []).push(a);
      for (const a of (ctx.ghost || [])) for (const [cx, cy] of cellsOf(a)) (map[cx + ',' + cy] = map[cx + ',' + cy] || []).push(Object.assign({}, a, { ghost: true }));
      // 2-е нажатие на стрелка: подсветить всю зону выстрела (и пустые клетки, куда он может стрелять)
      if (sel && sel.mode === 'special') for (const [zx, zy] of (ctx.zones || [])) { const k = zx + ',' + zy; if (!map[k]) map[k] = [{ kind: 'zone' }]; }
    }
    const obst = new Set(ctx && !pend ? ctx.obstacles.map(o => o[0] + ',' + o[1]) : []);
    const th = threats();
    let mover = null, shot = null;
    const hits = new Set();
    if (anim) {
      const f = G.find(anim.pid);
      if (f && (f.x !== anim.from[0] || f.y !== anim.from[1])) mover = { pid: anim.pid, x: f.x, y: f.y, fx: anim.from[0], fy: anim.from[1], dx: anim.from[0] - f.x, dy: f.y - anim.from[1], kind: anim.kind };
      if (f && anim.kind === 'ranged') shot = { pid: anim.pid, x: f.x, y: f.y, hits: anim.hit };   // выстрел: фигура стоит, бьёт издалека
      for (const h of anim.hit) hits.add(h[0] + ',' + h[1]);
      anim = null;
    }
    // WebGL-поле: отдаём модель клеток рендереру three.js
    if (FC.VIEW === 'gl') {
      const cells = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = G.board[y][x], key = x + ',' + y, def = p ? G.def(p) : null;
        cells.push({
          x, y, p, def, threatened: !!(p && def.royal && th[p.owner]),
          cursed: G.curses.some(c => c.x === x && c.y === y),
          hl: map[key] ? hlFor(map[key]) : null, block: obst.has(key), boom: hits.has(key), arrow: arrows[key] || null, pulse: pulse[key] || 0
        });
      }
      if (FC.GL) FC.GL.render({ cells, sel, mover, shot, turn: G.turn, game: G });
      renderMini(map, arrows, th, pulse);
      return;
    }
    for (let y = 7; y >= 0; y--) for (let x = 0; x < 8; x++) {
      const d = document.createElement('div');
      d.className = 'cell ' + ((x + y) % 2 === 0 ? 'dark' : 'light');
      d.dataset.x = x; d.dataset.y = y;
      let h = '';
      if (x === 0) h += `<span class="rk">${y + 1}</span>`;
      if (y === 0) h += `<span class="fl">${'abcdefgh'[x]}</span>`;
      if (G.curses.some(c => c.x === x && c.y === y)) { d.classList.add('cursed'); h += '<span class="curse">☠</span>'; }
      const p = G.board[y][x];
      if (p) {
        const def = G.def(p);
        let cls = def.royal && th[p.owner] ? ' threatened' : '';
        if (sel && sel.x === x && sel.y === y) cls += ' lifted';
        let sty = '';
        if (mover && mover.x === x && mover.y === y) { cls += ' arrive'; sty = `;--mx:${mover.dx};--my:${mover.dy}`; }
        h += pieceHTML(p, def, cls, false, sty);
      }
      if (hits.has(x + ',' + y)) h += '<div class="boom"></div>';
      const acts = map[x + ',' + y];
      if (acts) {
        const hl = hlFor(acts);
        h += `<div class="hl k-${hl.k}${hl.stolen ? ' stolen' : ''}${hl.ghost ? ' ghost' : ''}${p ? ' occ' : ''}"></div>`;
        if (hl.cnt > 1) h += `<span class="cnt">${hl.cnt}</span>`;
      }
      if (obst.has(x + ',' + y)) h += '<div class="hl k-block"></div>';
      if (pulse[x + ',' + y]) h += `<div class="shp l${pulse[x + ',' + y]}"></div>`;
      const ar = arrows[x + ',' + y];
      if (ar) h += `<div class="lnarrow" style="transform:rotate(${Math.round(Math.atan2(-ar[1], ar[0]) * 180 / Math.PI)}deg)">➜</div>`;
      if (sel && sel.x === x && sel.y === y) d.classList.add(sel.mode === 'special' ? 'sel-special' : 'sel');
      d.innerHTML = h;
      b.appendChild(d);
    }
  }
  /* ---------- 2D-карта (левый верхний угол 3D-экрана) ---------- */
  const HC = { move: '#22c55e', capture: '#ef4444', ranged: '#f97316', summon: '#a855f7', revive: '#14b8a6', convert: '#c084fc',
    special: '#3b82f6', pending: '#fbbf24', zone: '#fb923c' };
  let trainCache = { key: '', red: {}, green: {} };
  // сколько фигур стороны side бьют каждую клетку (каждая фигура считается один раз)
  // на каждую клетку по очереди ставится «пробная» фигура противника этой стороны, и считается, сколько фигур могут её взять
  function attackCounts(side) {
    const cnt = {}, actors = G.threatActors(side).map(o => [o.x, o.y]);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const orig = G.board[y][x];
      G.board[y][x] = { id: -7, type: 'pawn', owner: 1 - side, moved: true, cooldown: 0, bloodlust: 0, cursedTtl: 0, cursedBy: -1, stolen: null };
      let n = 0;
      try {
        for (const [ax, ay] of actors) {
          if (ax === x && ay === y) continue;
          let hit = false;
          for (const m of ['normal', 'special']) {
            for (const a of G.actionsFor(ax, ay, m, { threat: true, side }).acts)
              if ((a.kind === 'capture' || a.kind === 'ranged') && (a.hits || [[a.x, a.y]]).some(h => h[0] === x && h[1] === y)) { hit = true; break; }
            if (hit) break;
          }
          if (hit) n++;
        }
      } finally { G.board[y][x] = orig; }
      if (n) cnt[x + ',' + y] = n;
    }
    return cnt;
  }
  function renderMini(map, arrows, th, pulse) {
    pulse = pulse || {};
    const mm = $('minimap'); if (!mm || !SET.mm) return;
    const me = G.turn;
    let red = {}, green = {};
    if (SET.train && G.winner == null) {
      const key = [G.turnNo, G.turn, G.history.length, G.logs.length, SET.trThreat, SET.trDef].join(':');
      if (trainCache.key !== key || trainCache.G !== G) {
        try { trainCache = { key, G, red: SET.trThreat ? attackCounts(1 - me) : {}, green: SET.trDef ? attackCounts(me) : {} }; }
        catch (e) { console.warn('training', e); trainCache = { key, G, red: {}, green: {} }; }
      }
      red = trainCache.red; green = trainCache.green;
    }
    let h = '';
    for (let y = 7; y >= 0; y--) for (let x = 0; x < 8; x++) {
      const k = x + ',' + y, p = G.board[y][x];
      let cls = 'mc ' + ((x + y) % 2 === 0 ? 'd' : 'l');
      if (sel && sel.x === x && sel.y === y) cls += ' sel' + (sel.mode === 'special' ? ' sp' : '');
      let inner = '';
      if (pulse[k]) inner += `<span class="shp l${pulse[k]}"></span>`;
      if (red[k]) inner += `<span class="tr red"></span><span class="tn red">${red[k]}</span>`;
      if (green[k]) inner += `<span class="tr green"></span><span class="tn green">${green[k]}</span>`;
      if (p) {
        const d = G.def(p), F = FC.FACTIONS[d.faction];
        inner += `<span class="mp o${p.owner}${d.royal ? ' roy' : ''}${d.royal && th[p.owner] ? ' chk' : ''}" style="--fc:${F.color}">${d.glyph || d.abbr}</span>`;
      }
      const acts = map[k];
      if (acts) {
        const hl = hlFor(acts);
        inner += `<span class="mh ${p || hl.k === 'capture' ? 'ring' : 'dot'}${hl.ghost ? ' ghost' : ''}" style="--hc:${HC[hl.k] || '#fff'}"></span>`;
      }
      const ar = arrows[k];
      if (ar) inner += `<span class="mar" style="transform:rotate(${Math.round(Math.atan2(-ar[1], ar[0]) * 180 / Math.PI)}deg)">➜</span>`;
      h += `<div class="${cls}" data-x="${x}" data-y="${y}">${inner}</div>`;
    }
    mm.innerHTML = h;
  }
  function renderBanner() {
    const pend = G.nextPending();
    const th = threats();
    let s = `<b>Ход ${G.turnNo}</b> · ходят <span class="pc o${G.turn}">${FC.COLOR_NAME[G.turn]}</span> (${G.faction(G.turn).name})`;
    if (ai[G.turn]) s += ' · <i>думает компьютер…</i>';
    if (pend) s = `<span class="pend">⚑ ${FC.COLOR_NAME[pend.owner]}: ${pend.text}</span>`;
    if (G.winner == null && G.players[G.turn].reviveDue) s += ' <span class="pend">· Король демонов пал: Призыватель должен принести жертву (2-е нажатие на Призывателя)</span>';
    if (th[G.turn] && G.winner == null) s += ' <span class="warn">⚠ ШАХ! Уведите лидера, закройтесь или уничтожьте атакующего (в том числе особой атакой)</span>';
    if (G.winner == null) {
      const dc = G.drawCounters();
      const quiet = dc.quietMoves >= 30 ? ` <span class="${dc.quietMoves >= 45 ? 'warn' : 'pend'}">· без взятий ${dc.quietMoves}/${FC.QUIET_MOVES_LIMIT}</span>` : '';
      const rep = dc.reps >= 2 ? ` <span class="warn">· позиция повторилась ${dc.reps}/${FC.REPETITION_LIMIT}</span>` : '';
      s += quiet + rep;
    }
    if (G.winner != null) s = `<b>Партия окончена.</b> ${G.winner === -1 ? 'Ничья' : 'Победа: ' + FC.COLOR_NAME[G.winner]} — ${G.winReason}`;
    $('banner').innerHTML = s;
  }
  function renderPlayers() {
    const th = threats();
    $('players').innerHTML = [0, 1].map(i => {
      const pl = G.players[i], F = G.faction(i);
      let extra = '';
      if (F.stealsMoves) {
        const st = G.pieces(i).filter(o => o.p.stolen).map(o => `${o.p.type === 'imp' ? 'Имп' : G.def(o.p).abbr} ${FC.sq(o.x, o.y)}: ${FC.PIECES[o.p.stolen].name}`);
        extra += `<div>Похищенные ходы 🎭: <b>${st.join('; ') || '—'}</b></div>`;
        if (pl.reviveDue) extra += '<div class="warn">Король демонов пал — нужно жертвоприношение</div>';
      }
      if (F.id === 'humans') {
        const pawns = G.pieces(i).filter(o => o.p.type === 'pawn').length;
        extra += `<div>Призыв Пешек: <b>${pl.pawnSummons || 0}/16</b> за партию · на доске <b>${pawns}/8</b></div>`;
      }
      if (F.id === 'undead') {
        const cnt = {}; pl.pool.forEach(t => cnt[t] = (cnt[t] || 0) + 1);
        extra += `<div>Скелетов на доске: <b>${G.pieces(i).filter(o => o.p.type === 'skeleton').length}/12</b></div>`;
        extra += `<div>Пул воскрешения: <b>${Object.keys(cnt).map(t => `${FC.PIECES[t].name} ×${cnt[t]}`).join(', ') || 'пусто'}</b></div>`;
        extra += `<div>Возрождение Лича (1 раз): <b>${pl.lichRevived ? 'уже использовано' : pl.queenCaptured ? 'доступно' : 'нет (ферзь врага не захвачен)'}</b></div>`;
      }
      return `<div class="pcard2${G.turn === i && G.winner == null ? ' active' : ''}" style="border-color:${F.color}">
        <div class="ph"><span class="pc o${i}">${FC.COLOR_NAME[i]}</span> · ${F.name}${ai[i] ? ' · 🤖' : ''}<span class="cntp">${G.pieces(i).length} фиг.</span></div>
        ${extra}${th[i] ? '<div class="warn">⚠ Шах</div>' : ''}</div>`;
    }).join('');
  }
  function renderInfo() {
    const el = $('info');
    const hasSel = !!(sel && G.at(sel.x, sel.y));
    if ($('pieceBtn')) {                     // WebGL-страница: кнопка карточки загорается при выборе фигуры
      $('pieceBtn').classList.toggle('hidden', !hasSel);
      if (!hasSel) setPanel(false);
    }
    if (!hasSel) {
      el.innerHTML = '<h3>Фигура</h3><p class="muted">Нажмите на свою фигуру: 1-е нажатие — обычные ходы, 2-е — особые способности. ' + (matchMedia('(pointer: coarse)').matches
        ? 'Нажмите на подсвеченную клетку, чтобы сделать ход. Нажатие мимо доски — снять выбор. Палец — вращать камеру, щипок — масштаб.'
        : 'Наведите на подсвеченную клетку, чтобы увидеть действие. Правый клик — снять выбор.') + '</p>';
      return;
    }
    const p = G.at(sel.x, sel.y), d = G.def(p), F = FC.FACTIONS[d.faction];
    const st = [];
    if (d.royal) st.push('👑 Лидер');
    else { const l = G.leader(p.owner); if (l && l.p === p) st.push('👑 Последний лидер (Призыватель пал)'); }
    if (p.cooldown > 0) st.push('⏳ Перезарядка дальней атаки');
    else if (d.ranged) st.push('🎯 Дальняя атака готова');
    if (p.bloodlust > 0) st.push('🩸 Кровожадность');
    if (p.cursedTtl > 0) st.push('☠ Проклят');
    if (p.stolen) st.push(`🎭 Похищенный ход: «${FC.PIECES[p.stolen].name}»`);
    if (p.summoned) st.push('Призван / превращён');
    for (const [i, t] of statusIcons(p)) st.push(`${i} ${t}`);
    if (sel.own && p.owner !== G.turn) st.push('Фигура соперника под вашим контролем');
    const counts = {};
    for (const a of ctx.acts.concat(ctx.ghost || [])) counts[a.kind] = (counts[a.kind] || 0) + 1;
    const modeT = sel.mode === 'normal' ? 'Обычные действия (1-е нажатие)' : 'Особые способности (2-е нажатие)';
    const notes = ctx.notes.slice();
    if (sel.own && sel.mode === 'special' && !d.special && !p.stolen && !ctx.acts.length && !notes.length)
      notes.push('У этой фигуры нет отдельных способностей по 2-му нажатию — её особенности срабатывают при обычном ходе.');
    let hint = '';
    if (sel.own) hint = sel.mode === 'normal'
      ? (specialHint ? `<div class="hint2">✦ Особых действий: <b>${specialHint}</b> — они уже видны на поле мигающими маркерами, можно нажать сразу. Ещё одно нажатие на фигуру — подробный режим способностей.</div>`
        : (d.special || p.stolen ? '<div class="muted small">Нажмите на фигуру ещё раз — особые способности (сейчас недоступны, причина будет показана).</div>'
          : '<div class="muted small">Нажмите на фигуру ещё раз — снять выбор.</div>'))
      : '<div class="muted small">Нажмите на фигуру ещё раз — снять выбор.</div>';
    el.innerHTML = `<h3 style="color:${F.color}">${d.name}</h3>
      <div class="muted">${F.name} · ${FC.COLOR_NAME[p.owner]} · замена: ${FC.CLASS_NAME[d.cls]} · ${FC.sq(sel.x, sel.y)}</div>
      ${st.length ? `<div class="stl">${st.join(' · ')}</div>` : ''}
      <ul class="rules">${d.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      ${(p.parts || []).map(cp => `<div class="muted small">+ в объединении: <b>${FC.PIECES[cp.type].name}</b> — ${FC.PIECES[cp.type].rules[0]}</div>`).join('')}
      ${$('pieceBtn') ? `<div class="schemes">${neonSchemes(p.type)}</div>` : ''}
      ${sel.own ? `<div class="mode ${sel.mode}">${modeT}</div>
      <div>${Object.keys(counts).map(k => `<span class="tag k-${k}">${FC.KINDS[k]}: ${counts[k]}</span>`).join(' ') || '<span class="muted">Нет доступных действий.</span>'}</div>` : ''}
      ${notes.map(n => `<div class="note">${n}</div>`).join('')}
      ${hint}`;
  }
  function renderLog() { if ($('logDock')) { renderHistory(); return; } $('log').innerHTML =G.logs.slice(-120).reverse().map(l => `<div>${l}</div>`).join(''); }
  const LEGEND = [['move', 'Перемещение'], ['capture', 'Ближнее взятие'], ['ranged', 'Дальняя атака'], ['summon', 'Призыв'], ['revive', 'Воскрешение'],
    ['convert', 'Превращение'], ['special', 'Особый ход'], ['stolen', 'Похищенный ход'], ['block', 'Препятствие'], ['pending', 'Выбор клетки']];
  function renderLegend() {
    $('legend').innerHTML = LEGEND.map(([k, t]) => `<span class="lg"><span class="sw k-${k}"></span>${t}</span>`).join('') + '<span class="lg"><span class="sw cursedsw">☠</span>Проклятая клетка</span>';
  }
  function onHover(e) {
    const c = e.target.closest('.cell');
    if (!c) { $('tip').classList.add('hidden'); return; }
    hoverAt(+c.dataset.x, +c.dataset.y, e.clientX, e.clientY);
  }
  function hoverAt(x, y, cx, cy) {
    const tip = $('tip');
    if (!G || x == null || !SET.tips) { tip.classList.add('hidden'); return; }
    const lines = [];
    const pend = G.nextPending();
    if (pend && pend.kind === 'cells' && pend.cells.some(q => q.x === x && q.y === y)) lines.push('<b>Выбрать эту клетку</b>');
    else if (ctx) {
      for (const a of ctx.acts) if (a.x === x && a.y === y) lines.push(`<span class="tag k-${a.stolen ? 'stolen' : a.kind}">${FC.KINDS[a.kind]}</span> ${a.label}`);
      for (const a of (ctx.ghost || [])) if (a.x === x && a.y === y) lines.push(`<span class="tag k-${a.stolen ? 'stolen' : a.kind}">${FC.KINDS[a.kind]}</span> ${a.label} <span class="muted">(особое действие)</span>`);
    }
    const p = G.at(x, y);
    if (p) lines.push(`<span class="muted">${G.name(p)} (${FC.COLOR_NAME[p.owner]})${p.stolen ? ' · 🎭 ' + FC.PIECES[p.stolen].name : ''}</span>`);
    if (G.curses.some(q => q.x === x && q.y === y)) lines.push('<span class="muted">☠ Проклятая клетка</span>');
    if (!lines.length) { tip.classList.add('hidden'); return; }
    tip.innerHTML = lines.join('<br>');
    tip.style.left = (cx + 16) + 'px'; tip.style.top = (cy + 16) + 'px';
    tip.classList.remove('hidden');
  }

  /* ---------- справочник: карточки фигур ---------- */
  // инфографика в карточке выбранной фигуры: столько схем, сколько нужно (ходы, взятие, выстрелы, способность)
  const SCHEMES = [
    ['Ходы', { modes: ['normal'], move: ['move'], atk: [] }],
    ['Взятие (пожирание)', { modes: ['normal'], move: [], atk: ['capture', 'convert'] }],
    ['Выстрелы', { modes: ['normal', 'special'], move: [], atk: ['ranged'] }],
    ['Способность — 2-е нажатие', { modes: ['special'], move: ['move', 'summon', 'special'], atk: ['capture', 'convert'] }]
  ];
  const schCache = {};
  function neonSchemes(type) {
    if (schCache[type]) return schCache[type];
    let h = '';
    for (const [title, opt] of SCHEMES) {
      let r; try { r = diagram(type, opt); } catch (e) { continue; }
      if (r.empty) continue;
      h += `<div class="neon">${r.html}<div class="neon-cap">${title}</div></div>`;
    }
    return schCache[type] = h || neonDiagram(type);
  }
  function diagram(type, opt) {
    const d = FC.PIECES[type];
    const O = opt || { modes: ['normal', 'special'], move: ['move', 'summon', 'special'], atk: ['capture', 'ranged', 'convert'] };
    const g = new FC.Game('humans', 'humans');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.board[y][x] = null;
    g.players[0].faction = d.faction;
    g.players[0].queenCaptured = true;
    const start = d.cls === 'pawn' && !!d.promote;
    const px = 3, py = start ? 1 : 3;
    const mk = () => g.spawn(type, 0, px, py, { moved: !start, bloodlust: 1 });
    const move = {}, atk = {};
    mk();
    for (const m of O.modes)
      for (const a of g.actionsFor(px, py, m).acts)
        if (O.move.includes(a.kind) && !(a.x === px && a.y === py)) move[a.x + ',' + a.y] = a.kind;
    if (O.atk.length) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (x === px && y === py) continue;
      g.board[y][x] = { id: -5, type: 'pawn', owner: 1, moved: true, cooldown: 0, bloodlust: 0, cursedTtl: 0, cursedBy: -1, stolen: null };
      for (const m of O.modes)
        for (const a of g.actionsFor(px, py, m).acts) {
          if (!O.atk.includes(a.kind)) continue;
          if ((a.hits || [[a.x, a.y]]).some(h => h[0] === x && h[1] === y)) {
            const prev = atk[x + ',' + y];
            if (!prev || a.kind === 'capture') atk[x + ',' + y] = a.kind;
          }
        }
      g.board[y][x] = null;
    }
    const piece = g.at(px, py);
    let h = '<div class="dia">';
    for (let y = 7; y >= 0; y--) for (let x = 0; x < 8; x++) {
      const k = x + ',' + y;
      let inner = '';
      if (x === px && y === py) inner = pieceHTML(Object.assign({}, piece, { bloodlust: 0 }), d, ' mini', true);
      else {
        if (atk[k]) inner += `<span class="da a-${atk[k]}"></span>`;
        if (move[k]) inner += `<span class="dm m-${move[k]}"></span>`;
      }
      h += `<div class="dc ${(x + y) % 2 === 0 ? 'dark' : 'light'}">${inner}</div>`;
    }
    h += '</div>';
    // без параметров — как раньше (справочник фигур): просто разметка схемы
    return opt ? { html: h, empty: !Object.keys(move).length && !Object.keys(atk).length } : h;
  }
  function openCards() {
    const ids = Object.keys(FC.FACTIONS);
    const tabs = $('cardTabs');
    tabs.innerHTML = ids.map(id => `<button data-f="${id}" style="--fc:${FC.FACTIONS[id].color}">${FC.FACTIONS[id].name}</button>`).join('');
    const show = id => {
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.f === id);
      const F = FC.FACTIONS[id];
      const types = [...new Set([F.pawn].concat(F.back))];
      for (const t of Object.keys(FC.PIECES)) if (FC.PIECES[t].faction === id && !types.includes(t)) types.push(t);
      $('cardList').innerHTML = `<p class="fdesc2" style="border-color:${F.color}">${F.desc}</p>` + types.map(t => {
        const d = FC.PIECES[t];
        const tags = [d.royal ? '👑 лидер' : '', d.ranged ? '🎯 дальняя атака' : '', d.promote ? 'превращается' : ''].filter(Boolean).join(' · ');
        return `<div class="pcard3" style="--fc:${F.color}">
          <div class="ch"><h3>${d.name}</h3><span class="muted small">замена: ${FC.CLASS_NAME[d.cls]}${tags ? ' · ' + tags : ''}</span></div>
          <div class="cb">${diagram(t)}<ul class="rules">${d.rules.map(r => `<li>${r}</li>`).join('')}</ul></div></div>`;
      }).join('');
    };
    for (const b of tabs.children) b.onclick = () => show(b.dataset.f);
    show(G ? G.players[G.turn].faction : ids[0]);
    $('cards').classList.remove('hidden');
  }

  window.addEventListener('DOMContentLoaded', init);
  FC.UI = {
    get G() { return G; }, get ai() { return ai; }, onRender: null,
    // для WebGL-поля: клик, наведение и снятие выбора по координатам клетки
    click: (x, y) => { if (performance.now() < swallowUntil) return; onCell(x, y); },
    hover: (x, y, cx, cy) => hoverAt(x, y, cx, cy),
    deselect: () => { sel = null; ctx = null; if (G) render(); }
  };
})(window.FC);
