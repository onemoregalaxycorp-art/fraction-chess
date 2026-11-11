'use strict';
(function (FC) {
  FC.defineFaction('undead', {
    name: 'Нежить', color: '#7c3aed',
    desc: 'Проклятия, превращение врагов и воскрешение павших. На доске не больше 12 Скелетов.',
    back: ['death_knight', 'soul_eater', 'graveyard', 'lich', 'phylactery', 'graveyard', 'soul_eater', 'death_knight'], pawn: 'skeleton'
  });
  const SKELETON_LIMIT = 12;   // Скелетов (пешек Нежити) на доске одновременно
  const skeletons = (G, o) => G.pieces(o).filter(e => e.p.type === 'skeleton').length;

  FC.definePiece('skeleton', {
    name: 'Скелет', faction: 'undead', cls: 'pawn', abbr: 'Ск', promote: ['skeleton_mage', 'skeleton_warrior'],
    rules: ['Ход на 1 клетку по диагонали вперёд.', 'С начальной позиции — на 1 или 2 клетки прямо вперёд.',
      'Взятие — только на 1 клетку прямо вперёд.', 'На краю доски — выбор: Скелет-маг или Скелет-воин.', 'Призванные Скелеты не имеют начального хода прямо.'],
    normal(c) {
      for (const dx of [-1, 1]) { const [tx, ty] = c.rel(dx, 1); if (c.empty(tx, ty)) c.melee(tx, ty, 'Ход по диагонали'); }
      const [x1, y1] = c.rel(0, 1);
      if (c.cap(x1, y1)) c.melee(x1, y1, 'Взятие прямо');
      else if (!c.p.moved && !c.p.summoned && c.empty(x1, y1)) {
        c.melee(x1, y1, 'Ход прямо (с начальной позиции)');
        const [x2, y2] = c.rel(0, 2);
        if (c.empty(x2, y2)) c.melee(x2, y2, 'Двойной ход прямо');
      }
    }
  });

  FC.definePiece('skeleton_mage', {
    name: 'Скелет-маг', faction: 'undead', cls: 'pawn', abbr: 'СМ', ranged: true,
    rules: ['На 1 клетку в любую сторону, без взятия.', '2-е нажатие — дальняя атака по диагонали на 1–2 клетки (фигура посередине блокирует).', 'Перезарядка после атаки.'],
    normal(c) { c.leap(FC.ALL8, { capture: false }); },
    special(c) {
      for (const [dx, dy] of FC.DIAG) {
        for (let k = 1; k <= 2; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!c.G.inB(tx, ty)) break;
          if (!c.G.at(tx, ty)) continue;
          if (c.cap(tx, ty)) c.ranged(tx, ty, 'Магический снаряд');
          else if (k === 1) c.block(tx, ty);
          break;
        }
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет врагов в 1–2 клетках по диагонали.');
    }
  });

  FC.definePiece('skeleton_warrior', {
    name: 'Скелет-воин', faction: 'undead', cls: 'pawn', abbr: 'СВ',
    rules: ['На 1 клетку по диагонали или на 1–2 по вертикали/горизонтали (без прыжков).', 'Берёт всеми этими ходами.'],
    normal(c) { c.leap(FC.DIAG); c.slide(FC.ORTH, 2); }
  });

  FC.definePiece('graveyard', {
    name: 'Кладбище', faction: 'undead', cls: 'bishop', abbr: 'Кл',
    rules: ['Строение: перемещение на 1 клетку в любую сторону, без взятия.',
      '2-е нажатие — призыв Скелета или воскрешение фигуры из пула на одну из 3 клеток перед Кладбищем (прямо или по диагонали вперёд).',
      'Пул: конь → Пожиратель душ, ладья → Рыцарь смерти, слон → Кладбище. Пешки в пул не попадают.',
      'Лимит: на доске не больше 12 Скелетов (считая стартовых). При 12 призыв Скелетов недоступен.'],
    normal(c) { c.leap(FC.ALL8, { capture: false }); },
    special(c) {
      const o = c.p.owner;
      const sk = skeletons(c.G, o);
      if (sk >= SKELETON_LIMIT) c.warn(`Нельзя призвать больше ${SKELETON_LIMIT} Скелетов: на доске уже ${sk}. Воскрешение из пула по-прежнему доступно.`);
      const cells = [[0, 1], [-1, 1], [1, 1]].map(([dx, dy]) => c.rel(dx, dy)).filter(([x, y]) => c.empty(x, y));
      if (!cells.length) { c.note('Все три клетки перед Кладбищем заняты — призыв и воскрешение невозможны.'); return; }
      if (sk < SKELETON_LIMIT) for (const [x, y] of cells)
        c.add('summon', x, y, `Призвать Скелета (на доске ${sk}/${SKELETON_LIMIT})`, g => { g.spawn('skeleton', o, x, y, { summoned: true, moved: true }); g.log(`Кладбище призывает Скелета на ${FC.sq(x, y)}`); });
      const pool = [...new Set(c.G.players[o].pool)];
      if (!pool.length) c.note('Пул воскрешения пуст.');
      for (const t of pool)
        for (const [x, y] of cells)
          c.add('revive', x, y, `Воскресить: ${FC.PIECES[t].name}`, g => {
            const pl = g.players[o].pool, i = pl.indexOf(t);
            if (i >= 0) pl.splice(i, 1);
            g.spawn(t, o, x, y, { moved: true });
            g.log(`Кладбище воскрешает «${FC.PIECES[t].name}» на ${FC.sq(x, y)}`);
          });
    }
  });

  FC.definePiece('soul_eater', {
    name: 'Пожиратель душ', faction: 'undead', cls: 'knight', abbr: 'ПД', poolOnCapture: true,
    rules: ['Прыжок на 2 или 3 клетки по вертикали/горизонтали или на 1 по диагонали; перепрыгивает фигуры; берёт на конечной клетке.',
      'Проклинает начальную, пройденные и конечную клетки до конца следующего хода Нежити.',
      'Вражеские фигуры, входящие/выходящие с проклятых клеток, становятся проклятыми.',
      'Его жертвы и фигуры, взятые Нежитью на проклятых клетках, попадают в пул воскрешения.'],
    normal(c) {
      const G = c.G, p = c.p, fx = c.x, fy = c.y, o = p.owner;
      const offs = [];
      for (const [dx, dy] of FC.ORTH) for (const k of [2, 3]) offs.push([dx, dy, k]);
      for (const [dx, dy] of FC.DIAG) offs.push([dx, dy, 1]);
      for (const [dx, dy, k] of offs) {
        const tx = fx + dx * k, ty = fy + dy * k;
        if (!G.inB(tx, ty)) continue;
        const q = G.at(tx, ty);
        if (q && !c.cap(tx, ty)) continue;
        const path = [];
        for (let i = 0; i <= k; i++) path.push([fx + dx * i, fy + dy * i]);
        c.add(q ? 'capture' : 'move', tx, ty, (q ? 'Взятие' : 'Перемещение') + ' + проклятие пути', g => {
          g.melee(p, fx, fy, tx, ty); g.addCurse(path, o);
        }, { path });
      }
    }
  });

  FC.definePiece('death_knight', {
    name: 'Рыцарь смерти', faction: 'undead', cls: 'rook', abbr: 'РС', poolOnCapture: true,
    rules: ['Ходит как ладья.', 'Каждая взятая им фигура попадает в пул воскрешения.'],
    normal(c) { c.slide(FC.ORTH); }
  });

  FC.definePiece('lich', {
    name: 'Лич', faction: 'undead', cls: 'queen', abbr: 'Лч',
    rules: ['Ходит как ферзь.', 'Обычным взятием берёт только вражеского ферзя; может ставить шах и мат лидеру.', 'Остальные фигуры не берёт, а только превращает.', '2-е нажатие — превращение: Лич встаёт на клетку перед вражеской фигурой, а та становится Нежитью (пешка → Скелет, конь → Пожиратель душ, ладья → Рыцарь смерти, слон → Кладбище).',
      'Нельзя превратить лидера и ферзя.', 'Пешку нельзя превратить в Скелета, если на доске уже 12 Скелетов.'],
    normal(c) {
      // Обычное взятие — только ферзя и лидера (шах/мат); остальные фигуры Лич лишь превращает
      const G = c.G;
      for (const [dx, dy] of FC.ALL8) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!G.inB(tx, ty)) break;
          const q = G.at(tx, ty);
          if (!q) { c.melee(tx, ty); continue; }
          if (c.cap(tx, ty)) {
            const qd = G.def(q);
            if (qd.royal || qd.cls === 'queen') c.melee(tx, ty, qd.royal ? 'Взятие лидера' : 'Взятие ферзя');
            else c.note('Обычные фигуры Лич не берёт — только превращает (2-е нажатие).');
          }
          break;
        }
      }
    },
    special(c) {
      const G = c.G, p = c.p, fx = c.x, fy = c.y;
      for (const [dx, dy] of FC.ALL8) {
        for (let k = 1; k < 8; k++) {
          const tx = fx + dx * k, ty = fy + dy * k;
          if (!G.inB(tx, ty)) break;
          const q = G.at(tx, ty);
          if (!q) continue;
          if (q.owner !== p.owner) {
            const qd = G.def(q);
            if (qd.royal) c.note('Лидера противника превращать нельзя.');
            else if (qd.cls === 'queen') c.note('Превращение ферзя — отдельная механика (не утверждена в GDD).');
            else if (FC.UNDEAD_MAP[qd.cls] === 'skeleton' && skeletons(G, p.owner) >= SKELETON_LIMIT)
              c.warn(`Нельзя получить больше ${SKELETON_LIMIT} Скелетов: пешки сейчас не превращаются (остальные фигуры — можно).`);
            else {
              const nt = FC.UNDEAD_MAP[qd.cls], bx = fx + dx * (k - 1), by = fy + dy * (k - 1);
              c.add('convert', tx, ty, `Превратить в «${FC.PIECES[nt].name}»`, g => {
                g.move(fx, fy, bx, by);
                const t = g.at(tx, ty);
                t.owner = p.owner; g.transform(t, nt);
                g.irreversible = true;   // превращение — как взятие для правила 50 ходов
                t.moved = true; t.summoned = true; t.cursedTtl = 0; t.cursedBy = -1; t.stolen = null;
              });
            }
          }
          break;
        }
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет вражеских фигур в линиях ферзя.');
    }
  });

  FC.definePiece('phylactery', {
    name: 'Филактерий Лича', faction: 'undead', cls: 'king', abbr: 'Фл', royal: true,
    rules: ['Ходит как король.', 'Лидер: нельзя ходить под шах; мат — поражение.',
      '2-е нажатие — призыв нового Лича на соседнюю клетку, если Лича нет на доске и вражеский ферзь уже был захвачен.',
      'Возродить Лича можно только один раз за партию.'],
    normal(c) { c.leap(FC.ALL8); },
    special(c) {
      const G = c.G, o = c.p.owner;
      if (G.pieces(o).some(e => e.p.type === 'lich')) { c.note('Лич ещё на доске — возрождение не требуется.'); return; }
      if (G.players[o].lichRevived) { c.note('Лича уже возрождали в этой партии — возрождение доступно только один раз.'); return; }
      if (!G.players[o].queenCaptured) { c.note('Возрождение Лича станет доступно после захвата вражеского ферзя.'); return; }
      for (const [dx, dy] of FC.ALL8) {
        const x = c.x + dx, y = c.y + dy;
        if (c.empty(x, y)) c.add('summon', x, y, 'Призвать нового Лича (единственный раз за партию)', g => {
          g.spawn('lich', o, x, y, { moved: true }); g.players[o].lichRevived = true;
          g.log(`Филактерий возрождает Лича на ${FC.sq(x, y)} (больше возрождений не будет)`);
        });
      }
      if (!c.acts.length) c.note('Все соседние клетки заняты.');
    }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
