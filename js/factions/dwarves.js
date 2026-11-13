'use strict';
/* ДВАРФЫ — инженерия: механические копии фигур и автономные механизмы.
   Механизм хранит id создателя (maker). «Вооружённые» механизмы (armed) после взятия уничтожаются. */
(function (FC) {
  FC.defineFaction('dwarves', {
    name: 'Дварфы', color: '#d97706',
    desc: 'Инженерия: фигуры создают механические копии — механические пешки, слонов, ладей, коней и Королевский механизм. Механизм Королевский + механический ферзь = Великий механизм и победа.',
    back: ['dw_rook', 'boar', 'dw_bishop', 'dw_queen', 'dw_king', 'dw_bishop', 'boar', 'dw_rook'], pawn: 'dw_pawn'
  });
  const MECH_RULE = 'Механизм: не может создавать другие механизмы. Нежить не может забрать его в пул, Лич не превращает, а поглощает его.';
  const mechsOf = (G, id, type) => G.allPieces().filter(o => o.p.maker === id && (!type || o.p.type === type));
  const ADJ_DIAG = FC.DIAG, ADJ_ORTH = FC.ORTH;

  // «вооружённый» механизм: после успешного взятия уничтожается
  function selfDestructAfterCapture(c, from) {
    const p = c.p;
    if (!FC.PIECES[p.type].mech) return;   // похищенный Демонами ход механизма не уничтожает похитителя
    for (let i = from; i < c.acts.length; i++) {
      const a = c.acts[i];
      if (a.kind !== 'capture') continue;
      const ap = a.apply;
      a.label += ' — механизм уничтожится';
      a.apply = g => { ap(g); const f = g.find(p.id); if (f) { g.board[f.y][f.x] = null; g.log(`${g.who(p)} уничтожается после взятия`); } };
    }
  }
  function removeOld(g, maker, type) {
    for (const o of mechsOf(g, maker, type)) { g.board[o.y][o.x] = null; g.log(`Старый механизм «${FC.PIECES[o.p.type].name}» на ${FC.sq(o.x, o.y)} разобран`); }
  }
  /* Королевский механизм + механизм на одной клетке: оба исчезают, на их месте появляется улучшенный механизм
     (по типу обычного механизма), он остаётся под контролем того же призывателя */
  const UPGRADE = { mech_rook: 'up_mech_rook', mech_bishop: 'up_mech_bishop', mech_knight: 'up_mech_knight' };
  const UP_TYPES = Object.values(UPGRADE);
  function royalMerge(g, fx, fy, tx, ty) {
    const a = g.board[fy][fx], b = g.board[ty][tx];
    const other = a.type === 'royal_mech' ? b : a;
    const up = UPGRADE[other.type];
    g.board[fy][fx] = null; g.board[ty][tx] = null;
    g.log(`Королевский механизм и «${FC.PIECES[other.type].name}» сливаются на ${FC.sq(tx, ty)}`);
    g.spawn(up, other.owner, tx, ty, { moved: true, summoned: true, maker: other.maker, armed: true });
    g.log(`Появляется «${FC.PIECES[up].name}»`);
  }
  // ход механизма на клетку своего Королевского механизма (и наоборот)
  function addRoyalMerge(c, tx, ty) {
    const q = c.G.at(tx, ty), p = c.p;
    if (!q || q.owner !== c.side || q.owner !== p.owner) return;
    const ok = (p.type === 'royal_mech' && UPGRADE[q.type]) || (q.type === 'royal_mech' && UPGRADE[p.type]);
    if (!ok) return;
    const fx = c.x, fy = c.y;
    const up = FC.PIECES[UPGRADE[p.type === 'royal_mech' ? q.type : p.type]].name;
    c.add('special', tx, ty, `Слиться с ${p.type === 'royal_mech' ? `«${c.G.name(q)}»` : 'Королевским механизмом'} → «${up}»`, g => royalMerge(g, fx, fy, tx, ty));
  }
  // обязательный ход связанного механизма вслед за призывателем (если его нет — ограничения нет)
  function linkFollow(c, link) {
    const G = c.G;
    if (!link || c.threat) return;
    const keep = [];
    for (const a of c.acts) {
      const s = G.snapshot();
      let ok = false;
      try {
        a.apply(G);
        const m = G.find(link.p.id);
        ok = !m || G.actionsFor(m.x, m.y, 'normal', { side: c.side }).acts.some(b => G.isLegal(b, c.side));
      } finally { G.restore(s); }
      if (!ok) continue;
      const ap = a.apply, mid = link.p.id, side = c.side, nm = FC.PIECES[link.p.type].name;
      a.label += ` + обязательный ход: ${nm}`;
      a.apply = g => {
        ap(g);
        g.queue.push(gg => {
          const m = gg.find(mid); if (!m || gg.winner != null) return null;
          const opts = gg.actionsFor(m.x, m.y, 'normal', { side }).acts.filter(b => gg.isLegal(b, side));
          if (!opts.length) return null;
          return { owner: side, kind: 'cells', text: `Призыватель сходил — «${nm}» обязан переместиться: выберите клетку`,
            cells: opts.map(b => ({ x: b.x, y: b.y, fn: g2 => b.apply(g2) })) };
        });
      };
      keep.push(a);
    }
    if (keep.length < c.acts.length) c.note(`Часть ходов недоступна: после них «${FC.PIECES[link.p.type].name}» не сможет легально сходить.`);
    c.acts = keep;
  }
  const spawnMech = (g, type, owner, x, y, extra) => {
    const m = g.spawn(type, owner, x, y, Object.assign({ moved: true, summoned: true }, extra));
    g.log(`Создан «${FC.PIECES[type].name}» на ${FC.sq(x, y)}`);
    return m;
  };

  /* ---------- пешки ---------- */
  FC.definePiece('dw_pawn', {
    name: 'Пешка дварфов', faction: 'dwarves', cls: 'pawn', abbr: 'Пд', promote: 'engineer',
    rules: ['Ход на 1 клетку вперёд, без двойного хода.', 'Берёт по диагонали вперёд на 1 клетку.',
      '2-е нажатие — вместо хода создаёт механическую пешку на свободной клетке прямо перед собой. Не больше 2 механических пешек за партию (у каждой пешки свой счёт).',
      'На краю доски становится Инженером I уровня.'],
    normal(c) {
      const [x1, y1] = c.rel(0, 1);
      if (c.empty(x1, y1)) c.melee(x1, y1);
      for (const dx of [-1, 1]) { const [tx, ty] = c.rel(dx, 1); if (c.cap(tx, ty)) c.melee(tx, ty); }
    },
    special(c) {
      const p = c.p, made = p.made || 0;
      if (made >= 2) { c.warn('Эта пешка уже создала 2 механические пешки — больше нельзя.'); return; }
      const [x1, y1] = c.rel(0, 1);
      if (!c.empty(x1, y1)) { c.note('Клетка перед пешкой занята — механическую пешку создать негде.'); return; }
      c.add('summon', x1, y1, `Создать механическую пешку (${made + 1}/2)`, g => {
        spawnMech(g, 'mech_pawn', p.owner, x1, y1, { maker: p.id, dir: g.players[p.owner].dir });
        p.made = made + 1;
      });
    }
  });

  FC.definePiece('mech_pawn', {
    name: 'Механическая пешка', faction: 'dwarves', cls: 'pawn', abbr: 'МП', mech: true, value: 1, glyph: '⚙', promote: 'mech_queen',
    rules: ['Ход на 1 клетку вперёд (у механизмов Инженера «вперёд» — в обратную сторону).', 'Берёт фигуру прямо перед собой на 1 клетку и после взятия уничтожается.',
      'На противоположном краю (по направлению своего движения) становится механическим ферзём.', MECH_RULE],
    normal(c) {
      const [x1, y1] = c.rel(0, 1), n = c.acts.length;
      if (c.empty(x1, y1)) c.melee(x1, y1);
      else if (c.cap(x1, y1)) c.melee(x1, y1, 'Взятие прямо перед собой');
      selfDestructAfterCapture(c, n);
    }
  });

  FC.definePiece('mech_queen', {
    name: 'Механический ферзь', faction: 'dwarves', cls: 'queen', abbr: 'МФ', mech: true, value: 6, glyph: '⚙',
    rules: ['Ходит как ферзь, не перепрыгивает фигуры.', 'Обычное взятие — после него механизм уничтожается.',
      'Рядом с Королевским механизмом может стать частью Великого механизма.', MECH_RULE],
    normal(c) { const n = c.acts.length; c.slide(FC.ALL8); selfDestructAfterCapture(c, n); }
  });

  FC.definePiece('engineer', {
    name: 'Инженер I уровня', faction: 'dwarves', cls: 'pawn', abbr: 'Ин', glyph: '⚒', shape: 'bishop',
    rules: ['Ходит на 1 клетку в любую сторону, берёт так же.',
      '2-е нажатие — создаёт механическую пешку без ограничения за партию, но одновременно может существовать только одна его механическая пешка.',
      'Его механические пешки идут в обратную сторону (к своему краю доски); создаются на соседней клетке в этом направлении.'],
    normal(c) { c.leap(FC.ALL8); },
    special(c) {
      const p = c.p, G = c.G, back = -G.players[p.owner].dir;
      if (mechsOf(G, p.id).length) { c.warn('Механическая пешка Инженера ещё на доске — новую можно создать после её уничтожения.'); return; }
      const tx = c.x, ty = c.y + back;
      if (!c.empty(tx, ty)) { c.note('Клетка, где создаётся механическая пешка, занята.'); return; }
      c.add('summon', tx, ty, 'Создать механическую пешку (идёт в обратную сторону)', g => {
        spawnMech(g, 'mech_pawn', p.owner, tx, ty, { maker: p.id, dir: back });
      });
    }
  });

  /* ---------- слоны ---------- */
  FC.definePiece('dw_bishop', {
    name: 'Дварф-слон', faction: 'dwarves', cls: 'bishop', abbr: 'Сд',
    rules: ['Ходит как слон.', '2-е нажатие — призывает механического слона на свободную соседнюю клетку по диагонали (впереди или позади). Одновременно — один; повторный призыв разбирает старого.',
      'Пока жив его улучшенный механический слон — нового призвать нельзя, а при каждом ходе Дварф-слона улучшенный механизм обязан тоже сходить.'],
    normal(c) { c.slide(FC.DIAG); linkFollow(c, mechsOf(c.G, c.p.id, 'up_mech_bishop')[0]); },
    special(c) {
      const p = c.p, had = mechsOf(c.G, p.id, 'mech_bishop').length;
      if (mechsOf(c.G, p.id, 'up_mech_bishop').length) { c.warn('Пока жив улучшенный механический слон, нового призвать нельзя.'); return; }
      for (const [dx, dy] of ADJ_DIAG) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.empty(tx, ty)) continue;
        c.add('summon', tx, ty, had ? 'Призвать механического слона (старый будет разобран)' : 'Призвать механического слона', g => {
          removeOld(g, p.id, 'mech_bishop');
          spawnMech(g, 'mech_bishop', p.owner, tx, ty, { maker: p.id });
        });
      }
      if (!c.acts.length) c.note('Нет свободных соседних клеток по диагонали.');
    }
  });

  FC.definePiece('mech_bishop', {
    name: 'Механический слон', faction: 'dwarves', cls: 'bishop', abbr: 'МС', mech: true, value: 1.5, glyph: '⚙',
    rules: ['По диагонали не дальше 3 клеток, не перепрыгивает фигуры.',
      'Созданный Дварф-слоном: не берёт фигуры, служит препятствием (его можно уничтожить).',
      'Созданный Дварф-ферзём: берёт фигуры и после взятия уничтожается.', 'Может встать на клетку своего Королевского механизма (или он — на его клетку): оба исчезают, появляется улучшенный механический слон.', MECH_RULE],
    normal(c) {
      const n = c.acts.length; c.slide(FC.DIAG, 3, { capture: !!c.p.armed }); if (c.p.armed) selfDestructAfterCapture(c, n);
      mergeOnLines(c, FC.DIAG, 3);
    }
  });

  // механизм-«скользящий» может встать на клетку Королевского механизма в пределах своей дальности
  function mergeOnLines(c, dirs, max) {
    for (const [dx, dy] of dirs) for (let k = 1; k <= max; k++) {
      const tx = c.x + dx * k, ty = c.y + dy * k;
      if (!c.G.inB(tx, ty)) break;
      if (!c.G.at(tx, ty)) continue;
      addRoyalMerge(c, tx, ty); break;
    }
  }
  const MERGE_RULE = 'Может встать на клетку своего Королевского механизма (или Королевский механизм — на его клетку): оба исчезают, появляется улучшенный механизм.';

  /* ---------- ладьи ---------- */
  FC.definePiece('dw_rook', {
    name: 'Дварф-ладья', faction: 'dwarves', cls: 'rook', abbr: 'Лд',
    rules: ['Ходит как ладья.', '2-е нажатие — создаёт механическую ладью на свободной соседней клетке по горизонтали или вертикали. Одновременно — одна; повторный призыв разбирает старую.',
      'Связь: если Дварф-ладья перемещается, её механическая ладья обязана переместиться в тот же ход (легальным ходом). Если механизм не может сходить — ладья не может переместиться. Нет механизма — ограничения нет. Механизм может ходить сам, без ладьи.'],
    normal(c) {
      c.slide(FC.ORTH);
      // ход ладьи возможен, только если после него её механизм может легально сходить; механизм ходит сразу следом
      linkFollow(c, mechsOf(c.G, c.p.id).find(o => o.p.type === 'up_mech_rook' || (o.p.type === 'mech_rook' && !o.p.armed)));
    },
    special(c) {
      const p = c.p, had = mechsOf(c.G, p.id, 'mech_rook').length;
      if (mechsOf(c.G, p.id, 'up_mech_rook').length) { c.warn('Пока жива улучшенная механическая ладья, новую создать нельзя.'); return; }
      for (const [dx, dy] of ADJ_ORTH) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.empty(tx, ty)) continue;
        c.add('summon', tx, ty, had ? 'Создать механическую ладью (старая будет разобрана)' : 'Создать механическую ладью', g => {
          removeOld(g, p.id, 'mech_rook');
          spawnMech(g, 'mech_rook', p.owner, tx, ty, { maker: p.id });
        });
      }
      if (!c.acts.length) c.note('Нет свободных соседних клеток по горизонтали и вертикали.');
    }
  });

  FC.definePiece('mech_rook', {
    name: 'Механическая ладья', faction: 'dwarves', cls: 'rook', abbr: 'МЛ', mech: true, value: 2, glyph: '⚙',
    rules: ['По горизонтали и вертикали не дальше 3 клеток, не перепрыгивает фигуры.',
      'Созданная Дварф-ладьёй: не берёт фигуры, служит препятствием (её можно уничтожить); обязана сходить, когда ходит её Дварф-ладья.',
      'Созданная Дварф-ферзём: берёт фигуры и после взятия уничтожается.', 'Может встать на клетку своего Королевского механизма (или он — на её клетку): обе исчезают, появляется улучшенная механическая ладья.', MECH_RULE],
    normal(c) {
      const n = c.acts.length; c.slide(FC.ORTH, 3, { capture: !!c.p.armed }); if (c.p.armed) selfDestructAfterCapture(c, n);
      mergeOnLines(c, FC.ORTH, 3);
    }
  });

  /* ---------- ферзь ---------- */
  FC.definePiece('dw_queen', {
    name: 'Дварф-ферзь', faction: 'dwarves', cls: 'queen', abbr: 'Фд',
    rules: ['Ходит как ферзь.', '2-е нажатие — создаёт на выбор механического слона или механическую ладью на любой свободной клетке рядом с собой.',
      'Одновременно управляет не больше чем тремя механизмами; новые не убирают старые, пока лимит не превышен.',
      'Её механизмы ходят сами (не дальше 3 клеток), берут фигуры и после взятия уничтожаются.'],
    normal(c) { c.slide(FC.ALL8); },
    special(c) {
      const p = c.p, n = mechsOf(c.G, p.id).length;
      if (n >= 3) { c.warn('Дварф-ферзь уже управляет тремя механизмами — больше нельзя.'); return; }
      // на любой свободной клетке рядом с собой (8 соседних клеток)
      for (const [dx, dy] of FC.ALL8) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.empty(tx, ty)) continue;
        for (const t of ['mech_bishop', 'mech_rook'])
          c.add('summon', tx, ty, `Создать: ${FC.PIECES[t].name} (${n + 1}/3)`, g => spawnMech(g, t, p.owner, tx, ty, { maker: p.id, armed: true }));
      }
      if (!c.acts.length) c.note('Вокруг Дварф-ферзя нет свободных клеток.');
    }
  });

  /* ---------- кони ---------- */
  FC.definePiece('boar', {
    name: 'Дварф на кабане', faction: 'dwarves', cls: 'knight', abbr: 'Дк',
    rules: ['Ходит конём (2+1).', 'Перепрыгнуть может только одну фигуру на 1-й или 2-й клетке по длинной стороне хода (по горизонтали или вертикали). Если там две фигуры подряд — прыжок в эту сторону невозможен (союзные и вражеские — одинаково).',
      '2-е нажатие — создаёт механического коня на свободной соседней клетке. Одновременно — один, за партию — не больше двух.',
      'При каждом ходе Дварфа на кабане его улучшенный механический конь обязан тоже сходить.'],
    normal(c) {
      for (const [dx, dy] of FC.KNIGHT) {
        const ux = Math.abs(dx) === 2 ? Math.sign(dx) : 0, uy = Math.abs(dy) === 2 ? Math.sign(dy) : 0;
        const a1 = c.G.at(c.x + ux, c.y + uy), a2 = c.G.at(c.x + 2 * ux, c.y + 2 * uy);
        if (a1 && a2) { c.block(c.x + 2 * ux, c.y + 2 * uy); continue; }
        c.leap([[dx, dy]]);
      }
      linkFollow(c, mechsOf(c.G, c.p.id, 'up_mech_knight')[0]);
    },
    special(c) {
      const p = c.p, made = p.made || 0;
      if (mechsOf(c.G, p.id).length) { c.warn('Механический конь этого Дварфа ещё на доске.'); return; }
      if (made >= 2) { c.warn('Этот Дварф уже создал двух механических коней за партию.'); return; }
      for (const [dx, dy] of FC.ALL8) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.empty(tx, ty)) continue;
        c.add('summon', tx, ty, `Создать механического коня (${made + 1}/2 за партию)`, g => {
          spawnMech(g, 'mech_knight', p.owner, tx, ty, { maker: p.id });
          p.made = made + 1;
        });
      }
      if (!c.acts.length) c.note('Нет свободных соседних клеток.');
    }
  });

  FC.definePiece('mech_knight', {
    name: 'Механический конь', faction: 'dwarves', cls: 'knight', abbr: 'МК', mech: true, value: 2.5, glyph: '⚙',
    rules: ['Ходит как конь, перепрыгивает любые фигуры, берёт обычным образом.', MERGE_RULE, MECH_RULE],
    normal(c) { c.leap(FC.KNIGHT); for (const [dx, dy] of FC.KNIGHT) addRoyalMerge(c, c.x + dx, c.y + dy); }
  });

  /* ---------- улучшенные механизмы (Королевский механизм + механизм) ---------- */
  const UP_RULE = 'Остаётся под контролем своего призывателя: пока он жив, призыватель не может создать новый механизм, а при каждом ходе призывателя улучшенный механизм обязан тоже сходить. После взятия не уничтожается.';
  FC.definePiece('up_mech_rook', {
    name: 'Улучшенная механическая ладья', faction: 'dwarves', cls: 'rook', abbr: 'УЛ', mech: true, value: 5, glyph: '⚙',
    rules: ['Ходит на любое число клеток по горизонтали и вертикали, не перепрыгивая фигуры, и берёт фигуры.', UP_RULE, MECH_RULE],
    normal(c) { c.slide(FC.ORTH); }
  });
  FC.definePiece('up_mech_bishop', {
    name: 'Улучшенный механический слон', faction: 'dwarves', cls: 'bishop', abbr: 'УС', mech: true, value: 3.5, glyph: '⚙',
    rules: ['Ходит на любое число клеток по диагонали, не перепрыгивая фигуры, и берёт фигуры.', UP_RULE, MECH_RULE],
    normal(c) { c.slide(FC.DIAG); }
  });
  FC.definePiece('up_mech_knight', {
    name: 'Улучшенный механический конь', faction: 'dwarves', cls: 'knight', abbr: 'УК', mech: true, value: 3.5, glyph: '⚙',
    rules: ['Ходит «буквой Г» 3+1: на 3 клетки по вертикали или горизонтали и на 1 вбок; перепрыгивает фигуры и берёт.', UP_RULE, MECH_RULE],
    normal(c) { c.leap(FC.KNIGHT31); }
  });

  /* ---------- король и Королевский механизм ---------- */
  FC.definePiece('dw_king', {
    name: 'Король дварфов', faction: 'dwarves', cls: 'king', abbr: 'Кд', royal: true,
    rules: ['На 1 клетку в любую сторону или на 2 по вертикали/горизонтали (не перепрыгивая фигуры).', 'Лидер: нельзя ходить под шах; мат — поражение.',
      '2-е нажатие — создаёт Королевский механизм на свободной соседней клетке. Сколько угодно раз за партию, но пока на доске есть Королевский механизм — новый создать нельзя.'],
    normal(c) {
      c.leap(FC.ALL8);
      for (const [dx, dy] of FC.ORTH) {
        if (!c.empty(c.x + dx, c.y + dy)) continue;
        const tx = c.x + 2 * dx, ty = c.y + 2 * dy;
        if (c.empty(tx, ty) || c.cap(tx, ty)) c.melee(tx, ty);
      }
    },
    special(c) {
      const p = c.p;
      if (c.G.pieces(p.owner).some(o => o.p.type === 'royal_mech')) { c.warn('Королевский механизм уже на доске — второй создать нельзя.'); return; }
      for (const [dx, dy] of FC.ALL8) {
        const tx = c.x + dx, ty = c.y + dy;
        if (!c.empty(tx, ty)) continue;
        c.add('summon', tx, ty, 'Создать Королевский механизм', g => spawnMech(g, 'royal_mech', p.owner, tx, ty, { maker: p.id }));
      }
      if (!c.acts.length) c.note('Нет свободных соседних клеток.');
    }
  });

  FC.definePiece('royal_mech', {
    name: 'Королевский механизм', faction: 'dwarves', cls: 'rook', abbr: 'КМ', mech: true, value: 2, glyph: '✪',
    rules: ['Ходит на 1 клетку в любую сторону (на свободную клетку).',
      'Может встать на клетку соседнего своего механизма (или механизм — на его клетку): оба исчезают, а на этой клетке появляется улучшенный механизм — механическая ладья → улучшенная ладья (любое число клеток по прямой, берёт), механический слон → улучшенный слон (любое число клеток по диагонали, берёт), механический конь → улучшенный конь (ход 3+1, берёт).',
      '2-е нажатие — если рядом стоит механический ферзь, объединяется с ним в Великий механизм. На следующем своём ходу Дварфы автоматически побеждают.',
      'Когда Королевского механизма нет на доске, Король дварфов может создать новый.', MECH_RULE],
    normal(c) { c.leap(FC.ALL8, { capture: false }); for (const [dx, dy] of FC.ALL8) addRoyalMerge(c, c.x + dx, c.y + dy); },
    special(c) {
      const p = c.p, fx = c.x, fy = c.y;
      for (const [dx, dy] of FC.ALL8) {
        const tx = fx + dx, ty = fy + dy, q = c.G.at(tx, ty);
        if (!q || q.owner !== c.side || q.type !== 'mech_queen') continue;
        c.add('special', tx, ty, 'Объединиться с механическим ферзём в Великий механизм', g => {
          g.board[fy][fx] = null; g.board[ty][tx] = null;
          g.spawn('great_mech', p.owner, tx, ty, { moved: true, born: g.turnNo });
          g.log(`Королевский механизм и механический ферзь объединяются в Великий механизм на ${FC.sq(tx, ty)}! Если он доживёт до следующего хода Дварфов — они победят.`);
        });
      }
      if (!c.acts.length) c.note('Рядом нет механического ферзя.');
    }
  });

  FC.definePiece('great_mech', {
    name: 'Великий механизм', faction: 'dwarves', cls: 'queen', abbr: 'ВМ', mech: true, value: 9, glyph: '❂',
    rules: ['Создаётся объединением Королевского механизма с механическим ферзём.', 'Если он на доске в начале следующего хода Дварфов — Дварфы автоматически побеждают.', 'Не ходит. Его можно уничтожить.'],
    normal() { }
  });
})((typeof window !== 'undefined' ? window : globalThis).FC);
