'use strict';
/* FRACTION CHESS — сетевая игра через публичные MQTT-ретрансляторы (WebSocket).
   Оба игрока подписываются на тему комнаты «fraction-chess/v1/<КОД>» и публикуют туда свои сообщения.
   Прямое соединение между устройствами не нужно, поэтому подключение быстрое и работает в любых сетях
   (мобильный интернет, разные провайдеры). Для надёжности используются сразу несколько ретрансляторов:
   сообщение отправляется через все подключённые, повторы отбрасываются по номеру.
   События для обработчика: { type: 'code', code } | 'open' | { type: 'msg', data } | 'close' | { type: 'error', text }
   | { type: 'stage', text } — этап подключения (показывается в окне ожидания). */
(function (FC) {
  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  const TOPIC = code => 'fraction-chess/v1/' + code;
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих символов (0/O, 1/I)
  // ссылка-приглашение: из exe (localhost) ведём друга на сайт игры, иначе — на текущую страницу
  const SITE = 'https://onemoregalaxycorp-art.github.io/fraction-chess/';
  const rnd = (n, a) => Array.from({ length: n }, () => (a || ALPHA)[Math.floor(Math.random() * (a || ALPHA).length)]).join('');

  /* ---------- минимальный клиент MQTT 3.1.1 поверх WebSocket (QoS 0) ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const mstr = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
  const remLen = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
  const packet = (h, body) => { const r = remLen(body.length), u = new Uint8Array(1 + r.length + body.length); u[0] = h; u.set(r, 1); u.set(body, 1 + r.length); return u; };
  function broker(url, onMsg, onState) {
    const b = { url, ready: false, dead: false, topics: new Set(), ws: null, pid: 1 };
    let buf = new Uint8Array(0), pingT = 0;
    try { b.ws = new WebSocket(url, ['mqtt']); } catch (e) { b.dead = true; return b; }
    const ws = b.ws; ws.binaryType = 'arraybuffer';
    const raw = p => { try { if (ws.readyState === 1) ws.send(p); } catch (e) { } };
    b.sub = t => { b.topics.add(t); if (b.ready) { const id = b.pid++; raw(packet(0x82, [id >> 8, id & 255, ...mstr(t), 0])); } };
    b.unsub = t => { if (b.topics.delete(t) && b.ready) { const id = b.pid++; raw(packet(0xA2, [id >> 8, id & 255, ...mstr(t)])); } };
    b.pub = (t, s) => { if (b.ready) raw(packet(0x30, [...mstr(t), ...enc.encode(s)])); };
    b.close = () => { b.dead = true; b.ready = false; clearInterval(pingT); try { raw(new Uint8Array([0xE0, 0])); ws.close(); } catch (e) { } };
    ws.onopen = () => raw(packet(0x10, [...mstr('MQTT'), 4, 2, 0, 60, ...mstr('fc-' + rnd(12, 'abcdefghijklmnopqrstuvwxyz0123456789'))]));
    ws.onmessage = e => {
      const add = new Uint8Array(e.data), nb = new Uint8Array(buf.length + add.length); nb.set(buf); nb.set(add, buf.length); buf = nb;
      for (;;) {                                         // в одном кадре может быть несколько пакетов или часть пакета
        if (buf.length < 2) return;
        let len = 0, mul = 1, i = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (buf.length < i + len) return;
        const h = buf[0], body = buf.subarray(i, i + len); buf = buf.slice(i + len);
        const type = h >> 4;
        if (type === 2) {                                // CONNACK
          if (body[1] !== 0) { b.close(); onState(b); continue; }
          b.ready = true;
          for (const t of b.topics) { const id = b.pid++; raw(packet(0x82, [id >> 8, id & 255, ...mstr(t), 0])); }
          pingT = setInterval(() => raw(new Uint8Array([0xC0, 0])), 25000);
          onState(b);
        } else if (type === 3) {                         // PUBLISH
          const tl = (body[0] << 8) | body[1], topic = dec.decode(body.subarray(2, 2 + tl));
          const off = 2 + tl + (((h >> 1) & 3) ? 2 : 0);
          try { onMsg(topic, JSON.parse(dec.decode(body.subarray(off)))); } catch (err) { }
        }
      }
    };
    ws.onclose = ws.onerror = () => { if (!b.dead) { b.dead = true; b.ready = false; clearInterval(pingT); onState(b); } };
    return b;
  }

  /* ---------- комната ---------- */
  const ERR = {
    noServer: 'Нет связи с серверами игры. Проверьте интернет и попробуйте снова.',
    noRoom: 'Комната не найдена: проверьте код или попросите друга создать комнату заново (и не закрывать её страницу).'
  };
  let pool = [], handler = null, me = rnd(10), room = null, peerId = null, seq = 0, lastIn = 0, seen = new Set();
  let alive = 0, pingT = 0, waitT = 0, role = null, onReady = null;
  const emit = e => { if (handler) handler(typeof e === 'string' ? { type: e } : e); };
  const stage = text => emit({ type: 'stage', text });
  const readyCount = () => pool.filter(b => b.ready).length;

  function onState() {
    if (readyCount() && onReady) { const f = onReady; onReady = null; f(); }
    if (pool.length && pool.every(b => b.dead) && onReady) { onReady = null; clearTimeout(waitT); emit({ type: 'error', text: ERR.noServer }); }
  }
  function onMsg(topic, m) {
    if (!room || topic !== TOPIC(room) || !m || m.from === me) return;
    if (m.to && m.to !== me) return;
    if (!peerId && role === 'guest' && m.to !== me) return;   // гость принимает только ответ хозяина, адресованный ему
    if (peerId && m.from !== peerId) {                   // в комнате уже идёт игра — третьему отвечаем «занято»
      if (role === 'host' && m.d && m.d.t === 'hello') raw({ t: 'busy' }, m.from);
      return;
    }
    const key = m.from + ':' + m.n;
    if (seen.has(key)) return;                           // то же сообщение через другой ретранслятор
    seen.add(key); if (seen.size > 400) seen = new Set([...seen].slice(-200));
    alive = Date.now();
    if (!peerId) {
      if (role === 'host' && !(m.d && m.d.t === 'hello')) return;
      peerId = m.from; clearTimeout(waitT); startPing();
      if (role === 'host') emit('open');
    }
    if (m.d && m.d.t === 'ping') return;
    if (m.d && m.d.t === 'bye') { emit({ type: 'msg', data: m.d }); return; }
    emit({ type: 'msg', data: m.d });
  }
  function raw(d, to) {
    const s = JSON.stringify({ from: me, to: to || peerId || undefined, n: ++seq, d });
    let ok = false;
    for (const b of pool) if (b.ready) { b.pub(TOPIC(room), s); ok = true; }
    return ok;
  }
  function startPing() {
    clearInterval(pingT); alive = Date.now();
    pingT = setInterval(() => {
      raw({ t: 'ping' });
      if (Date.now() - alive > 20000) { leave(); emit('close'); }   // от соперника 20 секунд ничего нет — связь потеряна
    }, 4000);
  }
  // подключиться к ретрансляторам заранее (окно приглашения ещё открыто)
  function prepare() {
    pool = pool.filter(b => !b.dead);
    if (pool.length) return;
    me = rnd(10);
    pool = BROKERS.map(u => broker(u, onMsg, onState));
  }
  function whenReady(f) {
    prepare();
    if (readyCount()) { f(); return; }
    stage('Подключение к серверу игры…');
    onReady = f;
    clearTimeout(waitT);
    waitT = setTimeout(() => { if (onReady) { onReady = null; emit({ type: 'error', text: ERR.noServer }); } }, 12000);
  }
  function enter(code) {
    room = code; peerId = null; seq = 0; seen = new Set();
    for (const b of pool) b.sub(TOPIC(code));
  }
  function host(on) {
    leave(); handler = on; role = 'host';
    whenReady(() => {
      const code = rnd(5);
      enter(code);
      setTimeout(() => { if (role === 'host' && room === code) emit({ type: 'code', code }); }, 150);   // подписка успевает дойти до сервера
    });
  }
  function join(code, on) {
    leave(); handler = on; role = 'guest';
    whenReady(() => {
      enter(code);
      stage('Ищем комнату ' + code + '…');
      // ретрансляторы не знают, есть ли комната: просто здороваемся, пока хозяин не ответит
      let tries = 0;
      const hello = () => {
        if (role !== 'guest' || room !== code || peerId) return;
        if (++tries > 8) { leave(); emit({ type: 'error', text: ERR.noRoom }); return; }
        emit('open');                                    // ui отправит { t: 'hello', ... }
        waitT = setTimeout(hello, 1000);
      };
      setTimeout(hello, 150);
    });
  }
  function send(d) { if (!room || !peerId) { if (role === 'guest' && room && d.t === 'hello') return raw(d); return false; } return raw(d); }
  function leave() {
    clearInterval(pingT); clearTimeout(waitT); onReady = null;
    if (room) for (const b of pool) b.unsub(TOPIC(room));
    room = null; peerId = null; role = null;
  }
  function stop() { handler = null; leave(); }
  function link(code) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    return (local ? SITE : location.origin + location.pathname) + '?room=' + code;
  }
  window.addEventListener('beforeunload', () => { if (peerId) raw({ t: 'bye' }); for (const b of pool) b.close(); });
  FC.Net = { host, join, prepare, send, stop, link, norm: s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') };
})(window.FC);
