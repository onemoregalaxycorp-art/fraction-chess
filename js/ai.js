'use strict';
/* ИИ Fraction Chess.
   1) Быстрая оценка каждого действия «на 1 ход» (rank): материал, безопасность фигур, шах, мат и пат сопернику,
      наступление на лидера, уход от ничьих, план Великого механизма. Используется для порядка ходов и уровня «Обычная».
   2) Поиск на 3 или 5 полуходов вперёд (think): альфа-бета с итеративным углублением, таблицей позиций и досчётом
      взятий. Оценка позиции учитывает механики фракций (захваченные Хтонью фигуры, «жизни» Демонов, «Строй» Людей,
      перезарядку выстрелов, похищенные ходы, план Дварфов, подвижность — призывы и способности тоже считаются).
   Компьютер думает в отдельном потоке (js/ai-worker.js), поэтому поле не замирает. */
(function (FC) {
  // ценность фигуры: у механизмов своя (механизм-препятствие слабее настоящего слона/ладьи)
  const pv = d => d.value != null ? d.value : FC.VALUE[d.cls];
  const val = (G, q) => { const d = G.def(q); return d.royal ? 1000 : pv(d); };
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const WIN = 100000;

  // материал стороны (без лидера); фигуры в объединении Хтони считаются все.
  // Захваченные Хтонью фигуры: заражённая работает на Хтонь (но погибнет при использовании), проклятая — частично
  function material(G, owner) {
    let s = 0;
    for (const { p } of G.allPieces()) {
      let k = 0;
      if (p.infBy) k = p.infBy.side === owner ? 0.7 : 0;
      else if (p.owner === owner) k = p.mind != null && p.mind !== owner ? 0.7 : 1;
      else if (p.mind === owner) k = 0.3;
      if (!k) continue;
      for (const t of G.partsOf(p)) { const d = FC.PIECES[t]; if (!d.royal) s += pv(d) * k; }
    }
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

  /* ===================== Поиск на N полуходов вперёд =====================
     Альфа-бета (негамакс) с итеративным углублением 1…N, таблицей уже просчитанных позиций,
     «ходами-убийцами» и историей удачных ходов для порядка перебора. На последнем уровне —
     досчёт взятий (размены доигрываются до конца, чтобы не оценивать позицию посреди размена).
     Внутри поиска ходы генерируются без полной проверки легальности (это главная экономия):
     ход, после которого свой лидер под ударом, просто отбрасывается после выполнения. */
  const CENTER = (x, y) => 3.5 - Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));

  // ценность фигур, которые у этой фракции нельзя терять (у Демонов нет шаха: Призыватель и Король демонов — «жизни»)
  function royalWorth(G, owner) { return G.faction(owner).noCheck ? 7 : 0; }

  // материал + «жизни» Демонов — для быстрых отсечений
  function quickMat(G, s) {
    let w = material(G, s);
    const rw = royalWorth(G, s), F = G.faction(s);
    if (rw) for (const { p } of G.pieces(s)) if (G.def(p).royal || p.type === F.heir) w += rw;
    return w;
  }
  // фигуры Хтони со сдвигом линий: десятки вариантов «Искажения» — в оценке подвижности их не перебираем
  const SHIFTERS = new Set(['tx', 'xal']);
  // сырые (без проверки шаха) действия стороны; forEval — для подсчёта подвижности (без дорогих сдвигов линий)
  function rawActs(G, side, capsOnly, forEval) {
    const r = [];
    for (const { x, y, p } of G.acting(side))
      for (const m of ['normal', 'special']) {
        if (forEval && m === 'special' && G.partsOf(p).some(t => SHIFTERS.has(t))) { r.extra = (r.extra || 0) + 6; continue; }
        const acts = G.actionsFor(x, y, m, { side }).acts;
        for (const a of acts) if (!capsOnly || isGain(G, a)) r.push(a);
      }
    return r;
  }
  // окончание хода без дорогих проверок (мат/пат поиск находит сам — у стороны не окажется ходов)
  function endFast(G) {
    const cur = G.turn;
    for (const { p } of G.pieces(cur)) if (p.cooldown > 0) p.cooldown--;
    for (const { p } of G.allPieces()) if (p.cursedBy === cur && p.cursedTtl > 0) { p.cursedTtl--; if (!p.cursedTtl) p.cursedBy = -1; }
    G.curses = G.curses.filter(c => c.owner !== cur || --c.ttl > 0);
    G.turn = 1 - cur; G.turnNo++;
    const t = G.turn;
    if (G.winner == null && G.pieces(t).some(o => o.p.type === 'great_mech' && o.p.born < G.turnNo)) G.winner = t;
  }

  /* Оценка позиции с точки зрения стороны side. Кроме материала учитывает:
     подвижность (сколько действий доступно — в том числе призывы, выстрелы, сдвиги линий, похищенные ходы),
     продвижение пешек к превращению, центр, безопасность лидера, захваченные Хтонью фигуры,
     перезарядку дальних атак, «Строй» Людей, план Великого механизма Дварфов, «жизни» Демонов. */
  function evaluate(G, side, box) {
    if (G.winner === side) return WIN;
    if (G.winner === 1 - side) return -WIN;
    if (G.winner === -1) return 0;
    const opp = 1 - side;
    let v = 0;
    for (const s of [side, opp]) {
      const sg = s === side ? 1 : -1, F = G.faction(s), dir = G.players[s].dir;
      let w = material(G, s) + 0.5 * dwarfPlan(G, s);
      const L = G.leader(s);
      for (const { p, x, y } of G.pieces(s)) {
        if (p.infBy) continue;
        const d = G.def(p);
        if (d.royal || (F.heir && p.type === F.heir)) { w += royalWorth(G, s); continue; }
        if (d.cls === 'pawn') {
          const prog = (p.dir || dir) > 0 ? y : 7 - y;             // продвижение к краю превращения
          w += prog >= 3 ? (prog - 2) * (prog - 2) * 0.04 : 0;
        } else if (d.cls === 'knight' || d.cls === 'bishop') w += CENTER(x, y) * 0.06;
        if (p.cooldown > 0) w -= 0.15;                             // дальняя атака перезаряжается
        if (p.stolen) w += 0.25;                                   // у фигуры Демонов есть похищенный ход
        if (F.borrowMoves) {                                       // Люди: «Строй» — соседние свои фигуры дают ходы
          for (const [dx, dy] of FC.ALL8) { const n = G.at(x + dx, y + dy); if (n && n.owner === s && n.type !== p.type) w += 0.04; }
        }
      }
      // подвижность: сколько действий доступно (дешёвая оценка без проверки шаха)
      const all = rawActs(G, s, false, true);
      w += (all.length + (all.extra || 0)) * 0.025;
      if (box && s === side) box.caps = all.filter(a => isGain(G, a));
      // безопасность лидера: сколько соседних клеток бьёт соперник
      if (L && !F.noCheck) {
        const T = G.threatSquares(1 - s);
        let around = 0;
        for (const [dx, dy] of FC.ALL8) if (T.has((L.x + dx) + ',' + (L.y + dy))) around++;
        w -= around * 0.12;
        if (T.has(L.x + ',' + L.y)) w -= 0.4;
      }
      v += sg * w;
    }
    return v;
  }

  // ход внутри поиска: выполнить, разрешить отложенные выборы, проверить, не остался ли свой лидер под ударом
  function makeMove(G, a, side) {
    a.apply(G);
    if (G.winner == null) G.checkEdges();
    let p, g = 0;
    while (G.winner == null && (p = G.nextPending()) && g++ < 10) G.resolvePending(resolve(G, p));
    G.queue = [];
    if (G.winner == null && G.leaderThreatened(side)) return false;   // нелегальный ход: свой лидер под ударом
    if (G.winner == null) endFast(G);
    return true;
  }
  function isCap(a) { return a.kind === 'capture' || a.kind === 'ranged' || a.kind === 'convert'; }
  // взятие, которое бьёт фигуру соперника (у Демонов много взятий своих фигур — это не размен, а обычный ход)
  function isGain(G, a) {
    if (!isCap(a)) return false;
    const me = G.turn;
    for (const [hx, hy] of (a.hits || [[a.x, a.y]])) { const q = G.at(hx, hy); if (q && q.owner !== me && !(q.infBy && q.infBy.side === me)) return true; }
    return false;
  }
  const moveKey = a => a.kind + (a.from ? a.from.join('') : '') + '>' + a.x + a.y + '#' + (a.label || '').length + (a.dist || '') + (a.part ? 'p' : '');
  // предварительная ценность хода для порядка перебора (без выполнения)
  function orderScore(G, a, S, ply) {
    let s = 0;
    if (isCap(a)) {
      for (const [hx, hy] of (a.hits || [[a.x, a.y]])) { const q = G.at(hx, hy); if (q) s += (q.owner === G.turn ? -1 : 1) * Math.min(val(G, q), 20) * 10; }
      const m = a.from && G.at(a.from[0], a.from[1]); if (m) s += 50 - Math.min(pv(G.def(m)), 20);
      s += isGain(G, a) ? 1000 : -100;                               // взятие своей фигуры — в конец
    } else {
      if (a.kind === 'summon' || a.kind === 'revive') s += 300;
      const k = moveKey(a);
      if (S.killers[ply] && S.killers[ply].includes(k)) s += 500;
      s += Math.min(200, S.history.get(k) || 0);
      if (a.merge) s += 40;
    }
    return s;
  }
  class Timeout { }
  const SHARED = { tt: new Map(), ev: new Map() };

  function negamax(G, S, depth, alpha, beta, ply) {
    if ((++S.nodes & 127) === 0 && now() > S.deadline) throw new Timeout();
    const side = G.turn;
    if (depth <= 0) return quiesce(G, S, alpha, beta, ply, 4);
    const key = G.positionKey(), tt = S.tt.get(key);
    let ttMove = null;
    if (tt) {
      ttMove = tt.move;
      if (tt.depth >= depth) {
        if (tt.flag === 0) return tt.v;
        if (tt.flag === 1 && tt.v >= beta) return tt.v;
        if (tt.flag === 2 && tt.v <= alpha) return tt.v;
      }
    }
    // возрождение Короля демонов и другие особые случаи — через полную проверку правил
    const acts = G.players[side].reviveDue ? G.allActions(side) : rawActs(G, side);
    const sc = acts.map(a => ({ a, s: (ttMove && moveKey(a) === ttMove ? 1e6 : 0) + orderScore(G, a, S, ply) }));
    sc.sort((u, v) => v.s - u.s);
    // ширина перебора: все взятия + лучшие спокойные ходы (чем глубже, тем уже)
    // (ответы соперника — полностью: иначе можно пропустить его тихий матующий ход)
    const quietMax = ply <= 1 ? Infinity : ply === 2 ? 20 : ply === 3 ? 10 : 6;
    let quiet = 0, shifts = 0;
    const shiftMax = ply <= 1 ? 16 : ply === 2 ? 6 : 3;   // сдвиги линий Хтони: их десятки — глубже берём лучшие
    const a0 = alpha;
    let best = -Infinity, bestMove = null, legal = 0;
    for (const { a } of sc) {
      const cap = isGain(G, a);
      if (!cap && !(ttMove && moveKey(a) === ttMove)) {
        if (a.line) { if (shifts >= shiftMax && legal) continue; shifts++; }
        else { if (quiet >= quietMax && legal) continue; quiet++; }
      }
      const snap = G.snapshot();
      let v;
      try {
        if (!makeMove(G, a, side)) continue;
        legal++;
        if (G.winner != null) v = G.winner === side ? WIN - ply : G.winner === -1 ? 0 : -(WIN - ply);
        else if (legal === 1) v = -negamax(G, S, depth - 1, -beta, -alpha, ply + 1);
        else {
          // остальные ходы сначала проверяются «узким окном»; поздние спокойные — ещё и на 1 полуход мельче
          const r = cap || depth < 2 || legal <= 3 ? 0 : Math.min(depth - 1, legal > 10 && depth >= 3 ? 2 : 1);
          v = -negamax(G, S, depth - 1 - r, -alpha - 0.01, -alpha, ply + 1);
          if (v > alpha && r) v = -negamax(G, S, depth - 1, -alpha - 0.01, -alpha, ply + 1);
          if (v > alpha && v < beta) v = -negamax(G, S, depth - 1, -beta, -alpha, ply + 1);
        }
      } finally { G.restore(snap); }
      if (v > best) { best = v; bestMove = a; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!cap) {
          const k = moveKey(a), kl = S.killers[ply] = S.killers[ply] || [];
          if (!kl.includes(k)) { kl.unshift(k); kl.length = Math.min(kl.length, 2); }
          S.history.set(k, (S.history.get(k) || 0) + depth * depth);
        }
        break;
      }
    }
    if (!legal) return -(WIN - ply);                                // некуда ходить: мат или пат — поражение
    S.tt.set(key, { depth, v: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0, move: bestMove && moveKey(bestMove) });
    return best;
  }
  // досчёт взятий: позиция оценивается только когда размены закончились
  function quiesce(G, S, alpha, beta, ply, left) {
    if ((++S.nodes & 127) === 0 && now() > S.deadline) throw new Timeout();
    const side = G.turn;
    // шах: оценивать позицию нельзя — перебираем все защиты; если их нет, это мат
    if (left > 0 && G.leaderThreatened(side)) {
      let best = -(WIN - ply);
      for (const a of rawActs(G, side)) {
        const snap = G.snapshot();
        let v;
        try {
          if (!makeMove(G, a, side)) continue;
          if (G.winner != null) v = G.winner === side ? WIN - ply : G.winner === -1 ? 0 : -(WIN - ply);
          else v = -quiesce(G, S, -beta, -Math.max(alpha, best), ply + 1, left - 1);
        } finally { G.restore(snap); }
        if (v > best) best = v;
        if (best >= beta) return best;
      }
      return best;
    }
    const key = G.positionKey();
    // оценка позиции кэшируется; список взятий берём из той же оценки (действия годятся только для этой позиции сейчас)
    let stand = S.ev.get(key), fresh = null;
    if (stand == null) {
      // быстрая проверка по материалу: позиция и так намного лучше нужного — точная оценка не нужна
      const quick = quickMat(G, side) - quickMat(G, 1 - side);
      if (quick - 3 >= beta) return quick - 3;
      const box = {}; stand = evaluate(G, side, box); fresh = box.caps; S.ev.set(key, stand);
    }
    if (stand >= beta || left <= 0) return stand;
    if (stand > alpha) alpha = stand;
    const caps = (fresh || rawActs(G, side, true)).map(a => ({ a, s: orderScore(G, a, S, ply) })).sort((u, v) => v.s - u.s);
    for (const { a } of caps) {
      const snap = G.snapshot();
      let v;
      try {
        if (!makeMove(G, a, side)) continue;
        if (G.winner != null) v = G.winner === side ? WIN - ply : G.winner === -1 ? 0 : -(WIN - ply);
        else v = -quiesce(G, S, -beta, -alpha, ply + 1, left - 1);
      } finally { G.restore(snap); }
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  /* Корень: точный список допустимых ходов, итеративное углубление до maxDepth в пределах времени */
  function think(G, owner, maxDepth, budgetMs) {
    const R = rank(G, owner);
    if (!R.length) return null;
    if (R[0].s >= WIN / 2) return R[0].a;                         // мгновенная победа
    // таблица позиций и оценок сохраняется между ходами (позиции повторяются), пока не разрастётся
    if (SHARED.tt.size > 150000) SHARED.tt.clear();
    if (SHARED.ev.size > 100000) SHARED.ev.clear();
    // мягкий предел: новую глубину начинаем, только если не прошло budgetMs; жёсткий — вдвое больше
    const t0 = now();
    const S = { deadline: t0 + budgetMs * 2, nodes: 0, tt: SHARED.tt, ev: SHARED.ev, killers: [], history: new Map() };
    const s0 = G.snapshot(), turn0 = G.turn;
    const order = R.map(r => ({ a: r.a, s: r.s, v: -Infinity }));
    let best = order[0].a, done = 0;
    const ahead = material(G, owner) - material(G, 1 - owner);
    try {
      G.turn = owner;
      for (let depth = 1; depth <= maxDepth; depth++) {
        if (depth > 2 && now() > t0 + budgetMs) break;
        let alpha = -Infinity, bestHere = null, i = 0;
        for (const o of order) {
          const snap = G.snapshot(), gain = isGain(G, o.a);
          let v;
          try {
            if (!makeMove(G, o.a, owner)) { o.v = -WIN * 2; continue; }
            i++;
            if (G.winner != null) v = G.winner === owner ? WIN : G.winner === -1 ? 0 : -WIN;
            else {
              const rep = (G.reps && G.reps[G.positionKey()]) || 0;
              if (i === 1) v = -negamax(G, S, depth - 1, -Infinity, Infinity, 1);
              else {
                // остальные ходы: сначала «узким окном» — может ли ход оказаться лучше найденного;
                // поздние спокойные ходы на большой глубине — сначала на полуход мельче
                const r = !gain && depth >= 4 && i > 8 ? 1 : 0;
                v = -negamax(G, S, depth - 1 - r, -alpha - 0.01, -alpha, 1);
                if (v > alpha && r) v = -negamax(G, S, depth - 1, -alpha - 0.01, -alpha, 1);
                if (v > alpha) v = -negamax(G, S, depth - 1, -Infinity, -alpha, 1);
              }
              // уход от повторения позиции, когда мы впереди
              if (rep >= FC.REPETITION_LIMIT - 1) v -= ahead >= 0 ? 50 : 0;
              else if (rep >= 1 && ahead > 0) v -= 0.5;
            }
          } finally { G.restore(snap); }
          // лучший ход — только если он действительно лучше (оценки «узким окном» — лишь верхняя граница);
          // быстрая оценка влияет только на порядок перебора на следующей глубине
          o.v = v + o.s * 0.0005;
          if (v > alpha) { alpha = v; bestHere = o.a; }
        }
        if (bestHere) { best = bestHere; done = depth; }
        order.sort((u, v) => v.v - u.v);                             // лучшие варианты — первыми на следующей глубине
        for (const o of order) o.v = -Infinity;
        if (alpha >= WIN - 50) break;                                // найден форсированный выигрыш
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;                          // время вышло — берём лучший ход последней полной глубины
    } finally { G.restore(s0); G.turn = turn0; }
    FC.AI.last = { depth: done, nodes: S.nodes };
    return best;
  }

  /* Отложенные выборы (клетка призыва Импа и т. п.): ближе к вражескому лидеру */
  function resolve(G, pend) {
    if (pend.kind === 'options') return pend.options[0];
    const L = G.leader(1 - pend.owner);
    if (!L) return pend.cells[0];
    let best = pend.cells[0], bd = 99;
    for (const c of pend.cells) { const d = dist(c, L); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /* Компьютер думает в отдельном потоке (js/ai-worker.js), чтобы 3D-поле не замирало.
     Если поток недоступен (страница открыта с диска), думает здесь же. */
  let worker = null, workerOk = true, reqId = 0;
  const waiting = new Map();
  function getWorker() {
    if (!workerOk || typeof Worker === 'undefined' || typeof location === 'undefined' || location.protocol === 'file:') return null;
    if (worker) return worker;
    try {
      worker = new Worker('js/ai-worker.js');
      worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
      worker.onerror = () => { workerOk = false; worker = null; for (const w of waiting.values()) w({ fail: true }); waiting.clear(); };
    } catch (e) { workerOk = false; worker = null; }
    return worker;
  }
  function chooseAsync(G, owner) {
    const w = getWorker();
    if (!w || G.queue.length || FC.AI.depth < 3) return Promise.resolve(FC.AI.choose(G, owner));
    const id = ++reqId, snap = G.snapshot(true);
    snap.queue = [];
    return new Promise(res => {
      waiting.set(id, r => {
        if (r.fail || r.idx == null) { res(FC.AI.choose(G, owner)); return; }
        const acts = G.allActions(owner), a = acts[r.idx];
        FC.AI.last = r.last;
        res(a && a.label === r.label ? a : FC.AI.choose(G, owner));   // позиция не совпала — думаем здесь
      });
      w.postMessage({ id, f: G.players.map(p => p.faction), snap, owner, depth: FC.AI.depth, budget: FC.AI.budgetMs });
    });
  }

  FC.AI = {
    hasAnyMove,
    depth: 5,                 // 1 — быстрая оценка на 1 ход; 3 и 5 — поиск на столько полуходов вперёд
    budgetMs: 3000,           // новую глубину начинаем не позже 3 с; жёсткий предел — 6 с на ход
    rank, dwarfPlan, evaluate, resolve, chooseAsync, think,
    choose(G, owner) {
      const R = rank(G, owner);
      if (!R.length) return null;
      if (FC.AI.depth < 3 || R[0].s >= WIN / 2) return R[0].a;
      return think(G, owner, FC.AI.depth, FC.AI.budgetMs) || R[0].a;
    }
  };
})((typeof window !== 'undefined' ? window : globalThis).FC);
