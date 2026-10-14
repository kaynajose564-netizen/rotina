(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const DS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };

  let notes = [], sel = ymd(new Date()), view = new Date(), editing = null, mode = 'login', started = false;
  const fired = new Set();
  let S = { theme: 'dark' };
  try { S = { ...S, ...JSON.parse(localStorage.getItem('rotina_ui') || '{}') }; } catch {}

  async function api(p, method = 'GET', body) {
    const r = await fetch('/api/' + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erro de conexão');
    return j;
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 3200); }
  function theme() { document.documentElement.dataset.theme = S.theme; $('#btnTheme').textContent = S.theme === 'light' ? '☀️' : '🌙'; }
  function tick() {
    const n = new Date();
    $('#liveClock').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
    $('#liveDate').textContent = n.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ----- conta -----
  function setMode(m) {
    mode = m; $('#tabLogin').classList.toggle('on', m === 'login'); $('#tabReg').classList.toggle('on', m === 'register');
    $('#gName').style.display = m === 'register' ? '' : 'none'; $('#btnAuth').textContent = m === 'register' ? 'Criar conta' : 'Entrar';
    $('#aPass').autocomplete = m === 'register' ? 'new-password' : 'current-password'; $('#authErr').textContent = '';
  }
  async function enter() {
    $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
    notes = (await api('notes')).notes; render();
    if (!started) { started = true; setInterval(checkAlarms, 15000); }
    checkAlarms();
  }

  // ----- calendário + lista -----
  function render() { renderCal(); renderList(); }
  function renderCal() {
    const y = view.getFullYear(), m = view.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), today = ymd(new Date());
    const has = new Set(notes.map(n => n.date));
    $('#calTitle').textContent = `${MESES[m]} de ${y}`;
    let h = DS.map(d => `<div class="cal-dow">${d}</div>`).join('') + '<div></div>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m + 1)}-${pad(d)}`;
      h += `<button class="cal-cell${k === sel ? ' sel' : ''}${k === today ? ' today' : ''}${has.has(k) ? ' has' : ''}" data-d="${k}">${d}</button>`;
    }
    $('#calGrid').innerHTML = h;
  }
  function renderList() {
    const d = parse(sel), list = notes.filter(n => n.date === sel).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    $('#dayTitle').textContent = `${DS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    $('#noteCount').textContent = list.length ? `${list.length} nota${list.length > 1 ? 's' : ''}` : '';
    $('#emptyState').classList.toggle('hidden', list.length > 0);
    $('#taskList').innerHTML = list.map(n => `
      <article class="task-card${n.done ? ' done' : ''}" data-id="${n.id}">
        <button class="task-check${n.done ? ' checked' : ''}" data-a="done" aria-label="Concluir"></button>
        <div class="task-body">
          <div class="task-time">${n.time || 'Sem horário'} ${n.alarm ? '🔔' : ''} ${n.email ? '✉️' : ''}</div>
          <div class="task-title">${esc(n.title)}</div>${n.body ? `<div class="task-note">${esc(n.body)}</div>` : ''}
        </div>
      </article>`).join('');
  }

  // ----- modal de nota -----
  function openModal(n) {
    editing = n ? n.id : null; $('#modalTitle').textContent = n ? 'Editar nota' : 'Nova nota';
    $('#nTitle').value = n?.title || ''; $('#nBody').value = n?.body || ''; $('#nDate').value = n?.date || sel; $('#nTime').value = n?.time || '';
    $('#nAdv').value = String(n?.advance || 0); $('#nAlarm').checked = n ? !!n.alarm : true; $('#nEmail').checked = n ? !!n.email : true;
    $('#btnDel').classList.toggle('hidden', !n); $('#modal').classList.remove('hidden'); $('#nTitle').focus();
  }
  const closeModal = () => { $('#modal').classList.add('hidden'); editing = null; };
  function payload(n = {}) {
    const date = $('#nDate').value, time = $('#nTime').value, advance = +$('#nAdv').value;
    return { title: $('#nTitle').value.trim(), body: $('#nBody').value.trim(), date, time: time || null, advance, done: n.done || 0,
      alarm: !!time && $('#nAlarm').checked, email: !!time && $('#nEmail').checked,
      fire_at: time ? new Date(`${date}T${time}:00`).getTime() - advance * 60000 : null };
  }
  async function saveNote(e) {
    e.preventDefault();
    try {
      const old = notes.find(n => n.id === editing), b = payload(old);
      const { note } = editing ? await api('notes/' + editing, 'PUT', b) : await api('notes', 'POST', b);
      notes = editing ? notes.map(n => n.id === note.id ? note : n) : [...notes, note];
      sel = note.date; view = parse(note.date); view.setDate(1); closeModal(); render(); toast('Nota salva!'); checkAlarms();
      if (note.alarm || note.email) askNotif();
    } catch (x) { toast(x.message); }
  }
  async function toggleDone(id) {
    const n = notes.find(x => x.id === id); if (!n) return;
    const { note } = await api('notes/' + id, 'PUT', { ...n, done: n.done ? 0 : 1, alarm: !!n.alarm, email: !!n.email });
    notes = notes.map(x => x.id === id ? note : x); renderList();
  }

  // ----- alarmes -----
  function beep() {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      [880, 660, 880, 990].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination);
        o.frequency.value = f; g.gain.setValueAtTime(.6, c.currentTime + i * .3); g.gain.exponentialRampToValueAtTime(.01, c.currentTime + i * .3 + .28);
        o.start(c.currentTime + i * .3); o.stop(c.currentTime + i * .3 + .3); });
    } catch {}
  }
  async function askNotif() { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); }
  function ring(n) {
    beep(); navigator.vibrate?.([200, 100, 200, 100, 400]);
    const msg = n.advance ? `${n.title} (às ${n.time})` : n.title;
    if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('⏰ ' + msg, { body: n.body || '', requireInteraction: true }); } catch {} }
    toast('🔔 ' + msg);
  }
  function checkAlarms() {
    const now = Date.now();
    notes.forEach(n => {
      if (!n.alarm || n.done || !n.fire_at) return;
      const k = n.id + '-' + n.fire_at;
      if (fired.has(k) || now < n.fire_at || now - n.fire_at > 120000) return;
      fired.add(k); ring(n);
    });
  }

  // ----- eventos -----
  function bind() {
    $('#tabLogin').onclick = () => setMode('login'); $('#tabReg').onclick = () => setMode('register');
    $('#formAuth').onsubmit = async e => {
      e.preventDefault();
      try {
        const b = { email: $('#aEmail').value, password: $('#aPass').value }; if (mode === 'register') b.name = $('#aName').value;
        await api(mode, 'POST', b); $('#formAuth').reset(); await enter();
      } catch (x) { $('#authErr').textContent = x.message; }
    };
    $('#btnOut').onclick = async () => { await api('logout', 'POST'); notes = []; $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); };
    $('#btnTheme').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('rotina_ui', JSON.stringify(S)); theme(); };
    $('#btnNotif').onclick = async () => {
      if (!('Notification' in window)) return toast('Seu navegador não suporta notificações.');
      toast((await Notification.requestPermission()) === 'granted' ? 'Notificações ativadas! 🔔' : 'Notificações bloqueadas no navegador.');
    };
    $('#calPrev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCal(); };
    $('#calNext').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCal(); };
    $('#calGrid').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { sel = b.dataset.d; render(); } };
    $('#taskList').onclick = e => {
      const c = e.target.closest('.task-card'); if (!c) return; const id = +c.dataset.id;
      if (e.target.closest('[data-a="done"]')) toggleDone(id).catch(x => toast(x.message)); else openModal(notes.find(n => n.id === id));
    };
    $('#btnAdd').onclick = () => openModal(); $('#btnClose').onclick = closeModal; $('#modalBackdrop').onclick = closeModal;
    $('#formNote').onsubmit = saveNote;
    $('#btnDel').onclick = async () => {
      if (!confirm('Excluir esta nota?')) return;
      await api('notes/' + editing, 'DELETE'); notes = notes.filter(n => n.id !== editing); closeModal(); render(); toast('Nota excluída.');
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkAlarms(); tick(); } });
  }

  async function boot() {
    theme(); tick(); setInterval(tick, 1000); bind(); setMode('login');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    try { await api('me'); await enter(); } catch { $('#auth').classList.remove('hidden'); }
  }
  boot();
})();
