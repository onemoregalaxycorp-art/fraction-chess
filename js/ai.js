'use strict';
/* ИИ Fraction Chess.
   1) Быстрая оценка каждого действия «на 1 ход»: материал, безопасность фигур, шах, мат и пат сопернику
      (пат — поражение того, кому некуда ходить), наступление на лидера, уход от ничьих.
   2) Поиск на 3 хода вперёд (по умолчанию): свой ход → лучший ответ соперника → свой следующий ход.
      Перебираются лучшие по быстрой оценке варианты (ширина поиска ограничена), с отсечением
      и ограничением по времени — если время кончилось, берётся лучший найденный вариант. */
(function (FC) {
  // ценность фигуры: у механизмов своя (механизм-препятствие слабее настоящего слона/ладьи)
  const pv = d => d.value != null ? d.value : FC.VALUE[d.cls];
  const val = (G, q) => { const d = G.def(q); return d.royal ? 1000 : pv(d); };
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const WIN = 100000;

  // материал стороны (без лидера); фигуры в объединении Хтони считаются все
  function material(G, owner) {
    let s = 0;
    for (const { p } of G.pieces(owner))
      for (const t of G.partsOf(p)) { const d = FC.PIECES[t]; if (!d.royal) s += pv(d); }
    return s;
  }
  const hasAnyMove = (G, owner) => G.hasAnyMove(owner);

  /* План Дварфов — Великий механизм: механическая пешка идёт к краю и становится механическим ферзём,
     Король создаёт Королевский механизм, они сходятся и объединяются. Чем ближе к цели — тем выше оценка. */
  function dwarfPlan(G, owner) {
    if (G.players[owner].faction !== 'dwarves') return 0;
    let v = 0;
    const mq = [], rm = [], um = [];
    for (const o of G.pieces(owner)) {
      const t = o.p.type;
      if (t === 'great_mech') v += 60;
      else if (t === 'mech_rook' || t === 'mech_bishop' || t === 'mech_knight') um.push(o);
      else if (t.startsWith('up_mech_')) v += 1.5;          // улучшенный механизм — цель слияния с Королевским механизмом
      else if (t === 'mech_queen') mq.push(o);
      else if (t === 'royal_mech') rm.push(o);
      else if (t === 'mech_pawn') {
        const dir = o.p.dir || G.players[owner].dir, prog = dir > 0 ? o.y : 7 - o.y;
        // новая механическая пешка у себя в лагере плану ничего не даёт — ценится только продвижение к краю
        v += Math.max(0, prog - 3) * 0.5 + (prog >= 5 ? 1.5 : 0) + (prog >= 6 ? 2.5 : 0);
      }
    }
    if (mq.length) v += 5 + (mq.length - 1);
    if (rm.length) v += mq.length ? 2 : 0.4;          // Королевский механизм ценен, когда есть механический ферзь для Великого механизма
    if (mq.length && rm.length) {
      let d = 9;
      for (const a of mq) for (const b of rm) d = Math.min(d, dist(a, b));
      v += Math.max(0, 7 - d) * 0.7;
    } else if (rm.length && um.length) {
      // без механического ферзя Королевский механизм идёт к обычному механизму, чтобы улучшить его
      let d = 9;
      for (const a of um) for (const b of rm) d = Math.min(d, dist(a, b));
      v += Math.max(0, 6 - d) * 0.15;
    }
    return v;
  }

  // применить действие и сразу разрешить отложенные выборы (призыв Импа, обязательный ход механизма…)
  function play(G, a) {
    a.apply(G);
    if (G.winner == null) G.checkEdges();          // пешка на краю любым способом превращается
    let p, g = 0;
    while (G.winner == null && (p = G.nextPending()) && g++ < 10) G.resolvePending(FC.AI.resolve(G, p));
    G.queue = [];
  }

  /* --- быстрая оценка всех действий стороны «на 1 ход» --- */
  function rank(G, owner) {
    const acts = G.allActions(owner);
    if (!acts.length) return [];
    const opp = 1 - owner;
    const T0 = G.threatSquares(opp);
    const ahead = material(G, owner) - material(G, opp);          // > 0 — мы впереди и ничья нам не нужна
    const quiet = G.quietPlies || 0;
    const L0 = G.leader(opp);
    const plan0 = dwarfPlan(G, owner), oppPlan0 = dwarfPlan(G, opp);
    const own0 = material(G, owner);
    const out = [];
    for (const a of acts) {
      let s = Math.random() * 0.4;
      const mover = G.at(a.from[0], a.from[1]), md = G.def(mover), mv = pv(md);
      if (a.kind === 'capture' || a.kind === 'ranged') {
        for (const [hx, hy] of (a.hits || [[a.x, a.y]])) {
          const q = G.at(hx, hy); if (!q) continue;
          s += q.owner === owner ? -val(G, q) * 1.5 : val(G, q) * 1.2;
        }
      }
      if (a.kind === 'convert') { const q = G.at(a.x, a.y); if (q) s += FC.VALUE[G.def(q).cls] * 1.6; }
      if (a.kind === 'summon' && a.revive) s += 50;
      if (a.kind === 'revive') s += 2.5;
      if (a.stolen) s -= 0.2;
      if (md.cls === 'pawn' && a.kind === 'move') s += 0.25;
      if (md.royal && a.kind === 'move') s -= 0.3;
      const from = { x: a.from[0], y: a.from[1] };

      // последствия хода: безопасность, шах, мат, пат, ничья
      const snap = G.snapshot();
      const pid = mover.id;
      const wasAttacked = T0.has(a.from[0] + ',' + a.from[1]);
      a.apply(G);
      if (G.winner == null) G.checkEdges();
      if (G.winner === owner) s += WIN;                             // победа прямо сейчас
      // реальная прибавка или убыль своей армии: призыв, который лишь заменяет старый механизм, ничего не даёт;
      // своя фигура, пропавшая по собственной вине (разобранный механизм, ушедшая в жертву плоть), — потеря
      const dOwn = material(G, owner) - own0;
      if (a.kind === 'summon' || a.kind === 'revive') s += dOwn * 0.3;
      // (прибавка тоже в зачёт: улучшение механизма Королевским механизмом, превращение пешки)
      else if (a.kind !== 'capture' && a.kind !== 'ranged' && a.kind !== 'convert' && !a.merge && !a.split) s += dOwn;
      // продвинуть свой план Великого механизма / сорвать план соперника-Дварфов
      if (plan0 || oppPlan0 || G.players[owner].faction === 'dwarves') s += (dwarfPlan(G, owner) - plan0) + (oppPlan0 - dwarfPlan(G, opp)) * 0.8;
      const T = G.threatSquares(opp);
      const f = G.find(pid);
      // своя фигура исчезла после собственного хода (механизм разрушился после взятия и т. п.) — это потеря
      // (дешёвый механизм, разрушившийся после взятия, — потеря меньше: его можно создать заново)
      // (но не когда фигура превратилась во что-то не хуже — слияние в улучшенный механизм)
      if (!f && mover.owner === owner && !a.merge && !a.split && G.winner !== owner && dOwn < 0) s -= mv * (md.mech ? 0.6 : 1.1);
      if (f && T.has(f.x + ',' + f.y) && !md.royal) s -= mv * 0.85;
      else if (wasAttacked && !md.royal) s += mv * 0.4;
      // другие свои фигуры под боем после хода (зевок)
      let hang = 0;
      for (const o of G.pieces(owner)) {
        if (o.p.id === pid || G.def(o.p).royal) continue;
        if (T.has(o.x + ',' + o.y)) hang = Math.max(hang, pv(G.def(o.p)));
      }
      s -= hang * 0.35;
      // без правила шаха (Демоны) лидера можно подставить — не оставлять его под ударом
      if (G.faction(owner).noCheck && G.winner == null) {
        const l = G.leader(owner);
        if (l && T.has(l.x + ',' + l.y)) s -= 900;
      }
      if (G.winner == null) {
        const check = G.leaderThreatened(opp);
        if (check) s += 1.5;
        // мат или пат в один ход: у соперника не останется ни одного допустимого хода — это победа
        if (G.queue.length === 0 && !hasAnyMove(G, opp)) s += 10000;
        // наступление: фигуры (кроме пешек и лидера) подбираются к вражескому лидеру
        const L = G.leader(opp);
        if (L && f && L0 && !md.royal && md.cls !== 'pawn') s += (dist(from, L0) - dist(f, L)) * 0.12;
        // ничья — не цель: избегаем повторения позиции, особенно когда впереди
        const t = G.turn; G.turn = opp;
        const rep = (G.reps && G.reps[G.positionKey()]) || 0;
        G.turn = t;
        if (rep >= FC.REPETITION_LIMIT - 1) s -= ahead >= 0 ? 60 : 5;
        else if (rep >= 1) s -= ahead >= 0 ? 1.5 : 0.3;
        // правило 50 ходов: чем ближе к ничьей, тем ценнее взятие или ход пешкой
        if (quiet > 40 && ahead >= 0 && (a.kind === 'capture' || a.kind === 'ranged' || md.cls === 'pawn')) s += (quiet - 40) * 0.08;
      }
      G.restore(snap);
      // выгодное взятие важнее создания механизмов и спокойных ходов
      if ((a.kind === 'capture' || a.kind === 'ranged') && s > 0.5) s += 0.8;
      out.push({ a, s });
    }
    out.sort((u, v) => v.s - u.s);
    return out;
  }

  // оценка позиции для стороны owner (листья поиска)
  function evalPos(G, owner) {
    if (G.winner === owner) return WIN;
    if (G.winner === 1 - owner) return -WIN;
    if (G.winner === -1) return -2;
    let v = material(G, owner) - material(G, 1 - owner);
    v += 0.5 * (dwarfPlan(G, owner) - dwarfPlan(G, 1 - owner));
    if (G.leaderThreatened(1 - owner)) v += 0.5;
    if (G.leaderThreatened(owner)) v -= 0.5;
    return v;
  }

  /* --- поиск на 3 полухода: мой ход → лучший ответ соперника → мой лучший ход --- */
  function search(G, owner, R) {
    const opp = 1 - owner, cfg = FC.AI;
    const deadline = now() + cfg.budgetMs;
    const cands = R.slice(0, cfg.width[0]);
    for (const r of R) if (r.s >= 5000 && !cands.includes(r)) cands.push(r);   // все выигрывающие ходы — всегда
    let best = null, bestV = -Infinity, searched = 0;
    for (const c of cands) {
      if (searched && now() > deadline) break;
      const s1 = G.snapshot();
      let v;
      try {
        play(G, c.a);
        if (G.winner != null || !hasAnyMove(G, opp)) v = G.winner === owner || G.winner == null ? WIN : evalPos(G, owner);
        else {
          // соперник отвечает лучшими по его оценке ходами; мы ищем худший для нас ответ
          const replies = rank(G, opp).slice(0, cfg.width[1]);
          v = Infinity;
          for (const r2 of replies) {
            const s2 = G.snapshot();
            let w;
            try {
              play(G, r2.a);
              if (G.winner != null) w = evalPos(G, owner);
              else {
                const R3 = rank(G, owner);
                if (!R3.length) w = -WIN;                            // нам некуда ходить — пат/мат, поражение
                else if (R3[0].s >= 5000) w = WIN - 1;               // следующим ходом ставим мат/пат или берём лидера
                else {
                  const s3 = G.snapshot();
                  try { play(G, R3[0].a); w = evalPos(G, owner) + Math.min(R3[0].s, 50) * 0.01; }
                  finally { G.restore(s3); }
                }
              }
            } finally { G.restore(s2); }
            if (w < v) v = w;
            if (v <= bestV) break;                                   // отсечение: этот ход уже не лучше найденного
            if (now() > deadline + cfg.budgetMs) break;              // жёсткий предел времени
          }
          if (v === Infinity) v = evalPos(G, owner);
        }
      } finally { G.restore(s1); }
      searched++;
      v += c.s * 0.001;                                              // при равенстве — по быстрой оценке
      if (v > bestV) { bestV = v; best = c.a; }
    }
    return best || R[0].a;
  }

  FC.AI = {
    hasAnyMove,
    depth: 3,                 // 1 — быстрая оценка на 1 ход; 3 — поиск на 3 хода вперёд
    budgetMs: 1200,           // сколько примерно можно думать над ходом
    width: [40, 6],           // сколько своих ходов и ответов соперника перебирать (своих — пока хватает времени)
    rank, dwarfPlan,
    choose(G, owner) {
      const R = rank(G, owner);
      if (!R.length) return null;
      if (FC.AI.depth < 3 || R[0].s >= WIN / 2) return R[0].a;   // мгновенная победа — без раздумий
      return search(G, owner, R);
    },
    resolve(G, pend) {
      if (pend.kind === 'options') return pend.options[0];
      return pend.cells[Math.floor(Math.random() * pend.cells.length)];
    }
  };
})((typeof window !== 'undefined' ? window : globalThis).FC);
