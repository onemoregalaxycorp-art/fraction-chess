'use strict';
(function (FC) {
  FC.defineFaction('orcs', {
    name: 'Орки и гоблины', color: '#16a34a',
    desc: 'Агрессия, прорывы и прыжки через фигуры. Орк-воин, Вождь, Хоп-гоблин и Шаман едят две фигуры подряд, если они стоят вплотную друг к другу.',
    back: ['orc_warrior', 'rider', 'rogue', 'chief', 'shaman', 'rogue', 'rider', 'orc_warrior'], pawn: 'goblin'
  });
  const WARRIOR_RANGE = 5;   // Большой орк-воин
  const DBL_RANGE = 4;       // двойной прорыв Вождя и Плута: второй враг не дальше 4 клеток (у Орка-воина — его дальность 5)
  const DBL_RULE = r => `«Двойной прорыв» (2-е нажатие): если между двумя врагами на линии есть свободные клетки, а второй стоит не дальше ${r} клеток, съедает обоих и шагает на 1 клетку дальше (если свободно).`;
  const DOUBLE = 'Двойное взятие: если сразу за взятой фигурой (вплотную, в том же направлении) стоит ещё один враг — съедает обоих и встаёт на место второго. Вражеского лидера вторым взятием съесть нельзя.';
  // второй целью двойного взятия не может быть вражеский лидер
  const capSecond = (c, x, y) => c.cap(x, y) && !c.G.def(c.G.at(x, y)).royal;

  /* Двойное взятие: враг E1 на (tx,ty) и враг E2 вплотную за ним (tx+dx, ty+dy).
     after(g, x, y) — дополнительный шаг после взятия (у Орка-воина и Вождя). */
  function dbl(c, tx, ty, dx, dy, after) {
    const ux = tx + dx, uy = ty + dy;
    if (!c.cap(tx, ty) || !capSecond(c, ux, uy)) return;
    const p = c.p, fx = c.x, fy = c.y;
    c.add('capture', ux, uy, 'Двойное взятие: две фигуры подряд', g => {
      g.capture(tx, ty, p); g.capture(ux, uy, p); g.move(fx, fy, ux, uy);
      if (after) after(g, ux, uy);
    }, { hits: [[tx, ty], [ux, uy]] });
  }
  /* Линейное движение с обычным взятием + двойным взятием вплотную */
  function slideDbl(c, dirs, max, after) {
    const G = c.G;
    for (const [dx, dy] of dirs) {
      for (let k = 1; k <= max; k++) {
        const tx = c.x + dx * k, ty = c.y + dy * k;
        if (!G.inB(tx, ty)) break;
        if (!G.at(tx, ty)) { c.melee(tx, ty); continue; }
        if (c.cap(tx, ty)) { c.melee(tx, ty); dbl(c, tx, ty, dx, dy, after); }
        break;
      }
    }
  }
  const stepOn = (dx, dy) => (g, x, y) => { if (g.empty(x + dx, y + dy)) g.move(x, y, x + dx, y + dy); };

  FC.definePiece('goblin', {
    name: 'Гоблин', faction: 'orcs', cls: 'pawn', abbr: 'Гб', promote: 'hop_goblin',
    rules: ['Ходит на 1 клетку вперёд.', 'Берёт фигуру прямо перед собой (только одну — двойного взятия нет).',
      'С начальной позиции — двойной ход на 2 клетки вперёд.', 'На краю доски становится Хоп-гоблином.'],
    normal(c) {
      const [x1, y1] = c.rel(0, 1);
      if (c.empty(x1, y1)) {
        c.melee(x1, y1);
        const [x2, y2] = c.rel(0, 2);
        if (!c.p.moved && !c.p.summoned && c.empty(x2, y2)) c.melee(x2, y2, 'Двойной ход');
      } else if (c.cap(x1, y1)) {
        c.melee(x1, y1, 'Взятие прямо перед собой');
      }
    }
  });

  FC.definePiece('hop_goblin', {
    name: 'Хоп-гоблин', faction: 'orcs', cls: 'pawn', abbr: 'Хг',
    rules: ['На 1–2 клетки по вертикали или горизонтали, без прыжков.', 'Берёт на клетке приземления (допущение прототипа).', DOUBLE],
    normal(c) { slideDbl(c, FC.ORTH, 2); }
  });

  FC.definePiece('rogue', {
    name: 'Гоблин-плут', faction: 'orcs', cls: 'bishop', abbr: 'Пл',
    rules: ['Ходит и берёт как обычный слон — по диагонали на любое расстояние.', 'Перепрыгивать может только союзные фигуры; вражеская фигура останавливает его.',
      '«Прорыв»: берёт первого врага на диагонали и обязан шагнуть ещё на 1 клетку дальше, если она свободна. Если занята — остаётся на клетке взятой фигуры.',
      'Двух врагов вплотную одним ходом не берёт.', DBL_RULE(DBL_RANGE)],
    special(c) { breakthrough(c, true, FC.DIAG, DBL_RANGE); if (!c.acts.length) c.note('Нет диагонали с двумя врагами (с промежутком) для двойного прорыва.'); },
    normal(c) {
      const G = c.G, p = c.p, fx = c.x, fy = c.y;
      for (const [dx, dy] of FC.DIAG) {
        let jumped = false;
        for (let k = 1; k < 8; k++) {
          const tx = fx + dx * k, ty = fy + dy * k;
          if (!G.inB(tx, ty)) break;
          const q = G.at(tx, ty);
          if (!q) { c.melee(tx, ty, jumped ? 'Перемещение (через союзника)' : 'Перемещение'); continue; }
          if (q.owner === c.side) { jumped = true; continue; }      // союзника перепрыгивает
          if (c.cap(tx, ty)) {
            const l1 = [tx + dx, ty + dy], free = G.empty(l1[0], l1[1]);
            c.add('capture', tx, ty, free ? 'Прорыв: взятие + шаг вперёд' : 'Прорыв: взятие (шаг вперёд невозможен)', g => {
              g.capture(tx, ty, p);
              const L = g.empty(l1[0], l1[1]) ? l1 : [tx, ty];
              g.move(fx, fy, L[0], L[1]);
            });
          }
          break;                                                    // через врага — нельзя
        }
      }
    }
  });

  function breakthrough(c, dbl2, dirs, range) {
    const G = c.G, p = c.p, fx = c.x, fy = c.y;
    for (const [dx, dy] of dirs) {
      for (let k = 1; k <= range; k++) {
        const tx = fx + dx * k, ty = fy + dy * k;
        if (!G.inB(tx, ty)) break;
        if (!G.at(tx, ty)) { if (!dbl2) c.melee(tx, ty); continue; }
        if (!c.cap(tx, ty)) break;
        const l1 = [tx + dx, ty + dy];
        if (!dbl2) {
          c.add('capture', tx, ty, G.empty(l1[0], l1[1]) ? 'Прорыв: взятие + шаг вперёд' : 'Прорыв: взятие (шаг вперёд невозможен)', g => {
            g.capture(tx, ty, p);
            const L = g.empty(l1[0], l1[1]) ? l1 : [tx, ty];
            g.move(fx, fy, L[0], L[1]);
          });
          dbl(c, tx, ty, dx, dy, stepOn(dx, dy));
        } else if (G.empty(l1[0], l1[1])) {
          for (let m = k + 2; m <= range; m++) {
            const ux = fx + dx * m, uy = fy + dy * m;
            if (!G.inB(ux, uy)) break;
            if (!G.at(ux, uy)) continue;
            if (capSecond(c, ux, uy)) {
              const l2 = [ux + dx, uy + dy];
              c.add('capture', ux, uy, 'Прорыв: двойное взятие через клетку + шаг вперёд', g => {
                g.capture(tx, ty, p); g.capture(ux, uy, p);
                const L = g.empty(l2[0], l2[1]) ? l2 : [ux, uy];
                g.move(fx, fy, L[0], L[1]);
              }, { hits: [[tx, ty], [ux, uy]] });
            } else if (c.cap(ux, uy)) c.note('Вражеского лидера нельзя съесть вторым взятием.');
            break;
          }
        }
        break;
      }
    }
  }

  FC.definePiece('orc_warrior', {
    name: 'Большой орк-воин', faction: 'orcs', cls: 'rook', abbr: 'Ор',
    rules: [`По вертикали/горизонтали до ${WARRIOR_RANGE} клеток, без прыжков.`,
      `«Прорыв»: берёт первого врага на линии (в пределах ${WARRIOR_RANGE}) и обязан шагнуть на 1 клетку дальше, если она свободна.`,
      'Два врага вплотную друг к другу — съедает обоих и шагает дальше.', DBL_RULE(WARRIOR_RANGE)],
    normal(c) { breakthrough(c, false, FC.ORTH, WARRIOR_RANGE); },
    special(c) { breakthrough(c, true, FC.ORTH, WARRIOR_RANGE); if (!c.acts.length) c.note('Нет линии с двумя врагами (с промежутком) для двойного прорыва.'); }
  });

  FC.definePiece('rider', {
    name: 'Всадник', faction: 'orcs', cls: 'knight', abbr: 'Вс',
    rules: ['Прыжки: «1 вперёд + 2 вбок», «3 вперёд + 1 вбок» и «1 назад + 2 вбок» (всего 6 вариантов).',
      'Прыжка «2 вперёд + 1 вбок» нет; назад — только «2 вбок + 1 назад».', 'Перепрыгивает фигуры.', 'Двойного взятия нет.'],
    normal(c) {
      // (±2, 1 вперёд), (±1, 3 вперёд) и (±2, 1 назад)
      const f = c.fwd;
      c.leap([[2, f], [-2, f], [1, 3 * f], [-1, 3 * f], [2, -f], [-2, -f]]);
    }
  });

  FC.definePiece('chief', {
    name: 'Вождь орды', faction: 'orcs', cls: 'queen', abbr: 'Вж',
    rules: ['«Рывок завоевателя» (1-е нажатие): ходит как ферзь; после взятия обязан шагнуть ещё на 1 клетку в том же направлении, если она свободна.',
      'Два врага вплотную друг к другу — съедает обоих, затем шаг на 1 клетку.',
      '«Неудержимая ярость» (2-е нажатие): враг вплотную + следующий враг на той же линии — оба уничтожаются, Вождь перепрыгивает всё и встаёт на самую дальнюю свободную клетку к краю.', DBL_RULE(DBL_RANGE)],
    normal(c) {
      const G = c.G, p = c.p, fx = c.x, fy = c.y;
      for (const [dx, dy] of FC.ALL8) {
        for (let k = 1; k < 8; k++) {
          const tx = fx + dx * k, ty = fy + dy * k;
          if (!G.inB(tx, ty)) break;
          if (!G.at(tx, ty)) { c.melee(tx, ty); continue; }
          if (c.cap(tx, ty)) {
            const nx = tx + dx, ny = ty + dy;
            c.add('capture', tx, ty, G.empty(nx, ny) ? 'Рывок завоевателя: взятие + шаг на 1 клетку' : 'Взятие (дальнейший шаг невозможен)', g => {
              g.capture(tx, ty, p); g.move(fx, fy, tx, ty);
              if (g.empty(nx, ny)) g.move(tx, ty, nx, ny);
            });
            dbl(c, tx, ty, dx, dy, stepOn(dx, dy));
          }
          break;
        }
      }
    },
    special(c) {
      const G = c.G, p = c.p, fx = c.x, fy = c.y;
      for (const [dx, dy] of FC.ALL8) {
        const x1 = fx + dx, y1 = fy + dy;
        if (!c.cap(x1, y1)) continue;
        let n = 1; while (G.inB(fx + dx * (n + 1), fy + dy * (n + 1))) n++;
        for (let m = 2; m <= n; m++) {
          const ux = fx + dx * m, uy = fy + dy * m;
          if (!G.at(ux, uy)) continue;
          if (capSecond(c, ux, uy)) {
            let land = [ux, uy];
            for (let e = n; e > m; e--) { const lx = fx + dx * e, ly = fy + dy * e; if (G.empty(lx, ly)) { land = [lx, ly]; break; } }
            c.add('capture', ux, uy, `Неудержимая ярость: 2 взятия, рывок на ${FC.sq(land[0], land[1])}`, g => {
              g.capture(x1, y1, p); g.capture(ux, uy, p); g.move(fx, fy, land[0], land[1]);
            }, { hits: [[x1, y1], [ux, uy]] });
          } else c.note(c.cap(ux, uy) ? 'Вражеского лидера нельзя съесть вторым взятием.' : 'За первым врагом стоит не враг — ярость невозможна.');
          break;
        }
      }
      breakthrough(c, true, FC.ALL8, DBL_RANGE);
      if (!c.acts.length) c.note('«Ярость» требует врага вплотную и ещё одного врага дальше на той же линии; «Двойной прорыв» — двух врагов на линии с промежутком.');
    }
  });

  FC.definePiece('shaman', {
    name: 'Старейшина-шаман', faction: 'orcs', cls: 'king', abbr: 'Шм', royal: true, ranged: true,
    rules: ['Ходит как король (допущение прототипа).', DOUBLE,
      '2-е нажатие — дальняя атака ровно на 2 клетки по вертикали, горизонтали или диагонали; фигура посередине блокирует.',
      'Перезарядка после атаки.', 'Лидер: нельзя ходить под шах; мат — поражение.'],
    normal(c) {
      c.leap(FC.ALL8);
      for (const [dx, dy] of FC.ALL8) dbl(c, c.x + dx, c.y + dy, dx, dy);
    },
    special(c) {
      const G = c.G;
      let blocked = 0;
      for (const [dx, dy] of FC.ALL8) {
        const mx = c.x + dx, my = c.y + dy, tx = c.x + 2 * dx, ty = c.y + 2 * dy;
        if (!G.inB(tx, ty)) continue;
        if (G.at(mx, my)) { if (c.cap(tx, ty)) { c.block(mx, my); blocked++; } continue; }
        c.zone(tx, ty);
        if (c.cap(tx, ty)) c.ranged(tx, ty, 'Магическая атака (ровно 2 клетки)');
      }
      if (blocked) c.note(`Целей, закрытых фигурой посередине: ${blocked}.`);
      if (!c.acts.length && !c.notes.length) c.note('Нет врагов ровно в 2 клетках (по вертикали, горизонтали или диагонали) с пустой клеткой посередине.');
    }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
