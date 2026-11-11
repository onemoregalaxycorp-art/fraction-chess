'use strict';
(function (FC) {
  FC.defineFaction('orcs', {
    name: 'Орки и гоблины', color: '#16a34a',
    desc: 'Агрессия, прорывы и прыжки через фигуры. Орк-воин, Вождь, Хоп-гоблин и Шаман едят две фигуры подряд, если они стоят вплотную друг к другу.',
    back: ['orc_warrior', 'rider', 'rogue', 'chief', 'shaman', 'rogue', 'rider', 'orc_warrior'], pawn: 'goblin'
  });
  const WARRIOR_RANGE = 4;
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
      'С начальной позиции — двойной ход (с подтверждением).', 'На краю доски становится Хоп-гоблином.'],
    normal(c) {
      const [x1, y1] = c.rel(0, 1);
      if (c.empty(x1, y1)) {
        c.melee(x1, y1);
        const [x2, y2] = c.rel(0, 2);
        if (!c.p.moved && !c.p.summoned && c.empty(x2, y2))
          c.melee(x2, y2, 'Двойной ход (с подтверждением)', { confirm: 'Гоблин делает двухклеточный первый ход. Подтвердить?' });
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
    rules: ['Движется по диагонали.', 'За ход может перепрыгнуть не более одной союзной и не более одной вражеской фигуры.',
      'Перепрыгнутые фигуры не берутся; взятие — только завершив ход на клетке врага.', 'Двойного взятия нет.'],
    normal(c) {
      const G = c.G;
      for (const [dx, dy] of FC.DIAG) {
        let ja = false, je = false;
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!G.inB(tx, ty)) break;
          const q = G.at(tx, ty);
          const lbl = (ja || je) ? ' (с прыжком)' : '';
          if (!q) { c.melee(tx, ty, 'Перемещение' + lbl); continue; }
          if (q.owner === c.p.owner) { if (ja) break; ja = true; continue; }
          if (c.cap(tx, ty)) c.melee(tx, ty, 'Взятие' + lbl);
          if (je) break;
          je = true;
        }
      }
    }
  });

  function breakthrough(c, dbl2) {
    const G = c.G, p = c.p, fx = c.x, fy = c.y;
    for (const [dx, dy] of FC.ORTH) {
      for (let k = 1; k <= WARRIOR_RANGE; k++) {
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
          for (let m = k + 2; m <= WARRIOR_RANGE; m++) {
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
      'Два врага вплотную друг к другу — съедает обоих и шагает дальше (1-е нажатие).',
      `2-е нажатие — двойной прорыв, когда между врагами есть свободные клетки (второй враг в пределах ${WARRIOR_RANGE} клеток от старта).`],
    normal(c) { breakthrough(c, false); },
    special(c) { breakthrough(c, true); if (!c.acts.length) c.note('Нет линии с двумя врагами (с промежутком) для двойного прорыва.'); }
  });

  FC.definePiece('rider', {
    name: 'Всадник', faction: 'orcs', cls: 'knight', abbr: 'Вс',
    rules: ['Прыгает только вперёд: «1 вперёд + 2 вбок» и «3 вперёд + 1 вбок» (всего 4 варианта).',
      'Назад ходить не может; прыжка «2 вперёд + 1 вбок» нет.', 'Перепрыгивает фигуры.', 'Двойного взятия нет.'],
    normal(c) {
      // из ходов коня остаются только (±2, 1 вперёд); добавлены (±1, 3 вперёд); назад — нельзя
      const offs = FC.KNIGHT.filter(([dx, dy]) => Math.abs(dx) === 2 && dy === c.fwd);
      c.leap(offs.concat([[1, 3 * c.fwd], [-1, 3 * c.fwd]]));
    }
  });

  FC.definePiece('chief', {
    name: 'Вождь орды', faction: 'orcs', cls: 'queen', abbr: 'Вж',
    rules: ['«Рывок завоевателя» (1-е нажатие): ходит как ферзь; после взятия обязан шагнуть ещё на 1 клетку в том же направлении, если она свободна.',
      'Два врага вплотную друг к другу — съедает обоих, затем шаг на 1 клетку.',
      '«Неудержимая ярость» (2-е нажатие): враг вплотную + следующий враг на той же линии — оба уничтожаются, Вождь перепрыгивает всё и встаёт на самую дальнюю свободную клетку к краю.'],
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
      if (!c.acts.length) c.note('«Ярость» требует врага вплотную и ещё одного врага дальше на той же линии.');
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
        if (c.cap(tx, ty)) c.ranged(tx, ty, 'Магическая атака (ровно 2 клетки)');
      }
      if (blocked) c.note(`Целей, закрытых фигурой посередине: ${blocked}.`);
      if (!c.acts.length && !c.notes.length) c.note('Нет врагов ровно в 2 клетках (по вертикали, горизонтали или диагонали) с пустой клеткой посередине.');
    }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
