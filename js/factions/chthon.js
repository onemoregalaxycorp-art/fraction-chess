'use strict';
/* ХТОНЬ (АБЕРРАЦИИ) — слияние существ, паразитирование, контроль разума, искажение пространства.
   Слияние: фигура (кроме короля) своим ходом входит на клетку союзника — получается объединение
   с ходами всех составляющих (engine: parts / mergeMove / separationActs). */
(function (FC) {
  FC.defineFaction('chthon', {
    name: 'Хтонь (Аберрации)', color: '#0d9488', merge: true,
    desc: 'Космический ужас: союзные фигуры сливаются в одно существо с ходами всех составляющих, Ползучая плоть заражает врагов, Пожиратель разума берёт их под контроль, Ксал\'Таргон и ТХ\'Зсал искажают линии доски. Лидер — ТХ\'Зсал.',
    back: ['anomaly', 'mind_devourer', 'ab_bishop', 'xal', 'tx', 'ab_bishop', 'mind_devourer', 'anomaly'], pawn: 'flesh'
  });
  const MERGE = 'Слияние: своим ходом может войти на клетку союзной фигуры (кроме короля) — получится объединение с ходами обеих. Разделение — ходом одной из составляющих (2-е нажатие на объединение).';

  FC.definePiece('flesh', {
    name: 'Ползучая плоть', faction: 'chthon', cls: 'pawn', abbr: 'Пл', evolveAtEdge: true,
    rules: ['Ходит только на 1 клетку прямо вперёд или вбок (не назад и не по диагонали). Обычного взятия нет.',
      '«Паразитирование» (2-е нажатие): заражает вражескую фигуру на соседней клетке по диагонали (на 1 клетку).',
      'После заражения плоть проникает внутрь фигуры и исчезает с доски. Заражённой фигурой управляет только игрок Аберраций. Когда она перемещается без взятия — гибнет, а на конечной клетке появляется Ползучая плоть.',
      'Усиление: достигнув противоположного края, плоть при заражении остаётся на доске и может заражать несколько существ одновременно (у каждой заражённой фигуры — своё действие).',
      'Заражённая фигура не может брать: вместо взятия она «своим способом взятия» заражает плотью следующую фигуру, а сама погибает.',
      'Соперник Хтони может взять свою заражённую фигуру, как вражескую.',
      'Короля заразить нельзя, но плоть грозит ему, как обычным взятием: может поставить шах и мат.',
      'Заражённые пешки соперника ходят в обратную сторону — туда, куда идут фигуры Аберраций.', MERGE],
    normal(c) { c.leap([[0, c.fwd], [1, 0], [-1, 0]], { capture: false }); },
    special(c) {
      const G = c.G, p = c.p;
      // короля плоть не заражает, но грозит ему как обычным взятием — это шах (и мат, если уйти некуда)
      if (c.threat) {
        for (const [dx, dy] of FC.DIAG) {
          const tx = c.x + dx, ty = c.y + dy, q = G.at(tx, ty);
          if (!q || q.owner === c.side) continue;
          const L = G.leader(q.owner);
          if (L && L.p === q) c.add('ranged', tx, ty, 'Угроза королю (шах)', () => { });
        }
        return;
      }
      const mine = G.allPieces().filter(o => o.p.infBy && o.p.infBy.flesh === p.id).length;
      if (!p.evolved && mine >= 1) { c.warn('Ползучая плоть уже заразила существо — до достижения края больше одного одновременно нельзя.'); return; }
      for (const [dx, dy] of FC.DIAG) {
        const tx = c.x + dx, ty = c.y + dy, q = G.at(tx, ty);
        if (!q || q.owner === c.side || q.infBy) continue;
        const L = G.leader(q.owner);
        if (G.partsOf(q).some(t => FC.PIECES[t].royal) || (L && L.p === q)) { c.note('Короля заразить нельзя, но плоть грозит ему, как обычным взятием: это шах.'); continue; }
        const fx = c.x, fy = c.y, evolved = !!p.evolved;
        c.add('convert', tx, ty, `Паразитирование: заразить «${G.name(q)}»${evolved ? '' : ' (плоть уйдёт внутрь фигуры)'}`, g => {
          q.infBy = { side: c.side, flesh: p.id }; q.mind = null;
          g.log(`Ползучая плоть заражает ${g.who(q)} — теперь ею управляют Аберрации`);
          if (evolved) return;                       // усиленная плоть остаётся и может заражать дальше
          // плоть проникает внутрь фигуры и исчезает с доски (в объединении — уходит только сама плоть)
          const host = g.board[fy][fx];
          const i = g.partsOf(host).indexOf('flesh');
          g.board[fy][fx] = host.parts && host.parts.length ? g.remainderOf(host, i) : null;
          g.log('Ползучая плоть исчезает внутри заражённой фигуры');
        });
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет вражеских фигур на соседних клетках по диагонали.');
    }
  });

  FC.definePiece('mind_devourer', {
    name: 'Пожиратель разума', faction: 'chthon', cls: 'knight', abbr: 'Пр',
    rules: ['Ходит конём, перепрыгивает фигуры. Брать фигуры ходом коня может только в объединении (после слияния).',
      '«Контроль разума» (2-е нажатие, без перемещения): проклинает вражескую фигуру ровно в 2 клетках по вертикали, горизонтали или диагонали либо по схеме коня; фигуры между ними не мешают.',
      'Проклятой фигурой по-прежнему ходит её владелец, но Аберрации могут один раз совершить ею действие (в т.ч. взятие) вместо своего хода — после этого проклятие спадает.',
      'У одного Пожирателя разума под контролем может быть только одна фигура. Можно проклясть другую — тогда проклятие с прежней фигуры спадает.',
      'Пешки соперника под контролем Аберраций ходят в обратную сторону — туда, куда идут фигуры Аберраций.',
      'Можно проклясть и вражеского короля — это не взятие и не победа.', MERGE],
    normal(c) { c.leap(FC.KNIGHT, { capture: (c.p.parts || []).length > 0 }); },
    special(c) {
      const G = c.G, me = c.p.id;
      const prev = G.allPieces().find(o => o.p.mindBy === me && o.p.mind === c.side);
      if (prev) c.note(`Сейчас под контролем: «${G.name(prev.p)}» на ${FC.sq(prev.x, prev.y)}. Новое проклятие снимет прежнее.`);
      const offs = FC.KNIGHT.concat(FC.ALL8.map(([dx, dy]) => [2 * dx, 2 * dy]));   // конь + ровно 2 клетки по прямой и по диагонали
      for (const [dx, dy] of offs) {
        const tx = c.x + dx, ty = c.y + dy, q = G.at(tx, ty);
        if (!q || q.owner === c.side || q.mind === c.side || q.infBy) continue;
        c.add('convert', tx, ty, `Контроль разума: «${G.name(q)}»${prev ? ' (проклятие с прежней фигуры спадёт)' : ''}`, g => {
          // одна фигура на Пожирателя: прежнее проклятие спадает
          for (const o of g.allPieces()) if (o.p.mindBy === me && o.p.mind === c.side) { o.p.mind = null; o.p.mindBy = null; g.log(`Проклятие с ${g.who(o.p)} спадает`); }
          q.mind = c.side; q.mindBy = me;
          g.log(`Пожиратель разума проклинает ${g.who(q)}: Аберрации могут один раз сходить этой фигурой`);
        });
      }
      if (!c.acts.length) c.note('Нет вражеских фигур в 2 клетках по прямой, по диагонали или по схеме коня.');
    }
  });

  // Аномалия и Слон Аберраций: допустимы только конечные клетки на заданных расстояниях;
  // через фигуры не перепрыгивают — любая фигура на пути (на любой клетке) останавливает движение
  function oddEven(c, orth, diag) {
    for (const [dirs, allowed] of [[FC.ORTH, orth], [FC.DIAG, diag]]) {
      for (const [dx, dy] of dirs) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!c.G.inB(tx, ty)) break;
          const q = c.G.at(tx, ty);
          if (!allowed.includes(k)) { if (q) { c.block(tx, ty); break; } continue; }
          if (!q) { c.melee(tx, ty); continue; }
          if (q.owner === c.side) { if (c.mergeable(tx, ty)) c.melee(tx, ty); }
          else if (c.cap(tx, ty)) c.melee(tx, ty);
          break;
        }
      }
    }
  }
  FC.definePiece('anomaly', {
    name: 'Аномалия', faction: 'chthon', cls: 'rook', abbr: 'Ан',
    rules: ['По вертикали и горизонтали — только на 1, 3, 5 или 7 клеток; по диагонали — только на 2, 4 или 6.',
      'Через фигуры не перепрыгивает: любая фигура на пути (и на промежуточной клетке) останавливает движение.',
      'На допустимой клетке можно взять врага или слиться с союзником; дальше через занятую допустимую клетку идти нельзя.', MERGE],
    normal(c) { oddEven(c, [1, 3, 5, 7], [2, 4, 6, 8]); }
  });
  FC.definePiece('ab_bishop', {
    name: 'Слон Аберраций', faction: 'chthon', cls: 'bishop', abbr: 'СА',
    rules: ['«Обратная Аномалия»: по диагонали — только на 1, 3, 5 или 7 клеток; по вертикали и горизонтали — только на 2, 4 или 6.',
      'Остальные правила — как у Аномалии: через фигуры не перепрыгивает, на допустимой клетке — взятие или слияние.', MERGE],
    normal(c) { oddEven(c, [2, 4, 6, 8], [1, 3, 5, 7]); }
  });

  FC.definePiece('xal', {
    name: 'Ксал\'Таргон', faction: 'chthon', cls: 'queen', abbr: 'КТ',
    rules: ['Ходит как ферзь.',
      '«Пожелание реальности» (2-е нажатие): выбирается линия (вертикаль, горизонталь или диагональ) от края доски до Ксал\'Таргона. Все фигуры на ней одновременно сдвигаются на 1 клетку к нему.',
      'Союзная фигура прямо перед ним сливается с ним, вражескую он пожирает.',
      'Если прямо перед ним стоит ТХ\'Зсал, король не сливается, а перемещается на клетку за Ксал\'Таргоном (она должна быть свободна).', MERGE],
    normal(c) { c.slide(FC.ALL8); },
    special(c) {
      const G = c.G, fx = c.x, fy = c.y, p = c.p, side = c.side;
      for (const [dx, dy] of FC.ALL8) {
        const ray = [];
        for (let k = 1; k < 8; k++) { const x = fx + dx * k, y = fy + dy * k; if (!G.inB(x, y)) break; ray.push([x, y]); }
        if (!ray.length || !ray.some(([x, y]) => G.at(x, y))) continue;
        const q1 = G.at(ray[0][0], ray[0][1]);
        // союзный король прямо перед ним не сливается, а перемещается за Ксал'Таргона
        const kingFirst = q1 && q1.owner === side && G.partsOf(q1).some(t => FC.PIECES[t].royal);
        const bx = fx - dx, by = fy - dy;
        if (kingFirst && !G.empty(bx, by)) { c.note('ТХ\'Зсал перед Ксал\'Таргоном не может перейти за него: клетка за Ксал\'Таргоном занята или за краем доски.'); continue; }
        if (q1 && q1.owner === side && !kingFirst && !G.canMerge(q1, p, side)) continue;
        const what = !q1 ? '' : kingFirst ? ` — «${G.name(q1)}» перемещается за Ксал'Таргона` : q1.owner === side ? ` — «${G.name(q1)}» сливается с ним` : ` — пожирает «${G.name(q1)}»`;
        const a = c.add('special', ray[0][0], ray[0][1], `Пожелание реальности: сдвинуть линию к себе${what}`, g => {
          const me = g.board[fy][fx];
          const first = g.at(ray[0][0], ray[0][1]);
          if (first) {
            if (kingFirst) { g.board[ray[0][1]][ray[0][0]] = null; g.board[by][bx] = first; g.log(`${g.who(first)} перемещается за Ксал'Таргона на ${FC.sq(bx, by)}`); }
            else if (first.owner === me.owner) { g.mergeMove(ray[0][0], ray[0][1], fx, fy); }
            else { g.capture(ray[0][0], ray[0][1], me, {}); g.log('Ксал\'Таргон пожирает фигуру'); }
          }
          // остальные фигуры линии одновременно сдвигаются на 1 клетку к нему
          for (let i = 1; i < ray.length; i++) {
            const [x, y] = ray[i], q = g.board[y][x];
            if (!q) continue;
            g.board[y][x] = null; g.board[ray[i - 1][1]][ray[i - 1][0]] = q;
          }
          g.log('«Пожелание реальности»: линия сдвинута к Ксал\'Таргону');
        });
        a.alt = ray.slice(1);
        a.line = ray;
        a.dir = [-dx, -dy];        // для джойстика и стрелок: фигуры линии едут к Ксал'Таргону
        a.dist = 1;
        a.pull = true;
      }
      if (!c.acts.length && !c.notes.length) c.note('На линиях от Ксал\'Таргона до края доски нет фигур.');
    }
  });

  // все линии доски (ряды, столбцы, обе диагонали) — списки клеток по порядку
  const LINES = (() => {
    const L = [];
    for (let y = 0; y < 8; y++) L.push({ kind: 'row', n: y, cells: [...Array(8)].map((_, x) => [x, y]) });
    for (let x = 0; x < 8; x++) L.push({ kind: 'col', n: x, cells: [...Array(8)].map((_, y) => [x, y]) });
    for (let s = -6; s <= 6; s++) { const cells = []; for (let x = 0; x < 8; x++) { const y = x - s; if (y >= 0 && y < 8) cells.push([x, y]); } L.push({ kind: 'diag', n: s, cells }); }
    for (let s = 1; s <= 13; s++) { const cells = []; for (let x = 0; x < 8; x++) { const y = s - x; if (y >= 0 && y < 8) cells.push([x, y]); } L.push({ kind: 'anti', n: s, cells }); }
    return L;
  })();
  const DIR_NAME = {
    row: ['вправо', 'влево'], col: ['вверх', 'вниз'], diag: ['вперёд (вверх-вправо)', 'назад (вниз-влево)'], anti: ['вперёд (вверх-влево)', 'назад (вниз-вправо)']
  };
  const lineName = l => l.kind === 'row' ? `ряд ${l.n + 1}` : l.kind === 'col' ? `столбец ${'abcdefgh'[l.n]}` : `диагональ ${FC.sq(...l.cells[0])}–${FC.sq(...l.cells[l.cells.length - 1])}`;

  FC.definePiece('tx', {
    name: 'ТХ\'Зсал', faction: 'chthon', cls: 'king', abbr: 'ТХ', royal: true,
    rules: ['Ходит как король, берёт обычным образом. Лидер Аберраций: нельзя ходить под шах; мат — поражение.',
      '«Искажение пространства» (2-е нажатие, затем нажмите на клетку нужной линии): выбранный ряд сдвигается вправо/влево, столбец — вверх/вниз, диагональ — вперёд/назад. Все фигуры линии одновременно сдвигаются на 1 клетку; ушедшая за край появляется на противоположном конце той же линии.',
      'ТХ\'Зсал выбирает, участвовать ли ему. Если нет — фигура прямо перед ним перепрыгивает его и встаёт за ним; ни одна фигура не может оказаться на его клетке.',
      'Объединения сдвигаются как одна фигура; сдвиг не создаёт и не разделяет объединений.',
      'Сдвиг не может оставить своего короля под шахом и не может поставить мат; может вывести ТХ\'Зсала из-под шаха и одновременно поставить шах.',
      'Перезарядка: после применения способность недоступна следующие 3 своих хода.'],
    normal(c) { c.leap(FC.ALL8); },
    special(c) {
      const G = c.G, p = c.p, side = c.side;
      if (c.threat) return;                             // сдвиг никого не «бьёт» — в расчёт угроз не входит
      if (p.cooldown > 0) { c.note(`⏳ Искажение пространства перезаряжается: ещё ${p.cooldown - 1} свой(их) ход(а).`); return; }
      const me = [c.x, c.y];
      for (const l of LINES) {
        const n = l.cells.length;
        if (n < 2) continue;
        const occ = l.cells.map(([x, y]) => G.at(x, y));
        if (!occ.some(Boolean)) continue;
        const k = l.cells.findIndex(([x, y]) => x === me[0] && y === me[1]);
        for (const dir of [1, -1]) {
          const order = dir === 1 ? l.cells : l.cells.slice().reverse();
          const kk = k < 0 ? -1 : (dir === 1 ? k : n - 1 - k);
          for (const part of (kk >= 0 ? [true, false] : [null])) {
            // новое место для каждой фигуры линии (индексы в порядке сдвига)
            const moves = [];
            for (let i = 0; i < n; i++) {
              const [x, y] = order[i], q = G.at(x, y);
              if (!q) continue;
              let j = (i + 1) % n;
              if (part === false) {
                if (i === kk) j = i;                                  // ТХ'Зсал стоит на месте
                else if (j === kk) j = (kk + 1) % n;                  // фигура перед ним перепрыгивает его
              }
              moves.push([i, j]);
            }
            if (moves.every(([i, j]) => i === j)) continue;
            const label = `Искажение: ${lineName(l)} ${DIR_NAME[l.kind][dir === 1 ? 0 : 1]}` +
              (part === true ? ' (ТХ\'Зсал сдвигается вместе с линией)' : part === false ? ' (ТХ\'Зсал остаётся на месте)' : '');
            const a = c.add('special', order[0][0], order[0][1], label, g => {
              const objs = moves.map(([i, j]) => [g.board[order[i][1]][order[i][0]], j]);
              for (const [i] of moves) g.board[order[i][1]][order[i][0]] = null;
              for (const [q, j] of objs) g.board[order[j][1]][order[j][0]] = q;
              const t = g.find(p.id); if (t) t.p.cooldown = 4;   // недоступно следующие 3 своих хода
              g.log(`ТХ'Зсал искажает пространство: ${label.replace('Искажение: ', '')}`);
            }, { noMate: true, line: order, side });
            a.alt = order.slice(1);
            a.dir = [order[1][0] - order[0][0], order[1][1] - order[0][1]];   // куда сдвигается линия — для стрелок
            a.stay = part === false ? [c.x, c.y] : null;                      // ТХ'Зсал остаётся на месте
            a.dist = 1; a.part = part;                                         // для джойстика
          }
        }
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет линий, которые можно сдвинуть.');
    }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
