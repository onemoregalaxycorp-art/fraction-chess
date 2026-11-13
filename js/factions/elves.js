'use strict';
/* ЭЛЬФЫ — дальнобойные атаки, контроль пространства, мобильность.
   «Общая перезарядка» — обычная перезарядка дальней атаки: после выстрела следующий свой ход фигура не стреляет. */
(function (FC) {
  FC.defineFaction('elves', {
    name: 'Эльфы', color: '#10b981',
    desc: 'Дальний бой и мобильность: лучники стреляют «буквой Т», Сокольничий бьёт сквозь всё, Архимаг телепортируется, Трент меняется местами с союзниками. Лидер — Эльфийская королева.',
    back: ['trent', 'falconer', 'windwing', 'archmage', 'elf_queen', 'windwing', 'falconer', 'trent'], pawn: 'archer'
  });
  const CD = 'После выстрела — перезарядка: следующий свой ход фигура не стреляет (ходить может).';
  const sgn = Math.sign;

  FC.definePiece('archer', {
    name: 'Эльфийский лучник', faction: 'elves', cls: 'pawn', abbr: 'Лч', promote: 'elite_archer', ranged: true,
    rules: ['Ходит только на 1 клетку вперёд (не назад и не вбок). Обычного взятия нет.',
      '2-е нажатие — выстрел «буквой Т»: 2 клетки вперёд и 1 влево или вправо. Мешает только фигура прямо перед лучником (на 1 клетку); остальные клетки выстрел не блокируют.',
      CD, 'На противоположном краю становится Элитным лучником.'],
    normal(c) { const [x1, y1] = c.rel(0, 1); if (c.empty(x1, y1)) c.melee(x1, y1); },
    special(c) {
      const [bx, by] = c.rel(0, 1);
      if (c.G.at(bx, by)) { c.block(bx, by, 'Фигура прямо перед лучником закрывает выстрел.'); return; }
      for (const dx of [-1, 1]) { const [tx, ty] = c.rel(dx, 2); c.shoot(tx, ty, 'Выстрел «буквой Т»'); }
      if (!c.acts.length && !c.notes.length) c.note('Нет целей для выстрела «буквой Т».');
    }
  });

  FC.definePiece('elite_archer', {
    name: 'Элитный лучник', faction: 'elves', cls: 'bishop', abbr: 'ЭЛ', ranged: true,
    rules: ['Ходит на 1 клетку в любую сторону (на свободную). Обычного взятия нет.',
      '2-е нажатие — выстрел: «буквой Т» 2+1 во всех направлениях или ровно на 2 клетки по вертикали, горизонтали и диагонали.',
      'Мешает только фигура на соседней клетке в направлении выстрела; дальше промежуточные фигуры не блокируют.', CD],
    normal(c) { c.leap(FC.ALL8, { capture: false }); },
    special(c) {
      const shots = [];
      for (const [dx, dy] of FC.KNIGHT) shots.push([dx, dy, Math.abs(dy) === 2 ? 0 : sgn(dx), Math.abs(dy) === 2 ? sgn(dy) : 0, '«Буквой Т»']);
      for (const [dx, dy] of FC.ORTH) shots.push([2 * dx, 2 * dy, dx, dy, 'На 2 клетки']);
      for (const [dx, dy] of FC.DIAG) shots.push([2 * dx, 2 * dy, dx, dy, 'На 2 клетки по диагонали']);
      const blocked = new Set();
      for (const [dx, dy, ux, uy, lab] of shots) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.G.inB(tx, ty)) continue;
        const shut = !!c.G.at(c.x + ux, c.y + uy);
        if (!shut) c.zone(tx, ty);
        if (!c.cap(tx, ty)) continue;
        if (shut) { const k = ux + ',' + uy; if (!blocked.has(k)) { blocked.add(k); c.block(c.x + ux, c.y + uy); } continue; }
        c.ranged(tx, ty, 'Выстрел: ' + lab);
      }
      if (blocked.size) c.note('Соседние фигуры закрывают выстрелы в своём направлении.');
      if (!c.acts.length && !c.notes.length) c.note('Нет целей для выстрела.');
    }
  });

  // Сокольничий: 2+1 во все стороны и «усиленный» 3+1 вперёд
  const falconOffs = c => FC.KNIGHT.concat([[1, 3 * c.fwd], [-1, 3 * c.fwd]]);
  FC.definePiece('falconer', {
    name: 'Сокольничий', faction: 'elves', cls: 'knight', abbr: 'Ск', ranged: true,
    rules: ['Ходит конём 2+1 и «усиленным» ходом 3+1 вперёд, перепрыгивая фигуры. Встаёт только на свободную клетку; взятия перемещением нет.',
      '2-е нажатие — выстрел по тем же схемам (2+1 и 3+1 вперёд); стрельба не перемещает фигуру и полностью игнорирует препятствия.', CD],
    normal(c) {
      for (const [dx, dy] of falconOffs(c)) { const tx = c.x + dx, ty = c.y + dy; if (c.empty(tx, ty)) c.melee(tx, ty, Math.abs(dy) === 3 ? 'Усиленный ход 3+1' : 'Перемещение'); }
    },
    special(c) {
      for (const [dx, dy] of falconOffs(c)) c.shoot(c.x + dx, c.y + dy, Math.abs(dy) === 3 ? 'Выстрел 3+1' : 'Выстрел 2+1');
      if (!c.acts.length && !c.notes.length) c.note('Нет целей по схемам 2+1 и 3+1 вперёд.');
    }
  });

  FC.definePiece('trent', {
    name: 'Трент', faction: 'elves', cls: 'rook', abbr: 'Тр',
    rules: ['Ходит как ладья, не перепрыгивает фигуры, берёт обычным образом.',
      '«Переплетение корней» (2-е нажатие): рокировка с любой союзной фигурой на той же вертикали или горизонтали, если между ними нет фигур — в любой момент партии.',
      'Соседние фигуры меняются местами. Если между ними есть свободные клетки — союзная фигура сдвигается на 2 клетки к Тренту, а Трент встаёт с другой стороны от неё.',
      'Рокировка не может оставить своего лидера под шахом.'],
    normal(c) { c.slide(FC.ORTH); },
    special(c) {
      const G = c.G, fx = c.x, fy = c.y, p = c.p;
      for (const [dx, dy] of FC.ORTH) {
        for (let k = 1; k < 8; k++) {
          const ax = fx + dx * k, ay = fy + dy * k;
          if (!G.inB(ax, ay)) break;
          const q = G.at(ax, ay);
          if (!q) continue;
          if (q.owner === c.side && q.owner === p.owner) {
            c.add('special', ax, ay, `Переплетение корней с «${G.name(q)}»`, g => {
              const t = g.board[fy][fx], a = g.board[ay][ax];
              if (k === 1) { g.board[fy][fx] = a; g.board[ay][ax] = t; }
              else {
                const nax = ax - 2 * dx, nay = ay - 2 * dy, ntx = nax + dx, nty = nay + dy;
                g.board[fy][fx] = null; g.board[ay][ax] = null;
                g.board[nay][nax] = a; g.board[nty][ntx] = t;
              }
              t.moved = true; a.moved = true;
              g.log(`Трент и «${g.name(a)}» меняются местами («Переплетение корней»)`);
            });
          }
          break;
        }
      }
      if (!c.acts.length) c.note('На вертикали и горизонтали Трента нет союзной фигуры без препятствий между ними.');
    }
  });

  FC.definePiece('windwing', {
    name: 'Ветрокрылый', faction: 'elves', cls: 'bishop', abbr: 'Вк', ranged: true,
    rules: ['Ходит по диагонали на любое расстояние; перепрыгивает союзные фигуры, но не вражеские. Встаёт только на свободную клетку — взятия перемещением нет.',
      '2-е нажатие — выстрел по диагонали на любое расстояние; любые фигуры на пути закрывают выстрел. По соседним диагональным клеткам стрелять нельзя.', CD],
    normal(c) {
      for (const [dx, dy] of FC.DIAG) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!c.G.inB(tx, ty)) break;
          const q = c.G.at(tx, ty);
          if (!q) { c.melee(tx, ty); continue; }
          if (q.owner === c.side) continue;          // союзника перепрыгивает
          c.block(tx, ty); break;                    // врага — нет
        }
      }
    },
    special(c) {
      for (const [dx, dy] of FC.DIAG) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!c.G.inB(tx, ty)) break;
          if (!c.G.at(tx, ty)) { if (k >= 2) c.zone(tx, ty); continue; }
          if (k >= 2) c.shoot(tx, ty, 'Выстрел по диагонали');
          else if (c.cap(tx, ty)) c.note('По соседней диагональной клетке Ветрокрылый не стреляет.');
          break;
        }
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет целей на диагоналях.');
    }
  });

  FC.definePiece('archmage', {
    name: 'Архимаг', faction: 'elves', cls: 'queen', abbr: 'Ам', ranged: true,
    rules: ['Телепортируется на любую свободную клетку доски — путь не нужен.',
      'На дальний ряд (родной ряд соперника) телепортироваться нельзя, пока вражеский ферзь хотя бы раз не покинет свой дальний ряд.',
      '2-е нажатие — атака любой фигуры по вертикали, горизонтали или диагонали на любом расстоянии (препятствия закрывают атаку); Архимаг при этом не перемещается.', CD,
      'Защита от шаха: если Эльфийской королеве шах, Архимаг может выстрелить даже на перезарядке — чтобы снять шах.'],
    normal(c) {
      const opp = 1 - c.p.owner, far = c.p.owner === 0 ? 7 : 0, open = !!c.G.players[opp].queenLeft;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (!c.empty(x, y)) continue;
        if (y === far && !open) continue;
        c.melee(x, y, 'Телепортация');
      }
      if (!open) c.note('Дальний ряд закрыт для телепортации, пока вражеский ферзь не покинет свой дальний ряд.');
    },
    special(c) {
      const G = c.G, p = c.p;
      // на перезарядке стрелять можно только для защиты своей Королевы от шаха
      const emergency = p.cooldown > 0 && !c.threat && G.leaderThreatened(c.side);
      if (p.cooldown > 0 && !emergency) { c.note('⏳ Перезарядка: стрелять нельзя (кроме защиты Королевы от шаха).'); return; }
      for (const [dx, dy] of FC.ALL8) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!G.inB(tx, ty)) break;
          c.zone(tx, ty);                              // зона выстрела (на перезарядке не показывается)
          if (!G.at(tx, ty)) continue;
          if (!c.cap(tx, ty)) break;
          const lab = emergency ? 'Магическая атака — защита Королевы от шаха' : 'Магическая атака';
          c.add('ranged', tx, ty, lab, g => { g.capture(tx, ty, p, { ranged: true }); p.cooldown = 2; });
          break;
        }
      }
      if (emergency) c.note('Королеве шах: Архимаг может выстрелить даже на перезарядке, если выстрел снимает шах.');
      if (!c.acts.length && !c.notes.length) c.note('Нет целей по вертикали, горизонтали и диагоналям.');
    }
  });

  FC.definePiece('elf_queen', {
    name: 'Эльфийская королева', faction: 'elves', cls: 'king', abbr: 'Кв', royal: true, ranged: true,
    rules: ['Ходит на 1 клетку в любую сторону (на свободную).', '2-е нажатие — атака фигуры на одной из 8 соседних клеток; королева при этом не перемещается.',
      CD, 'Лидер Эльфов: нельзя ходить под шах; мат — поражение.'],
    normal(c) { c.leap(FC.ALL8, { capture: false }); },
    special(c) {
      for (const [dx, dy] of FC.ALL8) c.shoot(c.x + dx, c.y + dy, 'Атака соседней клетки');
      if (!c.acts.length && !c.notes.length) c.note('Рядом нет вражеских фигур.');
    }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
