'use strict';
(function (FC) {
  FC.defineFaction('humans', {
    name: 'Люди', color: '#3b82f6',
    desc: 'Классические шахматы. Вместо слонов — Жрецы с дальней атакой. Король призывает Пешки. Пешки могут ходить по схеме соседней союзной фигуры (не дальше 2 клеток).',
    borrowMoves: true, borrowRange: 2,
    back: ['rook', 'knight', 'priest', 'queen', 'king', 'priest', 'knight', 'rook'], pawn: 'pawn'
  });
  const PAWN_LIMIT_BOARD = 8, PAWN_SUMMON_GAME = 16;   // лимиты призыва Пешек Королём
  const BORROW = 'Строй: может сходить или взять по схеме соседней союзной фигуры (вплотную, в т.ч. по диагонали), но не дальше 2 клеток. Например, Пешка рядом со Жрецом — на 1–2 клетки по диагонали; рядом с Конём — прыжком коня.';

  FC.definePiece('pawn', {
    name: 'Пешка', faction: 'humans', cls: 'pawn', abbr: 'П',
    promote: ['queen', 'rook', 'priest', 'knight'],
    rules: ['Ход на 1 клетку вперёд, с начальной позиции — на 2.', 'Взятие по диагонали вперёд.',
      'На последней горизонтали превращается в Ферзя, Ладью, Жреца или Коня.', 'Взятие на проходе в прототипе отсутствует.'],
    normal(c) {
      const [x1, y1] = c.rel(0, 1);
      if (c.empty(x1, y1)) {
        c.melee(x1, y1);
        const [x2, y2] = c.rel(0, 2);
        if (!c.p.moved && !c.p.summoned && c.empty(x2, y2)) c.melee(x2, y2, 'Двойной ход');
      }
      for (const dx of [-1, 1]) { const [tx, ty] = c.rel(dx, 1); if (c.cap(tx, ty)) c.melee(tx, ty); }
    }
  });

  FC.definePiece('rook', {
    name: 'Ладья', faction: 'humans', cls: 'rook', abbr: 'Л',
    rules: ['Классическая ладья.'],
    normal(c) { c.slide(FC.ORTH); }
  });

  FC.definePiece('knight', {
    name: 'Конь', faction: 'humans', cls: 'knight', abbr: 'К',
    rules: ['Классический конь, перепрыгивает фигуры.'],
    normal(c) { c.leap(FC.KNIGHT); }
  });

  FC.definePiece('queen', {
    name: 'Ферзь', faction: 'humans', cls: 'queen', abbr: 'Ф',
    rules: ['Классический ферзь.'],
    normal(c) { c.slide(FC.ALL8); }
  });

  FC.definePiece('priest', {
    name: 'Жрец', faction: 'humans', cls: 'bishop', abbr: 'Жр', ranged: true,
    rules: ['Движется по диагонали на любое число свободных клеток.',
      'Ближнее взятие: враг на 1–2 клетки по диагонали, Жрец встаёт на его место.',
      '2-е нажатие — дальняя атака: враг на расстоянии 3+ по диагонали, Жрец не двигается. Любая фигура на пути блокирует.',
      'Перезарядка: после дальней атаки следующий свой ход без дальней атаки.'],
    normal(c) {
      const G = c.G;
      for (const [dx, dy] of FC.DIAG) {
        for (let k = 1; k <= (c.maxRange || 7); k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!G.inB(tx, ty)) break;
          if (!G.at(tx, ty)) { c.melee(tx, ty); continue; }
          if (k <= 2 && c.cap(tx, ty)) c.melee(tx, ty, 'Ближнее взятие (1–2 клетки)');
          break;
        }
      }
    },
    special(c) {
      const G = c.G;
      for (const [dx, dy] of FC.DIAG) {
        for (let k = 1; k < 8; k++) {
          const tx = c.x + dx * k, ty = c.y + dy * k;
          if (!G.inB(tx, ty)) break;
          if (!G.at(tx, ty)) continue;
          if (k >= 3 && c.cap(tx, ty)) c.ranged(tx, ty, 'Дальняя атака по диагонали');
          else if (G.inB(tx + dx, ty + dy)) c.block(tx, ty);
          break;
        }
      }
      if (!c.acts.length && !c.notes.length) c.note('Нет врагов на расстоянии 3+ по открытой диагонали.');
    }
  });

  FC.definePiece('king', {
    name: 'Король', faction: 'humans', cls: 'king', abbr: 'Кр', royal: true,
    rules: ['Ход на 1 клетку в любую сторону.', 'Рокировка (нельзя проходить через атакованные поля).',
      '2-е нажатие — вместо хода призывает Пешку на любую свободную соседнюю клетку (кроме последней горизонтали). Призванная пешка не имеет двойного первого хода.',
      'Лимиты призыва: на доске не больше 8 Пешек (считаются все Пешки, включая стартовые) и не больше 16 призывов за партию.',
      'Лидер: нельзя ходить под шах; мат — поражение.'],
    special(c) {
      const G = c.G, o = c.p.owner, last = o === 0 ? 7 : 0;
      const onBoard = G.pieces(o).filter(e => e.p.type === 'pawn').length;
      const used = G.players[o].pawnSummons || 0;
      if (used >= PAWN_SUMMON_GAME) { c.note(`Лимит призыва исчерпан: за партию уже призвано ${used} из ${PAWN_SUMMON_GAME} Пешек.`); return; }
      if (onBoard >= PAWN_LIMIT_BOARD) { c.note(`На доске уже ${onBoard} Пешек — больше ${PAWN_LIMIT_BOARD} призывать нельзя.`); return; }
      for (const [dx, dy] of FC.ALL8) {
        const x = c.x + dx, y = c.y + dy;
        if (!c.empty(x, y) || y === last) continue;
        c.add('summon', x, y, `Призвать Пешку (призвано ${used}/${PAWN_SUMMON_GAME} за партию)`, g => {
          g.spawn('pawn', o, x, y, { summoned: true, moved: true });
          g.players[o].pawnSummons = (g.players[o].pawnSummons || 0) + 1;
          g.log(`Король призывает Пешку на ${FC.sq(x, y)} (${g.players[o].pawnSummons}/${PAWN_SUMMON_GAME})`);
        });
      }
      if (!c.acts.length) c.note('Вокруг Короля нет свободных клеток для призыва Пешки.');
    },
    normal(c) {
      c.leap(FC.ALL8);
      if (c.threat || c.stolen || c.borrowed || c.p.moved) return;
      const G = c.G, y = c.y, p = c.p, kx = c.x;
      for (const side of [-1, 1]) {
        const rx = side < 0 ? 0 : 7, r = G.at(rx, y);
        if (!r || r.owner !== p.owner || r.type !== 'rook' || r.moved) continue;
        let clear = true;
        for (let x = Math.min(rx, kx) + 1; x < Math.max(rx, kx); x++) if (G.at(x, y)) clear = false;
        const kx2 = kx + 2 * side;
        if (!clear || !G.inB(kx2, y)) continue;
        if ([kx, kx + side, kx2].some(x => G.squareAttacked(x, y, 1 - p.owner))) {
          c.note('Рокировка запрещена: король под ударом или проходит через атакованное поле.'); continue;
        }
        c.add('special', kx2, y, side < 0 ? 'Длинная рокировка' : 'Короткая рокировка', g => {
          g.move(kx, y, kx2, y); g.move(rx, y, kx2 - side, y);
        });
      }
    }
  });

  // «Строй» — только у Пешек
  FC.PIECES.pawn.canBorrow = true;
  FC.PIECES.pawn.rules.push(BORROW);
})((typeof window !== 'undefined' ? window : globalThis).FC);
