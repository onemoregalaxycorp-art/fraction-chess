'use strict';
/* Поток, в котором думает компьютер (см. FC.AI.chooseAsync в js/ai.js): страница не замирает во время расчёта.
   Получает снимок партии, восстанавливает её у себя и возвращает номер выбранного действия в списке допустимых. */
self.window = self;
self.FC = {};
importScripts('engine.js', 'factions/humans.js', 'factions/orcs.js', 'factions/demons.js', 'factions/undead.js',
  'factions/dwarves.js', 'factions/elves.js', 'factions/chthon.js', 'ai.js');
self.onmessage = e => {
  const { id, f, snap, owner, depth, budget } = e.data;
  try {
    const G = new FC.Game(f[0], f[1]);
    G.restore(snap);
    G.history = []; G.future = [];
    FC.AI.depth = depth; FC.AI.budgetMs = budget;
    const a = FC.AI.choose(G, owner);
    if (!a) { postMessage({ id, idx: null }); return; }
    const acts = G.allActions(owner);
    const idx = acts.findIndex(b => b.label === a.label && b.x === a.x && b.y === a.y && String(b.from) === String(a.from) && b.kind === a.kind);
    postMessage({ id, idx: idx < 0 ? null : idx, label: a.label, last: FC.AI.last });
  } catch (err) {
    postMessage({ id, fail: true, error: String(err && err.message || err) });
  }
};
