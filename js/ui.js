'use strict';
/* FRACTION CHESS — интерфейс */
(function (FC) {
  const $ = id => document.getElementById(id);
  let G = null, sel = null, ctx = null, ai = [false, false], busy = false, specialHint = 0;
  let threatCache = { key: '', val: [false, false] };

  const ASSUMPTIONS = [
    'Шах: лидер (Король, Шаман, Филактерий) не может ходить под удар, и нельзя оставлять его под ударом. Мат — поражение, пат — ничья.',
    'Ничья: если одна и та же позиция повторилась 3 раза, или прошло 50 ходов каждой стороны без единого взятия (превращение Личем тоже считается взятием). Счётчики появляются вверху, когда ничья близко.',
    'У Демонов нет шаха и мата: Призыватель и Король демонов могут стоять и ходить под удар. Демоны проигрывают, только когда мертвы и Призыватель, и Король демонов (или Король пал, а Призывателю некого принести в жертву). Если Призыватель погиб, а Король жив — игра продолжается.',
    'Импы появляются у ближайшего Обелиска, когда любая фигура Демонов, кроме Импа, берёт вражескую фигуру.',
    'Нежить: на доске не больше 12 Скелетов — при попытке призвать больше вверху появится предупреждение.',
    'После гибели Короля демонов следующий ход Демонов уходит на жертвоприношение (2-е нажатие на Призывателя). Нет жертвы — поражение.',
    'У каждой фигуры Демонов свой похищенный ход (🎭 на фигуре).',
    'Орк-воин, Вождь, Хоп-гоблин и Шаман едят две фигуры подряд, если те стоят вплотную друг к другу; у Гоблина, Плута и Всадника этого нет. Дальность Орка-воина — 4 клетки.',
    'Перезарядка дальней атаки: после выстрела следующий свой ход без дальней атаки.',
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
    $('startBtn').onclick = startGame;
    $('newGame').onclick = () => { closeMenu(); modal('Начать новую игру?', [{ label: 'Да', fn: toSetup }, { label: 'Отмена' }]); };
    $('rulesBtn').onclick = () => { closeMenu(); modal('<b>Правила прототипа</b><ul>' + ASSUMPTIONS.map(a => `<li>${a}</li>`).join('') + '</ul>', [{ label: 'Понятно' }]); };
    $('undoBtn').onclick = undo;
    $('redoBtn').onclick = redo;
    for (const b of document.querySelectorAll('.cardsBtn')) b.onclick = () => { closeMenu(); openCards(); };
    $('cardsClose').onclick = () => $('cards').classList.add('hidden');
    initHud();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('cards').classList.add('hidden'); closeMenu(); setPanel(false); if ($('animPanel')) $('animPanel').classList.add('hidden'); }
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
  function setDock(on) {
    if (!$('logDock')) return;
    $('logDock').classList.toggle('hidden', !on);
    $('logEye').classList.toggle('on', on);
    store.set('fc.logDock', on ? '1' : '0');
  }
  function initHud() {
    if (!$('menuBtn')) return;
    $('menuBtn').onclick = e => {
      e.stopPropagation();
      const open = $('menu').classList.contains('hidden');
      $('menu').classList.toggle('hidden', !open); $('menuBtn').classList.toggle('open', open);
      if (open) setPanel(false);
    };
    $('menu').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('pointerdown', e => {          // нажатие мимо меню — закрыть его
      if (!$('menu').classList.contains('hidden') && !e.target.closest('#menu, #menuBtn')) {
        closeMenu();
        swallowUntil = performance.now() + 600;          // это нажатие только закрывает меню, по доске не срабатывает
      }
    });
    $('logBtn').onclick = () => {
      closeMenu();
      modal('<b>Журнал ходов</b><div class="fullLog">' + (G ? G.logs.slice().reverse().map(l => `<div>${l}</div>`).join('') : '') + '</div>', [{ label: 'Закрыть' }]);
    };
    $('logEye').onclick = () => setDock($('logDock').classList.contains('hidden'));
    setDock(store.get('fc.logDock') === '1');
    $('pieceBtn').onclick = () => { closeMenu(); setPanel($('piecePanel').classList.contains('hidden')); };
    $('pieceClose').onclick = () => setPanel(false);
    $('players').onclick = () => $('players').classList.toggle('expanded');
    // вкладка «Анимации»: плитки, выбор хранится в localStorage (fc.anim.<ключ>), его читает js/gl/board3d.js
    const DEF = { priest: 'prayer', obelisk: 'sink' };
    $('animBtn').onclick = () => { closeMenu(); setPanel(false); $('animPanel').classList.remove('hidden'); };
    $('animClose').onclick = () => $('animPanel').classList.add('hidden');
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
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = '⚠ ' + msg; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
  }
  const diaCache = {};
  const neonDiagram = type => diaCache[type] || (diaCache[type] = `<div class="neon">${diagram(type)}<div class="neon-cap">схема ходов</div></div>`);

  function descFaction(i) {
    const F = FC.FACTIONS[$('f' + i).value];
    const types = [...new Set(F.back.concat(F.pawn))].map(t => FC.PIECES[t].name);
    $('fd' + i).innerHTML = `<p>${F.desc}</p><p class="small">${types.join(' · ')}</p>`;
    $('fd' + i).style.borderColor = F.color;
  }
  function toSetup() { G = null; busy = false; sel = null; ctx = null; closeMenu(); setPanel(false); if ($('pieceBtn')) $('pieceBtn').classList.add('hidden'); $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); }

  function startGame() {
    G = new FC.Game($('f0').value, $('f1').value);
    ai = [$('ai0').checked, $('ai1').checked];
    sel = null; ctx = null; busy = false;
    const first = Math.random() < 0.5 ? 0 : 1;
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
      render(); maybeAI();
    };
  }

  /* ---------- ввод ---------- */
  function select(x, y, mode) {
    const p = G.at(x, y);
    sel = { x, y, mode, own: p.owner === G.turn };
    specialHint = 0;
    if (sel.own) {
      ctx = G.legalActionsFor(x, y, mode);
      ctx.ghost = [];
      const warns = (ctx.warns || []).slice();
      if (mode === 'normal') {
        // особые действия видны и кликабельны уже при 1-м нажатии (тусклыми маркерами)
        const sp = G.legalActionsFor(x, y, 'special');
        ctx.ghost = sp.acts;
        specialHint = ctx.ghost.length;
        for (const w of (sp.warns || [])) if (!warns.includes(w)) warns.push(w);
      }
      if (warns.length) toast(warns[0]);
    } else {
      ctx = { acts: [], obstacles: [], notes: ['Сейчас ход соперника — ходы этой фигуры не показываются.'] };
    }
  }
  function onCell(x, y) {
    if (!G || G.winner != null || busy) return;
    const pend = G.nextPending();
    if (pend) {
      if (ai[pend.owner]) return;
      if (pend.kind === 'cells') { const c = pend.cells.find(c => c.x === x && c.y === y); if (c) { G.resolvePending(c); afterAction(); } }
      return;
    }
    if (sel && ctx && sel.own && !ai[G.turn]) {
      const acts = ctx.acts.filter(a => a.x === x && a.y === y);
      let ghost = (ctx.ghost || []).filter(a => a.x === x && a.y === y);
      // 1-е нажатие: если фигура вообще может пойти на эту клетку (например, Король), клик — это ход,
      // а не призыв; призыв туда — только 2-м нажатием на фигуру
      if (ghost.length && sel.mode === 'normal' && G.actionsFor(sel.x, sel.y, 'normal').acts.some(a => a.x === x && a.y === y)) {
        ghost = ghost.filter(a => a.kind !== 'summon' && a.kind !== 'revive');
        if (!acts.length && !ghost.length) { toast('Туда ходить нельзя: поле под ударом. Чтобы призвать фигуру — нажмите на неё ещё раз.'); return; }
      }
      if (acts.length || ghost.length) { chooseAction(acts.concat(ghost)); return; }
    }
    const p = G.at(x, y);
    if (p && p.owner === G.turn && !ai[G.turn]) {
      const same = sel && sel.x === x && sel.y === y;
      select(x, y, same && sel.mode === 'normal' ? 'special' : 'normal');
    } else if (p) {
      return; // фигура стороны, чья очередь ещё не наступила, — ничего не выделяем
    } else { sel = null; ctx = null; }
    render();
  }
  function chooseAction(acts) {
    if (acts.length === 1) return tryExec(acts[0]);
    modal('Выберите действие:', acts.map(a => ({ label: a.label, cls: 'k-' + a.kind, fn: () => tryExec(a) })).concat([{ label: 'Отмена' }]));
  }
  function tryExec(a) {
    if (a.confirm) modal(a.confirm, [{ label: 'Подтвердить', fn: () => exec(a) }, { label: 'Отмена' }]);
    else exec(a);
  }
  function exec(a) { setAnim(a); G.doAction(a); sel = null; ctx = null; afterAction(); }

  function afterAction() {
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
      if (a) { setAnim(a); G.doAction(a); afterAction(); }
    }, 450);
  }
  function undo() {
    if (!G || busy || !G.history.length) return;
    $('modal').classList.add('hidden');
    let ok = G.undo();
    // против компьютера — откатываем и его ход, чтобы вернуть ход человеку
    while (ok && ai[G.turn] && !ai[1 - G.turn] && G.history.length) ok = G.undo();
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
  function render() { renderBoard(); renderBanner(); renderPlayers(); renderInfo(); renderLog(); $('undoBtn').disabled = !G.history.length; $('redoBtn').disabled = !G.future.length; if (FC.UI.onRender) FC.UI.onRender(G, ai); }

  const KIND_ORDER = ['convert', 'revive', 'summon', 'ranged', 'capture', 'special', 'move'];
  const IS3D = FC.VIEW === '3d';
  let anim = null; // анимация последнего хода: { pid, from, hit }
  function pieceHTML(p, def, extraCls, flat, sty) {
    sty = sty || '';
    const F = FC.FACTIONS[def.faction];
    let st = '';
    if (p.cooldown > 0) st += '<i title="Перезарядка">⏳</i>';
    if (p.bloodlust > 0) st += '<i title="Кровожадность">🩸</i>';
    if (p.cursedTtl > 0) st += '<i title="Проклят">☠</i>';
    if (p.stolen) st += `<i title="Похищенный ход: ${FC.PIECES[p.stolen].name}">🎭</i>`;
    const glyph = `<span class="glyph">${FC.GLYPH[def.cls]}︎</span>`;
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
    if (pend && pend.kind === 'cells') for (const c of pend.cells) (map[c.x + ',' + c.y] = map[c.x + ',' + c.y] || []).push({ kind: 'pending' });
    else if (ctx) {
      for (const a of ctx.acts) (map[a.x + ',' + a.y] = map[a.x + ',' + a.y] || []).push(a);
      for (const a of (ctx.ghost || [])) (map[a.x + ',' + a.y] = map[a.x + ',' + a.y] || []).push(Object.assign({}, a, { ghost: true }));
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
          hl: map[key] ? hlFor(map[key]) : null, block: obst.has(key), boom: hits.has(key)
        });
      }
      if (FC.GL) FC.GL.render({ cells, sel, mover, shot, turn: G.turn, game: G });
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
      if (sel && sel.x === x && sel.y === y) d.classList.add(sel.mode === 'special' ? 'sel-special' : 'sel');
      d.innerHTML = h;
      b.appendChild(d);
    }
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
    const counts = {};
    for (const a of ctx.acts.concat(ctx.ghost || [])) counts[a.kind] = (counts[a.kind] || 0) + 1;
    const modeT = sel.mode === 'normal' ? 'Обычные действия (1-е нажатие)' : 'Особые способности (2-е нажатие)';
    const notes = ctx.notes.slice();
    if (sel.own && sel.mode === 'special' && !d.special && !p.stolen && !ctx.acts.length && !notes.length)
      notes.push('У этой фигуры нет отдельных способностей по 2-му нажатию — её особенности срабатывают при обычном ходе.');
    let hint = '';
    if (sel.own) hint = sel.mode === 'normal'
      ? (specialHint ? `<div class="hint2">✦ Особых действий: <b>${specialHint}</b> — они уже видны на поле мигающими маркерами, можно нажать сразу. Ещё одно нажатие на фигуру — подробный режим способностей.</div>`
        : (d.special || p.stolen ? '<div class="muted small">Нажмите на фигуру ещё раз — особые способности (сейчас недоступны, причина будет показана).</div>' : ''))
      : '<div class="muted small">Нажмите ещё раз — вернуться к обычным ходам.</div>';
    el.innerHTML = `<h3 style="color:${F.color}">${d.name}</h3>
      <div class="muted">${F.name} · ${FC.COLOR_NAME[p.owner]} · замена: ${FC.CLASS_NAME[d.cls]} · ${FC.sq(sel.x, sel.y)}</div>
      ${st.length ? `<div class="stl">${st.join(' · ')}</div>` : ''}
      <ul class="rules">${d.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      ${$('pieceBtn') ? neonDiagram(p.type) : ''}
      ${sel.own ? `<div class="mode ${sel.mode}">${modeT}</div>
      <div>${Object.keys(counts).map(k => `<span class="tag k-${k}">${FC.KINDS[k]}: ${counts[k]}</span>`).join(' ') || '<span class="muted">Нет доступных действий.</span>'}</div>` : ''}
      ${notes.map(n => `<div class="note">${n}</div>`).join('')}
      ${hint}`;
  }
  function renderLog() { $('log').innerHTML = G.logs.slice(-120).reverse().map(l => `<div>${l}</div>`).join(''); }
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
    if (!G || x == null) { tip.classList.add('hidden'); return; }
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
  function diagram(type) {
    const d = FC.PIECES[type];
    const g = new FC.Game('humans', 'humans');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.board[y][x] = null;
    g.players[0].faction = d.faction;
    g.players[0].queenCaptured = true;
    const start = d.cls === 'pawn' && !!d.promote;
    const px = 3, py = start ? 1 : 3;
    const mk = () => g.spawn(type, 0, px, py, { moved: !start, bloodlust: 1 });
    const move = {}, atk = {};
    mk();
    for (const m of ['normal', 'special'])
      for (const a of g.actionsFor(px, py, m).acts)
        if (a.kind === 'move' || a.kind === 'summon' || a.kind === 'special') move[a.x + ',' + a.y] = a.kind;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (x === px && y === py) continue;
      g.board[y][x] = { id: -5, type: 'pawn', owner: 1, moved: true, cooldown: 0, bloodlust: 0, cursedTtl: 0, cursedBy: -1, stolen: null };
      for (const m of ['normal', 'special'])
        for (const a of g.actionsFor(px, py, m).acts) {
          if (!['capture', 'ranged', 'convert'].includes(a.kind)) continue;
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
    return h + '</div>';
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
