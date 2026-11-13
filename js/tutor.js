'use strict';
/* FRACTION CHESS — обучающий бот.
   От лица ферзя бота (или фигуры, которая заменяет ферзя во фракции: Вождь орды, Король демонов, Лич)
   объясняет: как ходит фигура, что произошло этим ходом, какие комбинации использованы и зачем. */
(function (FC) {
  const V = (G, q) => { const d = G.def(q); return d.royal ? 100 : FC.VALUE[d.cls]; };
  const nm = t => FC.PIECES[t].name;
  const short = s => (s || '').replace(/\s+/g, ' ').trim();
  // разные формулировки, чтобы похожие ходы не объяснялись одними и теми же словами
  const pick = (G, arr) => arr[Math.floor(G.turnNo / 2) % arr.length];
  // во что превращается пешка: одна фигура или выбор из нескольких
  const promoName = pr => Array.isArray(pr) ? 'на выбор: ' + pr.map(t => `«${nm(t)}»`).join(', ') : `«${nm(pr)}»`;

  // фигура-рассказчик: ферзь фракции (класс queen в начальной расстановке)
  function narratorType(G, owner) {
    const F = G.faction(owner);
    return F.back.find(t => FC.PIECES[t].cls === 'queen') || F.back.find(t => FC.PIECES[t].royal);
  }
  function speaker(G, owner) {
    const t = narratorType(G, owner), alive = G.pieces(owner).some(o => o.p.type === t);
    return { type: t, name: nm(t), color: G.faction(owner).color, alive, glyph: FC.GLYPH[FC.PIECES[t].cls] };
  }

  // какие вражеские фигуры бьёт фигура pid (по всем её действиям, включая особые)
  function targetsOf(G, pid) {
    const f = G.find(pid); if (!f) return [];
    const out = new Map();
    for (const m of ['normal', 'special']) {
      let acts = [];
      try { acts = G.actionsFor(f.x, f.y, m, { threat: true }).acts; } catch (e) { }
      for (const a of acts) for (const [hx, hy] of (a.hits || [[a.x, a.y]])) {
        const q = G.at(hx, hy);
        if (q && q.owner !== f.p.owner && !out.has(q.id)) out.set(q.id, { p: q, x: hx, y: hy });
      }
    }
    return [...out.values()];
  }

  // смоделировать действие и собрать всё, что изменилось
  function simulate(G, owner, a) {
    const opp = 1 - owner;
    const mover = G.at(a.from[0], a.from[1]);
    const before = new Map(G.allPieces().map(o => [o.p.id, { p: o.p, type: o.p.type, owner: o.p.owner, x: o.x, y: o.y }]));
    const T0opp = G.threatSquares(opp);
    const wasAttacked = T0opp.has(a.from[0] + ',' + a.from[1]);
    const oldTargets = new Set(targetsOf(G, mover.id).map(t => t.p.id));
    const logsBefore = G.logs.length;
    const snap = G.snapshot();
    let r;
    try {
      a.apply(G);
      const after = new Map(G.allPieces().map(o => [o.p.id, { p: o.p, type: o.p.type, owner: o.p.owner, x: o.x, y: o.y }]));
      const lost = [...before.values()].filter(b => !after.has(b.p.id));
      const born = [...after.values()].filter(b => !before.has(b.p.id));
      const changed = [...after.values()].filter(b => before.has(b.p.id) && before.get(b.p.id).type !== b.type);
      const mf = G.find(mover.id);
      const Topp = G.threatSquares(opp);
      const newTargets = mf ? targetsOf(G, mover.id).filter(t => !oldTargets.has(t.p.id)) : [];
      // какие фигуры игрока-соперника теперь под ударом бота
      const Town = G.threatSquares(owner);
      const oppHanging = G.pieces(opp).filter(o => Town.has(o.x + ',' + o.y) && !G.def(o.p).royal)
        .sort((u, v) => V(G, v.p) - V(G, u.p));
      r = {
        mover, md: G.def(mover), lost, born, changed, mf,
        moverAttacked: !!(mf && Topp.has(mf.x + ',' + mf.y)), wasAttacked,
        newTargets, oppHanging,
        check: G.winner == null && G.leaderThreatened(opp),
        win: G.winner === owner,
        mate: false,
        logs: G.logs.slice(logsBefore).map(l => l.replace(/^\[\d+\]\s*/, '')),
        pending: G.queue.length > 0
      };
      if (G.winner == null && G.queue.length === 0 && !FC.AI.hasAnyMove(G, opp)) { if (r.check) r.mate = true; else r.stalemate = true; }
    } finally { G.restore(snap); }
    return r;
  }

  const seenRules = new Set();
  let ptsHint = true;
  function howItMoves(type, force) {
    const d = FC.PIECES[type];
    if (!force && seenRules.has(type)) return '';
    seenRules.add(type);
    return `<div class="tt-how">📐 <b>Как ходит ${d.name}:</b> ${short(d.rules[0])}${d.rules[1] ? ' ' + short(d.rules[1]) : ''}</div>`;
  }
  const list = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' и ' + arr[arr.length - 1];
  const who = (G, b) => `«${nm(b.type)}» на ${FC.sq(b.x, b.y)}`;

  /* Объяснение хода бота (до того, как он сделан) */
  function explainBot(G, owner, a) {
    const s = simulate(G, owner, a), opp = 1 - owner;
    const d = s.md, why = [], combo = [];
    const enemyLost = s.lost.filter(b => b.owner === opp), ownLost = s.lost.filter(b => b.owner === owner);
    const from = FC.sq(a.from[0], a.from[1]);
    let what;
    if (a.kind === 'ranged') what = `«${d.name}» с ${from} бьёт издалека по ${FC.sq(a.x, a.y)}, не сходя с места.`;
    else if (a.kind === 'summon' && a.revive) what = `«${d.name}» приносит жертву на ${FC.sq(a.x, a.y)}, чтобы вернуть Короля демонов.`;
    else if (a.kind === 'summon') what = `«${d.name}» призывает новую фигуру на ${FC.sq(a.x, a.y)}.`;
    else if (a.kind === 'revive') what = `«${d.name}» воскрешает павшую фигуру на ${FC.sq(a.x, a.y)}.`;
    else if (a.kind === 'convert') what = `«${d.name}» обращает твою фигуру на ${FC.sq(a.x, a.y)} в Нежить.`;
    else if (s.mf) what = `«${d.name}»: ${from} → ${FC.sq(s.mf.x, s.mf.y)}${a.label && !/^(Перемещение|Взятие)$/.test(a.label) ? ` (${a.label.toLowerCase()})` : ''}.`;
    else what = `«${d.name}» с ${from}: ${(a.label || '').toLowerCase()}.`;

    // зачем
    if (s.win || s.mate) why.push('<b>Это победа!</b> ' + (s.mate ? 'Мат: твоему лидеру некуда уйти.' : 'Твой лидер уничтожен.'));
    if (s.stalemate) why.push('<b>Это победа!</b> Пат: у тебя не остаётся ни одного допустимого хода, а по нашим правилам пат — поражение того, кому некуда ходить.');
    if (enemyLost.length) {
      const pts = enemyLost.reduce((t, b) => t + (FC.PIECES[b.type].royal ? 0 : FC.VALUE[FC.PIECES[b.type].cls]), 0);
      why.push(`Забираю твою фигуру ${list(enemyLost.map(b => who(G, b)))} — это ${pts} оч. материала${ptsHint ? ' (пешка = 1, конь и слон = 3, ладья = 5, ферзь = 9)' : ''}.`);
      ptsHint = false;
      if (enemyLost.length >= 2) combo.push('<b>Двойное взятие</b>: две фигуры одним ходом — они стояли на одной линии.');
    }
    if (ownLost.length && a.kind !== 'summon') why.push(`Жертвую своей фигурой (${list(ownLost.map(b => who(G, b)))}): Демонам можно брать своих — так фигура похищает чужой ход.`);
    if (a.stolen) combo.push(`<b>Похищенный ход</b>: «${d.name}» ходит как фигура, которую взял(а) раньше.`);
    if (a.borrowed) combo.push('<b>Строй</b>: фигура ходит по схеме соседней союзной фигуры.');
    if (a.kind === 'ranged') why.push('Дальняя атака хороша тем, что стрелок остаётся на месте и не подставляется. Зато следующий ход ему надо перезаряжаться.');
    if (a.kind === 'summon' && a.revive) why.push('Без Короля демонов наша армия слабеет, а без жертвы мы бы проиграли.');
    else if (a.kind === 'summon') why.push('Лишняя фигура — это и защита, и новые угрозы.');
    if (a.kind === 'revive') why.push('Возвращаю в бой фигуру из пула — бесплатное подкрепление.');
    if (a.kind === 'convert') why.push('Превращение лучше взятия: твоя фигура исчезает, а у меня появляется новая.');
    if (s.born.length && a.kind !== 'summon' && a.kind !== 'revive') why.push(`На доске появляется ${list(s.born.map(b => who(G, b)))}.`);
    if (s.changed.length) why.push(`${list(s.changed.map(b => `«${nm(b.type)}»`))} — фигура превращается в более сильную.`);
    if (s.check && !s.mate) why.push('<b>Шах!</b> Твой лидер под ударом — теперь тебе придётся защищаться, а не нападать.');
    if (s.wasAttacked && !s.moverAttacked && s.mf && !d.royal) why.push(`«${d.name}» стоял(а) под ударом — увожу фигуру в безопасное место.`);
    const tg = s.newTargets.filter(t => !G.def(t.p).royal).sort((u, v) => V(G, v.p) - V(G, u.p));
    if (tg.length >= 2) combo.push(`<b>Вилка</b>: отсюда «${d.name}» нападает сразу на ${list(tg.slice(0, 3).map(t => `«${G.def(t.p).name}» (${FC.sq(t.x, t.y)})`))} — ${tg.length === 2 ? 'обе фигуры' : 'всех'} не спасти.`);
    else if (tg.length === 1 && !enemyLost.length) why.push(`Нацеливаюсь на твою фигуру «${G.def(tg[0].p).name}» на ${FC.sq(tg[0].x, tg[0].y)}.`);
    if (s.moverAttacked && !d.royal && !s.win) {
      const got = enemyLost.reduce((t, b) => t + FC.VALUE[FC.PIECES[b.type].cls], 0), mv = FC.VALUE[d.cls];
      why.push(!enemyLost.length ? 'Рискую: здесь фигуру могут взять — посмотрим, заметишь ли.'
        : got > mv ? 'Мою фигуру могут взять в ответ, но я уже забрал больше — размен в мою пользу.'
        : got === mv ? 'Мою фигуру могут взять в ответ — это равный размен.' : 'Мою фигуру могут взять в ответ — размен невыгодный, но так я ослабляю твою защиту.');
    }
    if (d.cls === 'pawn' && a.kind === 'move' && s.mf) {
      const rank = owner === 0 ? s.mf.y : 7 - s.mf.y, file = s.mf.x, dbl = Math.abs(s.mf.y - a.from[1]) === 2;
      if (rank >= 5 && d.promote) why.push(`Пешка почти у края: ещё ${7 - rank} ход(а) — и она станет ${promoName(d.promote)}.`);
      else if (file >= 2 && file <= 5) why.push(dbl ? 'Двойной ход центральной пешкой: занимаю центр, а фигурам позади открываю дорогу.' : pick(G, [
        'Укрепляю центр пешкой: она прикрывает соседние клетки и мешает твоим фигурам.',
        'Ещё шаг пешкой в центре — отбираю у твоих фигур удобные клетки.',
        'Пешка идёт вперёд и освобождает линию для фигур, стоящих позади.',
        'Двигаю пешку: чем дальше она продвинется, тем ближе к превращению.']));
      else why.push(dbl ? 'Двойной ход крайней пешкой: забираю пространство на фланге.' : pick(G, [
        'Пешка на фланге делает шаг: освобождаю место и готовлю атаку сбоку.',
        'Крайняя пешка идёт вперёд — она не мешает фигурам и потихоньку пробирается к краю доски.',
        'Шаг пешкой сбоку: готовлю прорыв на фланге, пока ты занят центром.']));
    }
    if (!why.length && !combo.length) {
      const cx = s.mf ? Math.abs(3.5 - s.mf.x) + Math.abs(3.5 - s.mf.y) : 9, fx = Math.abs(3.5 - a.from[0]) + Math.abs(3.5 - a.from[1]);
      why.push(cx < fx ? pick(G, ['Вывожу фигуру ближе к центру: оттуда она контролирует больше клеток.',
        'Фигура в центре сильнее, чем на краю: отсюда она дотягивается до обеих сторон доски.',
        'Развиваю фигуру: в начале партии важно быстро вывести всех в бой.'])
        : pick(G, ['Спокойный ход: перестраиваю фигуры и жду твоей ошибки.',
          'Переставляю фигуру на более удобное место — готовлю следующую атаку.',
          'Пока прямых целей нет, улучшаю расстановку.']));
    }
    if (a.kind === 'ranged' && !why.some(w => w.startsWith('Забираю'))) { /* уже объяснено */ }

    // подсказка игроку
    let tip = '';
    if (s.check && !s.mate) tip = 'Совет: уведи лидера, закройся другой фигурой или уничтожь ту, что атакует.';
    else if (s.oppHanging.length) {
      const h = s.oppHanging[0];
      tip = `Совет: твоя фигура «${G.def(h.p).name}» на ${FC.sq(h.x, h.y)} под ударом — защити её или уведи.`;
    }
    const logs = s.logs.filter(l => !/Бросок/.test(l));
    return {
      speaker: speaker(G, owner),
      html: `<div class="tt-what">${what}</div>` + howItMoves(s.mover.type) +
        (combo.length ? `<div class="tt-combo">🧩 ${combo.join(' ')}</div>` : '') +
        `<div class="tt-why">💡 <b>Зачем:</b> ${why.join(' ')}</div>` +
        (tip ? `<div class="tt-tip">👉 ${tip}</div>` : '') +
        (logs.length > 1 ? `<div class="tt-log">${logs.map(l => '• ' + l).join('<br>')}</div>` : '')
    };
  }

  /* Короткий разбор хода игрока */
  function reviewPlayer(G, owner, a) {
    const s = simulate(G, owner, a), opp = 1 - owner, out = [];
    const enemyLost = s.lost.filter(b => b.owner === opp);
    if (s.win || s.mate || s.stalemate) return 'Отличный ход — это победа!' + (s.stalemate ? ' Пат: мне некуда ходить, а пат — поражение.' : '');
    if (enemyLost.length >= 2) out.push(`Сильно: ты взял сразу ${enemyLost.length} моих фигуры.`);
    else if (enemyLost.length) out.push(`Ты забрал мою фигуру «${nm(enemyLost[0].type)}».`);
    if (s.check) out.push('Шах моему лидеру — неплохо!');
    if (s.moverAttacked && !s.md.royal) {
      const v = FC.VALUE[s.md.cls];
      out.push(enemyLost.length && FC.VALUE[FC.PIECES[enemyLost[0].type].cls] >= v ? 'Я могу взять твою фигуру в ответ, но размен равный.'
        : `Осторожно: твой ${s.md.name} теперь стоит под ударом.`);
    }
    return out.join(' ');
  }

  /* Подсказка при выборе фигуры игроком */
  function pieceHint(G, x, y) {
    const p = G.at(x, y); if (!p) return '';
    const h = howItMoves(p.type);
    if (!h) return '';
    const d = G.def(p), extra = d.special ? ' Нажми на неё ещё раз — увидишь особые способности.' : '';
    return h.replace('</div>', extra + '</div>');
  }

  function intro(G, owner) {
    const sp = speaker(G, owner), F = G.faction(owner), P = G.faction(1 - owner);
    seenRules.clear(); ptsHint = true;
    return `Привет! Я ${sp.name}, играю за «${F.name}». Буду объяснять каждый свой ход: как ходит фигура, какие комбинации я использую и зачем. ` +
      `Ты играешь за «${P.name}». Нажми на свою фигуру — я расскажу, как она ходит.`;
  }

  FC.Tutor = { explainBot, reviewPlayer, pieceHint, intro, speaker };
})((typeof window !== 'undefined' ? window : globalThis).FC);
