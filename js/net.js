'use strict';
/* FRACTION CHESS — сетевая игра: прямое соединение двух браузеров (WebRTC через PeerJS, js/vendor/peerjs.min.js).
   Хозяин комнаты регистрирует id «fraction-chess-<КОД>» на публичном сервере-посреднике PeerJS,
   гость подключается по коду. Дальше данные идут напрямую между устройствами.
   Событие для обработчика: { type: 'code', code } | 'open' | { type: 'msg', data } | 'close' | { type: 'error', text } */
(function (FC) {
  const PREFIX = 'fraction-chess-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих символов (0/O, 1/I)
  // ссылка-приглашение: из exe (localhost) ведём друга на сайт игры, иначе — на текущую страницу
  const SITE = 'https://onemoregalaxycorp-art.github.io/fraction-chess/';
  let peer = null, conn = null, handler = null, alive = 0, pingT = 0;

  const newCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const emit = e => { if (handler) handler(typeof e === 'string' ? { type: e } : e); };
  const ERR = {
    'peer-unavailable': 'Комната не найдена: проверьте код или попросите друга создать комнату заново.',
    'network': 'Нет связи с сервером соединения. Проверьте интернет.',
    'server-error': 'Сервер соединения недоступен. Попробуйте позже.',
    'socket-error': 'Нет связи с сервером соединения. Проверьте интернет.',
    'browser-incompatible': 'Этот браузер не поддерживает сетевую игру (WebRTC).',
    'webrtc': 'Не удалось соединить устройства напрямую. Попробуйте другую сеть (например, Wi-Fi).'
  };

  function bind(c) {
    conn = c; alive = Date.now();
    c.on('open', () => {
      alive = Date.now(); emit('open');
      clearInterval(pingT);
      // проверка связи: если от соперника 20 секунд ничего нет — соединение потеряно
      pingT = setInterval(() => {
        if (conn !== c) return clearInterval(pingT);
        try { c.send({ t: 'ping' }); } catch (e) { }
        if (Date.now() - alive > 20000) { close(); emit('close'); }
      }, 4000);
    });
    c.on('data', d => { alive = Date.now(); if (d && d.t !== 'ping') emit({ type: 'msg', data: d }); });
    c.on('close', () => { if (conn === c) { conn = null; clearInterval(pingT); emit('close'); } });
    c.on('error', () => { if (conn === c) emit({ type: 'error', text: ERR.webrtc }); });
  }
  function onPeerError(e) {
    if (e.type === 'unavailable-id') return;            // код занят — обрабатывает host()
    emit({ type: 'error', text: ERR[e.type] || ('Ошибка соединения: ' + (e.type || e.message || e)) });
  }
  function host(on) {
    close(); handler = on;
    if (!window.Peer) { emit({ type: 'error', text: ERR['browser-incompatible'] }); return; }
    const code = newCode();
    const p = peer = new window.Peer(PREFIX + code);
    p.on('open', () => { if (peer === p) emit({ type: 'code', code }); });
    p.on('connection', c => {
      if (conn) { c.on('open', () => { c.send({ t: 'busy' }); setTimeout(() => c.close(), 500); }); return; }  // комната уже занята
      bind(c);
    });
    p.on('error', e => {
      if (peer !== p) return;
      if (e.type === 'unavailable-id') { const h = handler; p.destroy(); peer = null; host(h); return; }   // код занят — берём другой
      onPeerError(e);
    });
  }
  function join(code, on) {
    close(); handler = on;
    if (!window.Peer) { emit({ type: 'error', text: ERR['browser-incompatible'] }); return; }
    const p = peer = new window.Peer();
    p.on('open', () => { if (peer === p) bind(p.connect(PREFIX + code.toUpperCase(), { reliable: true })); });
    p.on('error', e => { if (peer === p) onPeerError(e); });
  }
  function send(msg) { if (conn && conn.open) { conn.send(msg); return true; } return false; }
  function close() {
    clearInterval(pingT);
    const c = conn, p = peer; conn = null; peer = null;
    try { if (c) c.close(); } catch (e) { }
    try { if (p) p.destroy(); } catch (e) { }
  }
  function link(code) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    return (local ? SITE : location.origin + location.pathname) + '?room=' + code;
  }
  function stop() { handler = null; close(); }
  window.addEventListener('beforeunload', () => close());
  FC.Net = { host, join, send, stop, link, norm: s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') };
})(window.FC);
