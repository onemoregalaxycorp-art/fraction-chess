'use strict';
/* FRACTION CHESS — движок правил.
   Доска: board[y][x], x=0..7 (a..h), y=0..7 (1..8). Игрок 0 (белые) внизу, движется вверх. */
(function (root) {
  const FC = root.FC = root.FC || {};
  FC.PIECES = {};
  FC.FACTIONS = {};
  FC.VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 60 };
  FC.GLYPH = { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' };
  FC.CLASS_NAME = { pawn: 'пешка', knight: 'конь', bishop: 'слон', rook: 'ладья', queen: 'ферзь', king: 'король' };
  FC.ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  FC.DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  FC.ALL8 = FC.ORTH.concat(FC.DIAG);
  FC.KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  FC.KNIGHT31 = [[1, 3], [3, 1], [-1, 3], [-3, 1], [1, -3], [3, -1], [-1, -3], [-3, -1]];
  FC.UNDEAD_MAP = { pawn: 'skeleton', knight: 'soul_eater', rook: 'death_knight', bishop: 'graveyard' };
  FC.COLOR_NAME = ['Белые', 'Чёрные'];
  FC.REPETITION_LIMIT = 3;      // на 3-е повторение позиции — ничья
  FC.QUIET_MOVES_LIMIT = 50;    // 50 ходов каждой стороны (100 полуходов) без взятий — ничья
  FC.KINDS = {
    move: 'Перемещение', capture: 'Ближнее взятие', ranged: 'Дальняя атака', summon: 'Призыв',
    revive: 'Воскрешение', convert: 'Превращение', special: 'Особый ход'
  };
  FC.sq = (x, y) => 'abcdefgh'[x] + (y + 1);
  FC.definePiece = (type, def) => { FC.PIECES[type] = Object.assign({ type, normal: null, special: null, rules: [] }, def); };
  FC.defineFaction = (id, def) => { FC.FACTIONS[id] = Object.assign({ id }, def); };

  /* Контекст генерации действий одной фигуры */
  class Ctx {
    constructor(G, p, x, y, mode, opt) {
      opt = opt || {};
      this.G = G; this.p = p; this.x = x; this.y = y; this.mode = mode;
      // side — чья сторона действует (фигурой под контролем ходит соперник); dir фигуры — для механизмов, идущих «назад»
      this.side = opt.side != null ? opt.side : p.owner;
      this.fwd = p.dir || G.players[p.owner].dir;
      // пешка под контролем соперника (заражение, контроль разума) идёт в его сторону
      if (this.side !== p.owner && !p.dir && G.def(p).cls === 'pawn') this.fwd = G.players[this.side].dir;
      this.acts = []; this.notes = []; this.obstacles = [];
      this.threat = !!opt.threat; this.stolen = !!opt.stolen;
      this.borrowed = !!opt.borrowed; this.maxRange = opt.maxRange || 0;   // заимствованный ход соседа (Люди)
    }
    rel(dx, dy) { return [this.x + dx, this.y + dy * this.fwd]; }
    add(kind, tx, ty, label, apply, extra) {
      const a = Object.assign({ kind, x: tx, y: ty, label, apply, from: [this.x, this.y], pid: this.p.id }, extra || {});
      this.acts.push(a); return a;
    }
    note(t) { if (!this.notes.includes(t)) this.notes.push(t); }
    warn(t) { this.note(t); (this.warns = this.warns || []).includes(t) || this.warns.push(t); }   // заметное предупреждение вверху экрана
    block(x, y, why) { if (this.G.inB(x, y)) this.obstacles.push([x, y]); if (why) this.note(why); }
    empty(x, y) { return this.G.empty(x, y); }
    cap(x, y) { return this.G.canCaptureAs(this.side, this.p, this.G.at(x, y)); }
    // можно ли влиться в союзника на (x, y) — механика слияния Хтони
    mergeable(x, y) { return this.G.canMerge(this.p, this.G.at(x, y), this.side); }
    melee(tx, ty, label, extra) {
      const p = this.p, fx = this.x, fy = this.y, q = this.G.at(tx, ty), occ = !!q;
      if (occ && q.owner === this.side && this.mergeable(tx, ty))
        return this.add('special', tx, ty, `Слияние с «${this.G.name(q)}»`, g => g.mergeMove(fx, fy, tx, ty), Object.assign({ merge: true }, extra || {}));
      return this.add(occ ? 'capture' : 'move', tx, ty, label || (occ ? 'Взятие' : 'Перемещение'),
        g => g.melee(p, fx, fy, tx, ty), extra);
    }
    ranged(tx, ty, label) {
      const p = this.p;
      if (p.cooldown > 0) { this.note('⏳ Перезарядка: дальняя атака недоступна в этот ход (обычное перемещение разрешено).'); return null; }
      return this.add('ranged', tx, ty, label || 'Дальняя атака (фигура остаётся на месте)', g => {
        g.capture(tx, ty, p, { ranged: true }); p.cooldown = 2;
      });
    }
    slide(dirs, max, o) {
      o = o || {}; max = Math.min(max || 8, this.maxRange || 8);
      const capture = o.capture !== false, move = o.move !== false;
      for (const [dx, dy] of dirs) {
        for (let k = 1; k <= max; k++) {
          const tx = this.x + dx * k, ty = this.y + dy * k;
          if (!this.G.inB(tx, ty)) break;
          const q = this.G.at(tx, ty);
          if (!q) { if (move) this.melee(tx, ty); continue; }
          if (q.owner === this.side && move && this.mergeable(tx, ty)) this.melee(tx, ty);
          else if (capture && this.cap(tx, ty)) this.melee(tx, ty);
          break;
        }
      }
    }
    leap(offs, o) {
      o = o || {};
      const capture = o.capture !== false, move = o.move !== false;
      for (const [dx, dy] of offs) {
        const tx = this.x + dx, ty = this.y + dy;
        if (!this.G.inB(tx, ty)) continue;
        const q = this.G.at(tx, ty);
        if (!q) { if (move) this.melee(tx, ty); }
        else if (q.owner === this.side && move && this.mergeable(tx, ty)) this.melee(tx, ty);
        else if (capture && this.cap(tx, ty)) this.melee(tx, ty);
      }
    }
    // зона выстрела: клетки, куда фигура может стрелять (показываются по 2-му нажатию, даже если там пусто)
    zone(x, y) { if (!this.threat && this.G.inB(x, y) && !(this.p.cooldown > 0)) (this.zones = this.zones || []).push([x, y]); }
    // дальняя атака с перезарядкой по произвольной клетке (если там враг)
    shoot(tx, ty, label) { this.zone(tx, ty); if (this.G.inB(tx, ty) && this.cap(tx, ty)) return this.ranged(tx, ty, label); return null; }
  }
  FC.Ctx = Ctx;

  class Game {
    constructor(f0, f1) {
      this.board = [...Array(8)].map(() => Array(8).fill(null));
      this.players = [0, 1].map(i => ({ idx: i, faction: i ? f1 : f0, dir: i ? -1 : 1, pool: [], queenCaptured: false, lichRevived: false, reviveDue: false, pawnSummons: 0 }));
      this.turn = 0; this.turnNo = 1; this.curses = []; this.queue = []; this.logs = []; this.history = []; this.future = [];
      // правила ничьей: троекратное повторение позиции и 50 ходов (каждой стороны) без взятий
      this.quietPlies = 0; this.irreversible = false; this.reps = {};
      this.winner = null; this.winReason = ''; this.nextId = 1;
      for (const i of [0, 1]) {
        const F = FC.FACTIONS[this.players[i].faction];
        const by = i ? 7 : 0, py = i ? 6 : 1;
        F.back.forEach((t, x) => this.spawn(t, i, x, by));
        for (let x = 0; x < 8; x++) this.spawn(F.pawn, i, x, py);
      }
    }
    /* --- базовые запросы --- */
    spawn(type, owner, x, y, extra) {
      const p = Object.assign({ id: this.nextId++, type, owner, moved: false, cooldown: 0, bloodlust: 0, cursedTtl: 0, cursedBy: -1, summoned: false, stolen: null }, extra || {});
      this.board[y][x] = p; return p;
    }
    inB(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8; }
    at(x, y) { return this.inB(x, y) ? this.board[y][x] : undefined; }
    empty(x, y) { return this.inB(x, y) && !this.board[y][x]; }
    def(p) { return FC.PIECES[p.type]; }
    name(p) { return this.def(p).name; }
    who(p) { return `«${this.name(p)}» ${p.owner ? 'чёрных' : 'белых'}`; }
    faction(owner) { return FC.FACTIONS[this.players[owner].faction]; }
    allPieces() { const r = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (this.board[y][x]) r.push({ p: this.board[y][x], x, y }); return r; }
    pieces(owner) { return this.allPieces().filter(o => o.p.owner === owner); }
    find(id) { return this.allPieces().find(o => o.p.id === id) || null; }
    // лидер стороны; у Демонов после гибели Призывателя лидером становится Король демонов (faction.heir)
    leader(owner) {
      const ps = this.pieces(owner), heir = this.faction(owner).heir;
      return ps.find(o => this.def(o.p).royal) || (heir && ps.find(o => o.p.type === heir)) || null;
    }
    log(m) { this.logs.push(`[${this.turnNo}] ${m}`); }
    isCursed(x, y, owner) { return this.curses.some(c => c.x === x && c.y === y && (owner == null || c.owner === owner)); }

    canCapture(p, q) { return this.canCaptureAs(p.owner, p, q); }
    // side — сторона, которая действует фигурой p (для фигур под контролем это не владелец)
    canCaptureAs(side, p, q) {
      if (!q || q === p) return false;
      // заражённая плотью фигура: Хтонь её не бьёт (это её существо), а прежний владелец — может
      if (q.infBy) return q.infBy.side !== side;
      if (q.owner !== side) return true;
      if (p.owner !== side) return false;   // фигура под контролем не бьёт фигуры контролирующей стороны
      // Взятие союзников — только у Демонов, и не своего лидера
      if (this.def(p).faction !== 'demons' || this.def(q).royal) return false;
      // последнего лидера (Короля демонов без Призывателя) свои брать не могут
      if (q.type === this.faction(q.owner).heir) { const l = this.leader(q.owner); if (l && l.p === q) return false; }
      return true;
    }

    /* --- Хтонь: слияние союзных фигур (кроме короля) --- */
    partsOf(p) { return [p.type].concat((p.parts || []).map(c => c.type)); }
    canMerge(p, q, side) {
      if (!p || !q || p === q || p.owner !== side || q.owner !== side || p.infBy || q.infBy) return false;
      if (!this.faction(side).merge) return false;
      return !this.partsOf(p).concat(this.partsOf(q)).some(t => FC.PIECES[t].royal);
    }
    // фигура (или объединение) с (fx,fy) входит на клетку союзника (tx,ty) и сливается с ним
    mergeMove(fx, fy, tx, ty) {
      const p = this.board[fy][fx], q = this.board[ty][tx];
      this.board[fy][fx] = null;
      const comps = [this.strip(p)].concat(p.parts || []);
      q.parts = (q.parts || []).concat(comps.map(c => Object.assign({}, c, { moved: true })));
      this.log(`${this.who(p)} сливается с ${this.who(q)} на ${FC.sq(tx, ty)} (в объединении: ${this.partsOf(q).length})`);
    }
    strip(p) { const c = Object.assign({}, p); delete c.parts; return c; }
    // объединение без одной составляющей (i = 0 — основа): что остаётся на клетке
    remainderOf(p, i) {
      const all = [this.strip(p)].concat(p.parts || []);
      const rest = all.filter((_, j) => j !== i);
      if (!rest.length) return null;
      const base = Object.assign({}, rest[0]);
      if (rest.length > 1) base.parts = rest.slice(1); else delete base.parts;
      return base;
    }

    /* --- контроль чужих фигур (Хтонь): заражение и контроль разума --- */
    // кто сейчас может действовать фигурой p в ход стороны turn
    actorFor(p, turn) {
      if (turn == null) turn = this.turn;
      if (p.infBy) return p.infBy.side;                          // заражённой ходит только Хтонь
      if (p.mind != null && p.mind === turn && p.owner !== turn) return turn;
      return p.owner;
    }
    canAct(p, side) { return !!p && this.actorFor(p, side) === side; }
    // фигуры, которыми сторона может действовать (свои незаражённые + чужие под её контролем)
    acting(side) {
      return this.allPieces().filter(o => o.p.owner === side ? !o.p.infBy : (o.p.infBy ? o.p.infBy.side === side : o.p.mind === side));
    }
    // для угроз: чем сторона могла бы бить (заражённые — только Хтонь, проклятые разумом — обе стороны)
    threatActors(side) {
      return this.allPieces().filter(o => o.p.owner === side ? !o.p.infBy : (o.p.infBy ? o.p.infBy.side === side : o.p.mind === side));
    }

    /* --- генерация действий --- */
    actionsFor(x, y, mode, opt) {
      const p = this.at(x, y);
      opt = Object.assign({}, opt || {});
      if (opt.side == null) opt.side = this.actorFor(p);
      const c = new Ctx(this, p, x, y, mode, opt);
      const d = this.def(p);
      const comps = this.partsOf(p);
      if (mode === 'normal') {
        // объединение ходит по схемам всех составляющих
        for (const t of comps) { const pd = FC.PIECES[t]; if (pd.normal) { c.compType = t; pd.normal(c); } }
        c.compType = null;
        if (comps.length > 1) {
          const seen = new Set();
          c.acts = c.acts.filter(a => { const k = a.kind + '@' + a.x + ',' + a.y; if (seen.has(k)) return false; seen.add(k); return true; });
        }
      }
      else {
        for (const t of comps) { const pd = FC.PIECES[t]; if (pd.special) { c.compType = t; pd.special(c); } }
        c.compType = null;
        if (comps.length > 1) this.separationActs(c, p, x, y, opt);
        const pl = this.players[p.owner], owner = p.owner;
        // Возрождение Короля демонов: Призыватель приносит жертву (занимает ход)
        if (pl.reviveDue && d.royal) {
          for (const [dx, dy] of FC.ALL8) {
            const ax = x + dx, ay = y + dy, q = this.at(ax, ay);
            if (q && q.owner === owner && !this.def(q).royal)
              c.add('summon', ax, ay, `Жертвоприношение «${this.name(q)}»: возродить Короля демонов на этой клетке`, g => {
                const sac = g.at(ax, ay); g.board[ay][ax] = null;
                g.log(`${g.who(sac)} принесён в жертву`);
                g.spawn('demon_king', owner, ax, ay, { moved: true });
                g.players[owner].reviveDue = false;
                g.log(`Король демонов возрождён на ${FC.sq(ax, ay)}`);
              }, { revive: true });
          }
        }
        // Люди («Строй»): фигура с canBorrow ходит по схеме соседней союзной фигуры, не дальше 2 клеток
        const F = this.faction(owner);
        if (F.borrowMoves && d.canBorrow) {
          const own = new Set(this.actionsFor(x, y, 'normal', opt).acts.map(a => a.kind + '@' + a.x + ',' + a.y));
          const seen = new Set(), seenTypes = new Set([p.type]);
          for (const [dx, dy] of FC.ALL8) {
            const n = this.at(x + dx, y + dy);
            if (!n || n.owner !== owner || seenTypes.has(n.type)) continue;
            seenTypes.add(n.type);
            const nd = this.def(n);
            if (!nd.normal) continue;
            const R = F.borrowRange || 2, fwd = this.players[owner].dir;
            const c2 = new Ctx(this, p, x, y, 'normal', Object.assign({}, opt, { borrowed: true, maxRange: R }));
            nd.normal(c2);
            for (const a of c2.acts) {
              if ((a.y - y) * fwd < 0) continue;                                       // назад заимствованным ходом нельзя
              if (Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) > R) continue;       // не дальше 2 клеток
              const key = a.kind + '@' + a.x + ',' + a.y;
              if (own.has(key) || seen.has(key)) continue;   // такой ход у фигуры уже есть
              seen.add(key);
              a.borrowed = true;
              a.label = `Ход как «${nd.name}» (соседняя фигура): ${a.label}`;
              c.acts.push(a);
            }
          }
        }
        // Похищенный ход — у каждой фигуры Демонов свой
        if (this.faction(owner).stealsMoves && p.stolen) {
          const sd = FC.PIECES[p.stolen];
          const c2 = new Ctx(this, p, x, y, 'normal', Object.assign({}, opt, { stolen: true }));
          if (sd.normal) sd.normal(c2);
          for (const a of c2.acts) {
            const ap = a.apply;
            a.stolen = true;
            a.label = `Похищенный ход «${sd.name}»: ${a.label}`;
            a.apply = g => { p.stolen = null; g.log(`${g.who(p)} использует похищенный ход «${sd.name}»`); ap(g); };
            c.acts.push(a);
          }
          c.obstacles.push(...c2.obstacles);
          if (!c2.acts.length) c.note(`Похищенный ход «${sd.name}» сейчас некуда применить.`);
        }
      }
      if (c.side !== p.owner) this.wrapControlled(c, p, x, y);
      return c;
    }
    // разделение объединения: одна составляющая уходит своим ходом (может сразу влиться в другого союзника)
    separationActs(c, p, x, y, opt) {
      const all = [this.strip(p)].concat(p.parts || []);
      all.forEach((comp, i) => {
        const cd = FC.PIECES[comp.type];
        if (!cd.normal) return;
        const probe = Object.assign({}, comp);
        const c2 = new Ctx(this, probe, x, y, 'normal', Object.assign({}, opt, { side: c.side }));
        cd.normal(c2);
        for (const a of c2.acts) {
          const ap = a.apply;
          a.label = `Отделить «${cd.name}»: ${a.label}`;
          a.split = true;
          a.apply = g => {
            const stack = g.board[y][x];
            const leaving = Object.assign({}, comp, { moved: true });
            const rest = g.remainderOf(stack, i);                   // основа ушла — на клетке остаётся следующая составляющая
            g.board[y][x] = leaving;
            g.log(`«${cd.name}» отделяется от объединения на ${FC.sq(x, y)}`);
            ap(g);
            if (g.board[y][x] === leaving) return;                  // не ушла (не должно случаться)
            g.board[y][x] = rest;
          };
          c.acts.push(a);
        }
      });
    }
    // действие фигурой под контролем: после него заражённая фигура гибнет (на её месте — Ползучая плоть),
    // проклятие контроля разума спадает
    wrapControlled(c, p, x, y) {
      const side = c.side;
      // заражённая фигура не берёт: «своим взятием» она заражает следующую фигуру, а сама погибает
      if (p.infBy && p.infBy.side === side) {
        const flesh = p.infBy.flesh, out = [], seen = new Set();
        for (const a of c.acts) {
          if (a.kind !== 'capture' && a.kind !== 'ranged') { out.push(a); continue; }
          const [hx, hy] = (a.hits || [[a.x, a.y]])[0], q = this.at(hx, hy);
          if (!q || q.owner === side || q.infBy || seen.has(hx + ',' + hy)) continue;
          const L = this.leader(q.owner);
          if (this.partsOf(q).some(t => FC.PIECES[t].royal) || (L && L.p === q)) continue;   // короля заражать нельзя
          seen.add(hx + ',' + hy);
          out.push({
            kind: 'convert', x: hx, y: hy, from: [x, y], pid: p.id, controlled: true, infectChain: true,
            label: `[заражение] Заразить «${this.name(q)}» плотью — заражённая фигура погибнет`,
            apply: g => {
              const at = g.find(p.id);
              q.infBy = { side, flesh }; q.mind = null;
              g.log(`Заражённая фигура ${g.who(p)} передаёт заразу: ${g.who(q)} теперь заражён(а)`);
              if (at) { g.board[at.y][at.x] = null; g.log(`Заражённая фигура ${g.who(p)} гибнет`); g.onRemoved(p, at.x, at.y, null, {}); }
            }
          });
        }
        c.acts = out;
      }
      for (const a of c.acts) {
        if (a.infectChain) continue;
        const ap = a.apply;
        a.controlled = true;
        a.label = `[под контролем] ${a.label}`;
        a.apply = g => {
          const q0 = g.queue.length;
          ap(g);
          if (p.mind === side) { p.mind = null; g.log(`Контроль разума над ${g.who(p)} снят`); }
          if (p.infBy && p.infBy.side === side) {
            const at = g.find(p.id);
            const moved = at && (at.x !== x || at.y !== y);
            if (at && moved) {
              g.queue.length = q0;                                  // превращение заражённой пешки не нужно — она гибнет
              g.board[at.y][at.x] = null;
              g.log(`Заражённая фигура ${g.who(p)} гибнет`);
              g.onRemoved(p, at.x, at.y, null, {});
              if (g.winner != null) return;
              g.spawn('flesh', side, at.x, at.y, { moved: true });
            } else if (at) { p.infBy = null; g.log(`Заражение ${g.who(p)} снято`); }
          }
        };
      }
    }
    /* Допустимые действия: без хода «под шах» своего лидера; при гибели Короля демонов — только жертвоприношение */
    legalActionsFor(x, y, mode, opt) {
      const c = this.actionsFor(x, y, mode, opt);
      const owner = c.side;
      let acts = c.acts;
      if (this.players[owner].reviveDue) {
        const rv = this.reviveOptions(owner);
        if (rv.legal) {
          const r = acts.filter(a => a.revive);
          if (acts.length > r.length) c.note('Король демонов пал: в этот ход Призыватель обязан принести жертву (2-е нажатие на Призывателя). Другие действия недоступны.');
          acts = r;
        } else if (rv.raw) {
          acts = acts.filter(a => !a.revive);
          c.note('Король демонов пал, но жертвоприношение сейчас оставит Призывателя под шахом — сначала уйдите от шаха.');
        } else acts = [];
      }
      let legal = acts.filter(a => this.isLegal(a, owner));
      if (legal.length < acts.length) c.note(`Недоступно действий: ${acts.length - legal.length} — после них лидер оказался бы под шахом.`);
      // действия, которыми нельзя ставить мат (Искажение пространства ТХ'Зсала)
      if (legal.some(a => a.noMate)) {
        const before = legal.length;
        legal = legal.filter(a => !a.noMate || !this.givesMate(a, owner));
        if (legal.length < before) c.note('Искажением пространства нельзя поставить мат.');
      }
      c.acts = legal;
      return c;
    }
    givesMate(a, owner) {
      const s = this.snapshot();
      try { a.apply(this); return this.winner == null && this.leaderThreatened(1 - owner) && !this.hasAnyMove(1 - owner); }
      finally { this.restore(s); }
    }
    // есть ли у стороны хоть один допустимый ход (поиск до первого найденного)
    hasAnyMove(side) {
      for (const { x, y } of this.acting(side))
        for (const m of ['normal', 'special'])
          if (this.legalActionsFor(x, y, m, { side }).acts.length) return true;
      return false;
    }
    reviveOptions(owner) {
      const l = this.leader(owner);
      if (!l) return { raw: 0, legal: 0 };
      const r = this.actionsFor(l.x, l.y, 'special').acts.filter(a => a.revive);
      return { raw: r.length, legal: r.filter(a => this.isLegal(a, owner)).length };
    }
    isLegal(a, owner) {
      const s = this.snapshot();
      let ok;
      try { a.apply(this); ok = this.winner === owner || !this.leaderThreatened(owner); }
      finally { this.restore(s); }
      return ok;
    }
    allActions(owner) {
      const r = [];
      for (const { x, y } of this.acting(owner))
        for (const m of ['normal', 'special']) r.push(...this.legalActionsFor(x, y, m, { side: owner }).acts);
      return r;
    }
    /* Снимок состояния: для проверки легальности и отмены ходов */
    snapshot(full) {
      const pieces = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = this.board[y][x]; if (p) pieces.push([x, y, p, Object.assign({}, p)]); }
      return {
        pieces, players: JSON.stringify(this.players), curses: JSON.stringify(this.curses), queue: this.queue.slice(),
        logs: full ? this.logs.slice() : this.logs.length, winner: this.winner, winReason: this.winReason, nextId: this.nextId, turn: this.turn, turnNo: this.turnNo,
        quietPlies: this.quietPlies, irreversible: this.irreversible, reps: full ? Object.assign({}, this.reps) : null
      };
    }
    restore(s) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) this.board[y][x] = null;
      for (const [x, y, p, props] of s.pieces) {
        for (const k of Object.keys(p)) if (!(k in props)) delete p[k];
        Object.assign(p, props);
        this.board[y][x] = p;
      }
      this.players = JSON.parse(s.players); this.curses = JSON.parse(s.curses); this.queue = s.queue.slice();
      if (Array.isArray(s.logs)) this.logs = s.logs.slice(); else this.logs.length = s.logs;
      this.winner = s.winner; this.winReason = s.winReason;
      this.nextId = s.nextId; this.turn = s.turn; this.turnNo = s.turnNo;
      this.quietPlies = s.quietPlies; this.irreversible = s.irreversible;
      if (s.reps) this.reps = Object.assign({}, s.reps);
    }
    /* Ключ позиции для правила повторения: чей ход + все фигуры с их состояниями */
    positionKey() {
      let k = this.turn + '|';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = this.board[y][x];
        if (p) k += `${x}${y}${p.type}${p.owner}${p.cooldown}${p.bloodlust}${p.stolen || ''}${p.cursedTtl}${p.parts ? '+' + this.partsOf(p).join('+') : ''}${p.infBy ? 'i' : ''}${p.mind != null ? 'm' + p.mind : ''};`;
      }
      return k + this.players.map(p => `${p.reviveDue ? 1 : 0}${p.pool.length}${p.pawnSummons}`).join('|') + this.curses.length;
    }
    undo() {
      const s = this.history.pop();
      if (!s) return false;
      this.future.push(this.snapshot(true));
      this.restore(s);
      return true;
    }
    redo() {
      const s = this.future.pop();
      if (!s) return false;
      this.history.push(this.snapshot(true));
      this.restore(s);
      return true;
    }
    threatSquares(owner) {
      const s = new Set();
      for (const { x, y } of this.threatActors(owner))
        for (const m of ['normal', 'special'])
          for (const a of this.actionsFor(x, y, m, { threat: true, side: owner }).acts)
            if (a.kind === 'capture' || a.kind === 'ranged')
              for (const h of (a.hits || [[a.x, a.y]])) s.add(h[0] + ',' + h[1]);
      return s;
    }
    squareAttacked(x, y, byOwner) {
      let placed = false;
      if (!this.board[y][x]) {
        const r = this.leader(1 - byOwner);
        this.board[y][x] = { id: -1, type: r ? r.p.type : 'king', owner: 1 - byOwner, moved: true, cooldown: 0, bloodlust: 0, cursedTtl: 0, cursedBy: -1 };
        placed = true;
      }
      const res = this.threatSquares(byOwner).has(x + ',' + y);
      if (placed) this.board[y][x] = null;
      return res;
    }
    leaderThreatened(owner) {
      if (this.faction(owner).noCheck) return false;   // Демоны: шаха и мата нет вообще
      const r = this.leader(owner);
      return !!r && this.threatSquares(1 - owner).has(r.x + ',' + r.y);
    }

    /* --- изменение состояния --- */
    doAction(a) {
      if (!this.queue.length) { this.history.push(this.snapshot(true)); this.future = []; }
      this.lastAction = a; a.apply(this);
      if (this.winner == null) this.checkEdges();
    }
    melee(p, fx, fy, tx, ty) {
      if (this.at(tx, ty)) this.capture(tx, ty, p, {});
      this.move(fx, fy, tx, ty);
    }
    move(fx, fy, tx, ty) {
      const p = this.board[fy][fx];
      if (!p) return;
      if (fx !== tx || fy !== ty) {
        this.board[ty][tx] = p; this.board[fy][fx] = null;
        this.log(`${this.who(p)}: ${FC.sq(fx, fy)} → ${FC.sq(tx, ty)}`);
      }
      p.moved = true;
      for (const [cx, cy] of [[fx, fy], [tx, ty]])
        for (const c of this.curses)
          if (c.x === cx && c.y === cy && c.owner !== p.owner) this.curse(p, c.owner);
      const d = this.def(p);
      // ферзь (класс queen) хоть раз ушёл со своего дальнего ряда — снимает ограничение телепортации Архимага
      const home = p.owner === 0 ? 0 : 7;
      if (d.cls === 'queen' && fy === home && ty !== home) this.players[p.owner].queenLeft = true;
      // край доски — по направлению движения фигуры (механизмы инженера идут «назад»)
      const edge = (p.dir || this.players[p.owner].dir) > 0 ? 7 : 0;
      if (d.evolveAtEdge && ty === edge && !p.evolved) { p.evolved = true; this.log(`${this.who(p)} достигает края доски и усиливается`); }
      if (d.promote && ty === edge) this.promote(p);
    }
    // превращение пешки на дальнем краю (сразу или с выбором фигуры)
    promote(p) {
      const d = this.def(p);
      if (!d.promote || p.promoPending) return;
      if (typeof d.promote === 'string') this.transform(p, d.promote);
      else {
        p.promoPending = true;
        this.queue.push({
          owner: p.owner, kind: 'options', text: `«${d.name}» достиг края доски — выберите превращение:`,
          options: d.promote.map(t => ({ label: FC.PIECES[t].name, fn: g => g.transform(p, t) }))
        });
      }
    }
    // пешка на дальнем краю доски — любым способом (ход, сдвиг линии, рокировка, притягивание…) — превращается
    checkEdges() {
      for (const { p, y } of this.allPieces()) {
        const d = this.def(p);
        if (!d.promote && !d.evolveAtEdge) continue;
        const edge = (p.dir || this.players[p.owner].dir) > 0 ? 7 : 0;
        if (y !== edge) continue;
        if (d.evolveAtEdge && !p.evolved) { p.evolved = true; this.log(`${this.who(p)} достигает края доски и усиливается`); }
        if (d.promote && !p.promoPending) this.promote(p);
      }
    }
    curse(p, owner) {
      // Проклятие держится до конца следующего хода владельца проклятия
      p.cursedBy = owner; p.cursedTtl = this.turn === owner ? 2 : 1;
    }
    addCurse(cells, owner) {
      for (const [x, y] of cells) {
        this.curses = this.curses.filter(c => !(c.x === x && c.y === y && c.owner === owner));
        this.curses.push({ x, y, owner, ttl: 2 });
        const q = this.at(x, y);
        if (q && q.owner !== owner) this.curse(q, owner);
      }
      this.log(`Проклятие на клетках: ${cells.map(c => FC.sq(c[0], c[1])).join(', ')}`);
    }
    transform(p, t) {
      this.log(`${this.who(p)} превращается в «${FC.PIECES[t].name}»`);
      p.type = t; p.cooldown = 0; p.bloodlust = 0; p.promoPending = false;
    }
    capture(tx, ty, by, opts) {
      const v = this.at(tx, ty);
      if (!v) return;
      this.board[ty][tx] = null;
      this.irreversible = true;   // взятие обнуляет счётчик «50 ходов без взятий»
      this.log(`${by ? this.who(by) : '—'} ${opts && opts.ranged ? 'поражает издалека' : 'берёт'} ${this.who(v)} на ${FC.sq(tx, ty)}`);
      this.onRemoved(v, tx, ty, by, opts || {});
    }
    onRemoved(v, x, y, by, opts) {
      // объединение (Хтонь) гибнет целиком — каждая составляющая
      if (v.parts && v.parts.length) {
        const parts = v.parts; delete v.parts;
        this.onRemoved(v, x, y, by, opts);
        for (const c of parts) if (this.winner == null) { this.log(`Вместе с объединением гибнет «${FC.PIECES[c.type].name}»`); this.onRemoved(c, x, y, by, opts); }
        v.parts = parts;
        return;
      }
      const vd = this.def(v);
      if (vd.cls === 'queen') this.players[1 - v.owner].queenCaptured = true;
      const heir = this.faction(v.owner).heir;
      // Демоны проигрывают, только когда мертвы и Призыватель, и Король демонов
      const lastLeader = vd.royal ? !this.leader(v.owner) : (heir && v.type === heir && !this.leader(v.owner));
      if (lastLeader) {
        this.winner = 1 - v.owner;
        this.winReason = heir ? `${this.who(v)} уничтожен(а) — у Демонов не осталось ни Призывателя, ни Короля демонов` : `${this.who(v)} уничтожен(а)`;
        this.log(`★ ${this.winReason}. Победа: ${FC.COLOR_NAME[this.winner]}`);
        return;
      }
      if (vd.royal) this.log(`${this.who(v)} пал, но Король демонов жив — Демоны продолжают бой. Возрождать Короля больше некому.`);
      if (by) {
        const bd = this.def(by), bp = this.players[by.owner];
        // Нежить: пул воскрешения
        // (механизмы Дварфов в пул не попадают)
        if (bd.faction === 'undead' && v.owner !== by.owner && !vd.mech) {
          const cursed = this.isCursed(x, y, by.owner) || (v.cursedTtl > 0 && v.cursedBy === by.owner);
          if (bd.poolOnCapture || cursed) {
            const t = FC.UNDEAD_MAP[vd.cls];
            if (t && vd.cls !== 'pawn') { bp.pool.push(t); this.log(`В пул воскрешения добавлен «${FC.PIECES[t].name}»`); }
          }
        }
        // Демоны: похищение хода (Страж и Пожиратель врагов не «обкрадывают») и призыв Импа
        if (bd.faction === 'demons') {
          const enemy = v.owner !== by.owner;
          if (!(bd.summonImp && enemy)) this.stealMove(by, v.type);
          // взяв вражескую фигуру любой фигурой, кроме Импа, Демоны призывают Импа у ближайшего к месту взятия Обелиска
          if (enemy && by.type !== 'imp' && this.faction(by.owner).impOnKill)
            this.queue.push(this.impSummonBuilder(by.owner, () => ({ x, y }), `«${bd.name}» взял врага — `));
        }
        // Кровожадность держится, пока её не используют (особое взятие Импа)
        if (bd.bloodlust && vd.cls === 'pawn' && !by.bloodlust) { by.bloodlust = 1; this.log(`${this.who(by)} впадает в Кровожадность`); }
      }
      if (v.type === 'demon_king' && this.leader(v.owner)) {
        this.players[v.owner].reviveDue = true;
        this.log('Король демонов пал! Своим следующим ходом Призыватель должен принести жертву.');
      }
    }
    stealMove(by, type) {
      const nm = FC.PIECES[type].name;
      if (!FC.PIECES[type].normal) return;
      if (!by.stolen) { by.stolen = type; this.log(`${this.who(by)} похищает ход фигуры «${nm}»`); return; }
      if (by.stolen === type) return;
      const old = FC.PIECES[by.stolen].name;
      this.queue.push({
        owner: by.owner, kind: 'options', text: `${this.who(by)} похитил ход «${nm}», но у него уже сохранён ход «${old}». Заменить?`,
        options: [
          { label: `Заменить на «${nm}»`, fn: g => { by.stolen = type; g.log(`${g.who(by)}: похищенный ход заменён на «${nm}»`); } },
          { label: `Оставить «${old}»`, fn: () => { } }
        ]
      });
    }
    /* Призыв Импа у ближайшего к точке pos(g) Обелиска; при равенстве — выбор игрока */
    impSummonBuilder(owner, pos, prefix) {
      return g => {
        if (g.winner != null) return null;
        const f = pos(g); if (!f) return null;
        const obs = g.pieces(owner).filter(o => o.p.type === 'obelisk');
        if (!obs.length) { g.log('Призыв Импа невозможен: нет Обелисков'); return null; }
        const d = o => Math.max(Math.abs(o.x - f.x), Math.abs(o.y - f.y));
        const m = Math.min(...obs.map(d));
        const cells = [];
        for (const o of obs.filter(o => d(o) === m))
          for (const [dx, dy] of FC.ALL8) {
            const x = o.x + dx, y = o.y + dy;
            if (g.empty(x, y) && !cells.some(c => c.x === x && c.y === y))
              cells.push({ x, y, fn: gg => { gg.spawn('imp', owner, x, y, { summoned: true, moved: true }); gg.log(`Призван Имп на ${FC.sq(x, y)}`); } });
          }
        if (!cells.length) { g.log('Призыв Импа невозможен: у ближайшего Обелиска нет свободных клеток'); return null; }
        return { owner, kind: 'cells', text: `${prefix || ''}выберите клетку рядом с Обелиском для призыва Импа`, cells };
      };
    }
    nextPending() {
      while (this.queue.length) {
        let it = this.queue[0];
        if (typeof it === 'function') {
          it = it(this);
          if (!it) { this.queue.shift(); continue; }
          this.queue[0] = it;
        }
        return it;
      }
      return null;
    }
    resolvePending(choice) { this.queue.shift(); choice.fn(this); if (this.winner == null) this.checkEdges(); }
    endTurn() {
      const cur = this.turn;
      for (const { p } of this.pieces(cur)) { if (p.cooldown > 0) p.cooldown--; }
      for (const { p } of this.allPieces()) if (p.cursedBy === cur && p.cursedTtl > 0) { p.cursedTtl--; if (!p.cursedTtl) p.cursedBy = -1; }
      this.curses = this.curses.filter(c => c.owner !== cur || --c.ttl > 0);
      this.turn = 1 - cur; this.turnNo++;
      const t = this.turn;
      // Дварфы: Великий механизм дожил до следующего хода — автоматическая победа
      if (this.winner == null && this.pieces(t).some(o => o.p.type === 'great_mech' && o.p.born < this.turnNo)) {
        this.winner = t; this.winReason = 'Великий механизм Дварфов собран и дожил до их следующего хода — автоматическая победа';
        this.log('★ ' + this.winReason);
      }
      if (this.winner == null && !this.hasAnyMove(t)) {
        if (this.players[t].reviveDue && !this.reviveOptions(t).raw) {
          this.winner = 1 - t; this.winReason = 'Король демонов пал, а рядом с Призывателем нет союзной фигуры для жертвоприношения';
        } else if (this.leaderThreatened(t)) {
          this.winner = 1 - t; this.winReason = `Мат! Лидеру «${FC.COLOR_NAME[t]}» некуда уйти от удара`;
        } else {
          // по правилам Fraction Chess пат — поражение того, кому некуда ходить
          this.winner = 1 - t; this.winReason = `Пат: у «${FC.COLOR_NAME[t]}» нет допустимых ходов — пат считается поражением`;
        }
        this.log('★ ' + this.winReason);
      }
      // правила ничьей (мат и пат важнее — проверены выше)
      if (this.irreversible) { this.quietPlies = 0; this.reps = {}; } else this.quietPlies++;
      this.irreversible = false;
      if (this.winner != null) return;
      const key = this.positionKey();
      this.reps[key] = (this.reps[key] || 0) + 1;
      if (this.reps[key] >= FC.REPETITION_LIMIT) {
        this.winner = -1; this.winReason = `Ничья: позиция повторилась ${FC.REPETITION_LIMIT} раза`;
        this.log('★ ' + this.winReason);
      } else if (this.quietPlies >= FC.QUIET_MOVES_LIMIT * 2) {
        this.winner = -1; this.winReason = `Ничья: ${FC.QUIET_MOVES_LIMIT} ходов подряд (каждой стороны) без единого взятия`;
        this.log('★ ' + this.winReason);
      }
    }
    /* Сколько раз уже встречалась текущая позиция и сколько ходов прошло без взятий — для интерфейса */
    drawCounters() {
      return { reps: this.reps[this.positionKey()] || 0, quietMoves: Math.floor(this.quietPlies / 2) };
    }
  }
  FC.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
