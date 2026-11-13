'use strict';
/* FRACTION CHESS — сетевая игра: прямое соединение двух браузеров (WebRTC через PeerJS, js/vendor/peerjs.min.js).
   Хозяин комнаты регистрирует id «fraction-chess-<КОД>» на публичном сервере-посреднике PeerJS,
   гость подключается по коду. Дальше данные идут напрямую между устройствами.
   События для обработчика: { type: 'code', code } | 'open' | { type: 'msg', data } | 'close' | { type: 'error', text }
   | { type: 'stage', text } — этап подключения (показывается в окне ожидания). */
(function (FC) {
  const PREFIX = 'fraction-chess-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих символов (0/O, 1/I)
  // ссылка-приглашение: из exe (localhost) ведём друга на сайт игры, иначе — на текущую страницу
  const SITE = 'https://onemoregalaxycorp-art.github.io/fraction-chess/';
  const CONNECT_TIMEOUT = 20000;   // столько ждём прямого соединения, потом сообщаем об ошибке
  // STUN-серверы для поиска пути между устройствами + TURN PeerJS (ретранслятор, если напрямую не пройти)
  const CONFIG = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
  ] };
  let peer = null, conn = null, handler = null, alive = 0, pingT = 0, waitT = 0;
  let warm = null;   // заранее зарегистрированный на сервере гость (пока игрок выбирает фракцию)

  const newCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const emit = e => { if (handler) handler(typeof e === 'string' ? { type: e } : e); };
  const stage = text => emit({ type: 'stage', text });
  const ERR = {
    'peer-unavailable': 'Комната не найдена: проверьте код или попросите друга создать комнату заново.',
    'network': 'Нет связи с сервером соединения. Проверьте интернет.',
    'server-error': 'Сервер соединения недоступен. Попробуйте позже.',
    'socket-error': 'Нет связи с сервером соединения. Проверьте интернет.',
    'browser-incompatible': 'Этот браузер не поддерживает сетевую игру (WebRTC).',
    'webrtc': 'Не удалось соединить устройства напрямую. Попробуйте другую сеть (например, оба по Wi-Fi) или создайте комнату заново.'
  };
  const mkPeer = id => new window.Peer(id, { config: CONFIG, pingInterval: 4000 });

  function bind(c) {
    conn = c; alive = Date.now();
    clearTimeout(waitT);
    waitT = setTimeout(() => {                         // прямое соединение так и не установилось
      if (conn === c && !c.open) { close(); emit({ type: 'error', text: ERR.webrtc }); }
    }, CONNECT_TIMEOUT);
    c.on('open', () => {
      clearTimeout(waitT);
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
    c.on('close', () => { if (conn === c) { conn = null; clearInterval(pingT); clearTimeout(waitT); emit('close'); } });
    c.on('error', () => { if (conn === c) { clearTimeout(waitT); emit({ type: 'error', text: ERR.webrtc }); } });
  }
  function onPeerError(e) {
    if (e.type === 'unavailable-id') return;            // код занят — обрабатывает host()
    clearTimeout(waitT);
    emit({ type: 'error', text: ERR[e.type] || ('Ошибка соединения: ' + (e.type || e.message || e)) });
  }
  function host(on) {
    close(); handler = on;
    if (!window.Peer) { emit({ type: 'error', text: ERR['browser-incompatible'] }); return; }
    stage('Подключение к серверу соединения…');
    const code = newCode();
    const p = peer = mkPeer(PREFIX + code);
    p.on('open', () => { if (peer === p) emit({ type: 'code', code }); });
    p.on('connection', c => {
      if (conn) { c.on('open', () => { c.send({ t: 'busy' }); setTimeout(() => c.close(), 500); }); return; }  // комната уже занята
      stage('Друг найден — соединяем устройства напрямую…');
      bind(c);
    });
    p.on('error', e => {
      if (peer !== p) return;
      if (e.type === 'unavailable-id') { const h = handler; p.destroy(); peer = null; host(h); return; }   // код занят — берём другой
      onPeerError(e);
    });
  }
  // гость: регистрируемся на сервере заранее, пока игрок смотрит окно приглашения
  function prepare() {
    if (warm || !window.Peer) return;
    const w = warm = { p: mkPeer(), open: false, err: null };
    w.p.on('open', () => { w.open = true; if (w.go) w.go(); });
    w.p.on('error', e => { w.err = e; if (w.go) w.go(); });
  }
  function join(code, on) {
    close(); handler = on;
    if (!window.Peer) { emit({ type: 'error', text: ERR['browser-incompatible'] }); return; }
    if (!warm || warm.err) { if (warm) try { warm.p.destroy(); } catch (e) { } warm = null; prepare(); }
    const w = warm; warm = null;
    const p = peer = w.p;
    let went = false;
    const go = () => {
      if (went || peer !== p) return;
      went = true;
      if (w.err) { onPeerError(w.err); return; }
      stage('Ищем комнату ' + code + ' и соединяем устройства…');
      bind(p.connect(PREFIX + code.toUpperCase(), { reliable: true }));
    };
    p.on('error', e => { if (peer === p && w.open) onPeerError(e); });
    clearTimeout(waitT);           // до соединения с комнатой (дальше таймер ставит bind)
    waitT = setTimeout(() => { if (peer === p && !conn) { close(); emit({ type: 'error', text: ERR['server-error'] }); } }, CONNECT_TIMEOUT);
    if (w.open || w.err) go(); else { stage('Подключение к серверу соединения…'); w.go = go; }
  }
  function send(msg) { if (conn && conn.open) { conn.send(msg); return true; } return false; }
  function close() {
    clearInterval(pingT); clearTimeout(waitT);
    const c = conn, p = peer; conn = null; peer = null;
    try { if (c) c.close(); } catch (e) { }
    try { if (p) p.destroy(); } catch (e) { }
  }
  function link(code) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    return (local ? SITE : location.origin + location.pathname) + '?room=' + code;
  }
  function stop() { handler = null; close(); }
  window.addEventListener('beforeunload', () => { close(); if (warm) try { warm.p.destroy(); } catch (e) { } });
  FC.Net = { host, join, prepare, send, stop, link, norm: s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') };
})(window.FC);
