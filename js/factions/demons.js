'use strict';
(function (FC) {
  FC.defineFaction('demons', {
    name: 'Демоны', color: '#dc2626', stealsMoves: true, impOnKill: true, noCheck: true,
    desc: 'Берут и врагов, и союзников; похищают ходы. Взяв врага любой фигурой, кроме Импа, призывают Импа у ближайшего Обелиска. Шаха и мата у Демонов нет: они проигрывают, только если Призыватель погиб или не может возродить Короля демонов.',
    back: ['guard', 'obelisk', 'devourer', 'demon_king', 'summoner', 'devourer', 'obelisk', 'guard'], pawn: 'imp'
  });
  const ALLY = 'Может брать союзные фигуры (кроме Призывателя).';
  const STEAL = 'У каждой фигуры Демонов свой похищенный ход: взяв фигуру, она запоминает её ход (1 шт.) и может один раз применить его по 2-му нажатию.';

  FC.definePiece('imp', {
    name: 'Имп', faction: 'demons', cls: 'pawn', abbr: 'Им', promote: 'satyr', bloodlust: true,
    rules: ['Ход на 1 вперёд, с начальной позиции — на 2.', 'Взятие по диагонали вперёд. ' + ALLY,
      '«Кровожадность»: после взятия любой пешки на следующем своём ходу (2-е нажатие) может взять на 1 или 2 прямо вперёд или на 2 по диагонали вперёд; промежуточная клетка должна быть свободна.',
      'На краю доски становится Сатиром.'],
    normal(c) {
      const [x1, y1] = c.rel(0, 1);
      if (c.empty(x1, y1)) {
        c.melee(x1, y1);
        const [x2, y2] = c.rel(0, 2);
        if (!c.p.moved && !c.p.summoned && c.empty(x2, y2)) c.melee(x2, y2, 'Двойной ход');
      }
      for (const dx of [-1, 1]) { const [tx, ty] = c.rel(dx, 1); if (c.cap(tx, ty)) c.melee(tx, ty); }
    },
    special(c) {
      if (c.p.bloodlust <= 0) { c.note('«Кровожадность» неактивна: нужно взять пешку на предыдущем ходу.'); return; }
      for (const [dx, dy, mid] of [[0, 1, null], [0, 2, [0, 1]], [-2, 2, [-1, 1]], [2, 2, [1, 1]]]) {
        const [tx, ty] = c.rel(dx, dy);
        if (!c.cap(tx, ty)) continue;
        if (mid) { const [mx, my] = c.rel(mid[0], mid[1]); if (!c.empty(mx, my)) { c.block(mx, my); continue; } }
        c.melee(tx, ty, 'Кровожадность: взятие');
      }
      if (!c.acts.length) c.note('Кровожадность активна, но целей нет.');
    }
  });

  FC.definePiece('satyr', {
    name: 'Сатир', faction: 'demons', cls: 'pawn', abbr: 'Ст',
    rules: ['На 1 клетку в любом направлении, берёт так же (допущение прототипа).', ALLY],
    normal(c) { c.leap(FC.ALL8); }
  });

  FC.definePiece('obelisk', {
    name: 'Демонический обелиск', faction: 'demons', cls: 'knight', abbr: 'Об', ranged: true,
    rules: ['Перемещение на 1 клетку в любую сторону (только на свободную).',
      '2-е нажатие — дальняя атака по схеме коня (2+1), препятствия не мешают. Может бить и союзников.',
      'Перезарядка после атаки.', 'Рядом с Обелисками появляются Импы: когда любая фигура Демонов, кроме Импа, берёт вражескую фигуру — у Обелиска, ближайшего к месту взятия. Нет Обелисков или свободных клеток — Имп не появляется.'],
    normal(c) { c.leap(FC.ALL8, { capture: false }); },
    special(c) {
      for (const [dx, dy] of FC.KNIGHT) { const tx = c.x + dx, ty = c.y + dy; if (c.cap(tx, ty)) c.ranged(tx, ty, 'Дальняя атака (схема коня)'); }
      if (!c.acts.length && !c.notes.length) c.note('Нет целей по схеме коня.');
    }
  });

  FC.definePiece('guard', {
    name: 'Демон-страж', faction: 'demons', cls: 'rook', abbr: 'Дс', summonImp: true,
    rules: ['Ходит как ладья.', ALLY, 'Взяв врага, не похищает его ход (только призывает Импа у Обелиска).'],
    normal(c) { c.slide(FC.ORTH); }
  });

  FC.definePiece('devourer', {
    name: 'Демон-пожиратель', faction: 'demons', cls: 'bishop', abbr: 'Дп', summonImp: true,
    rules: ['Ходит как слон.', ALLY, 'Взяв врага, не похищает его ход (только призывает Импа у Обелиска).'],
    normal(c) { c.slide(FC.DIAG); }
  });

  FC.definePiece('demon_king', {
    name: 'Король демонов', faction: 'demons', cls: 'queen', abbr: 'КД',
    rules: ['Ходит как ферзь.', ALLY, 'Шаха и мата у Демонов нет — может вставать на атакованные клетки.',
      'После его гибели следующий ход Демонов уходит на возрождение: Призыватель приносит в жертву соседнюю союзную фигуру, и Король появляется на её месте. Нет жертвы — поражение.', STEAL],
    normal(c) { c.slide(FC.ALL8); }
  });

  FC.definePiece('summoner', {
    name: 'Призыватель', faction: 'demons', cls: 'king', abbr: 'Пз', royal: true,
    rules: ['На 1 клетку в любую сторону.', 'Лидер Демонов, но шаха и мата у Демонов нет: может стоять и ходить под удар. Если Призывателя взяли — Демоны проиграли.',
      'Если Король демонов погиб — 2-е нажатие: жертвоприношение соседней союзной фигуры для его возрождения (занимает весь ход).', STEAL],
    normal(c) { c.leap(FC.ALL8); }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
