'use strict';
/* ИИ: оценка каждого действия на 1 ход вперёд с проверкой результата.
   Учитывает материал, безопасность фигуры после хода, шах и мат в один ход. */
(function (FC) {
  const val = (G, q) => { const d = G.def(q); return d.royal ? 1000 : FC.VALUE[d.cls]; };

  FC.AI = {
    choose(G, owner) {
      const acts = G.allActions(owner);
      if (!acts.length) return null;
      const opp = 1 - owner;
      const T0 = G.threatSquares(opp);
      let best = null, bs = -1e9;
      for (const a of acts) {
        let s = Math.random() * 0.5;
        const mover = G.at(a.from[0], a.from[1]), md = G.def(mover), mv = FC.VALUE[md.cls];
        if (a.kind === 'capture' || a.kind === 'ranged') {
          for (const [hx, hy] of (a.hits || [[a.x, a.y]])) {
            const q = G.at(hx, hy); if (!q) continue;
            s += q.owner === owner ? -val(G, q) * 1.5 : val(G, q) * 1.2;
          }
        }
        if (a.kind === 'convert') { const q = G.at(a.x, a.y); if (q) s += FC.VALUE[G.def(q).cls] * 1.6; }
        if (a.kind === 'summon') s += a.revive ? 50 : 1.2;
        if (a.kind === 'revive') s += 2.5;
        if (a.stolen) s -= 0.2;
        if (md.cls === 'pawn' && a.kind === 'move') s += 0.25;
        if (md.royal && a.kind === 'move') s -= 0.3;

        // последствия хода: безопасность, шах, мат
        const snap = G.snapshot();
        const pid = mover.id;
        const wasAttacked = T0.has(a.from[0] + ',' + a.from[1]);
        a.apply(G);
        const T = G.threatSquares(opp);
        const f = G.find(pid);
        if (f && T.has(f.x + ',' + f.y) && !md.royal) s -= mv * 0.85;
        else if (wasAttacked && !md.royal) s += mv * 0.4;
        // без правила шаха (Демоны) лидера можно подставить — не оставлять его под ударом
        if (G.faction(owner).noCheck && G.winner == null) {
          const l = G.leader(owner);
          if (l && T.has(l.x + ',' + l.y)) s -= 900;
        }
        if (G.leaderThreatened(opp)) {
          s += 1.5;
          if (G.allActions(opp).length === 0) s += 10000;   // мат в один ход
        }
        G.restore(snap);
        if (s > bs) { bs = s; best = a; }
      }
      return best;
    },
    resolve(G, pend) {
      if (pend.kind === 'options') return pend.options[0];
      return pend.cells[Math.floor(Math.random() * pend.cells.length)];
    }
  };
})((typeof window !== 'undefined' ? window : globalThis).FC);
