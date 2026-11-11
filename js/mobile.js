// Телефон: полный экран + горизонтальная ориентация при старте партии; офлайн-кэш (PWA) на https.
(function () {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;

  function goFullscreenLandscape() {
    if (!coarse || standalone) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement) return;
    Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => {});               // iPhone и часть браузеров не умеют — тогда просто остаёмся как есть
  }
  for (const id of ['startBtn', 'coinOk']) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', goFullscreenLandscape);
  }

  // service worker: только на https (опубликованная версия) или на localhost с ?sw для проверки
  const swOk = location.protocol === 'https:' || (location.hostname === 'localhost' && /[?&]sw\b/.test(location.search));
  if ('serviceWorker' in navigator && swOk) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
