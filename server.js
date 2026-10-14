'use strict';
// Rotina Diária v2 — contas, notas por data, alarmes e lembretes por e-mail
const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path'), nodemailer = require('nodemailer');
const { DatabaseSync } = require('node:sqlite');
const E = process.env, DIR = E.DATA_DIR || __dirname, PORT = +E.PORT || 3000;

const db = new DatabaseSync(path.join(DIR, 'rotina.db'));
db.exec(`create table if not exists users(id integer primary key, email text unique not null, name text, hash text not null, created integer);
create table if not exists notes(id integer primary key, user_id integer not null, title text not null, body text default '', date text not null,
  time text, alarm integer default 0, email integer default 0, advance integer default 0, fire_at integer, emailed integer default 0, done integer default 0);
create index if not exists n_user on notes(user_id, date);`);

// ----- segurança: segredo, senha (scrypt), cookie assinado -----
const sf = path.join(DIR, '.secret');
const SECRET = E.SECRET || (fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8') : (s => (fs.writeFileSync(sf, s, { mode: 0o600 }), s))(crypto.randomBytes(32).toString('hex')));
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hash = (p, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex');
const okPass = (p, h) => same(hash(p, h.split(':')[0]), h);
const startSession = (res, id) => { const v = `${id}.${Date.now() + 30 * 864e5}`;
  res.setHeader('Set-Cookie', `s=${v}.${sign(v)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${E.NODE_ENV === 'production' ? '; Secure' : ''}`); };
function auth(req, res, next) {
  const m = /(?:^|; )s=([^;]+)/.exec(req.headers.cookie || '');
  if (m) { const [id, exp, sig] = m[1].split('.');
    if (sig && same(sig, sign(id + '.' + exp)) && +exp > Date.now()) {
      const u = db.prepare('select id,email,name from users where id=?').get(+id);
      if (u) { req.user = u; return next(); } } }
  res.status(401).json({ error: 'Faça login.' });
}
const hits = new Map();
const limit = (req, res, next) => { const now = Date.now(); let h = hits.get(req.ip);
  if (!h || now - h.t > 9e5) h = { n: 0, t: now }; h.n++; hits.set(req.ip, h);
  if (h.n > 20) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); next(); };

// ----- e-mail (SMTP real se configurado; senão grava em outbox.log) -----
const smtp = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port: +E.SMTP_PORT || 587, secure: +E.SMTP_PORT === 465,
  auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } }) : null;
async function sendMail(to, subject, text) {
  if (!smtp) { fs.appendFileSync(path.join(DIR, 'outbox.log'), `[${new Date().toISOString()}] PARA: ${to} | ${subject}\n${text}\n\n`); return; }
  await smtp.sendMail({ from: E.MAIL_FROM || E.SMTP_USER, to, subject, text });
}

// ----- app -----
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" }); next(); });
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
app.post('/api/register', limit, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), name = String(req.body.name || '').trim().slice(0, 60), pw = String(req.body.password || '');
  if (!EMAIL.test(email) || email.length > 120) return res.status(400).json({ error: 'E-mail inválido.' });
  if (pw.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
  try {
    const r = db.prepare('insert into users(email,name,hash,created) values(?,?,?,?)').run(email, name, hash(pw), Date.now());
    startSession(res, r.lastInsertRowid);
    sendMail(email, 'Bem-vindo à Rotina Diária', `Olá${name ? ', ' + name : ''}! Sua conta foi criada. Os lembretes das suas notas chegarão neste e-mail.`).catch(e => console.error('email:', e.message));
    res.json({ user: { email, name } });
  } catch (e) { res.status(409).json({ error: 'Este e-mail já está cadastrado.' }); }
});
app.post('/api/login', limit, (req, res) => {
  const u = db.prepare('select * from users where email=?').get(String(req.body.email || '').trim().toLowerCase());
  if (!u || !okPass(String(req.body.password || ''), u.hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  startSession(res, u.id); res.json({ user: { email: u.email, name: u.name } });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 's=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: 1 }); });
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

function clean(b) {
  const title = String(b.title || '').trim().slice(0, 120); if (!title) return null;
  if (!/^\d{4}-\d\d-\d\d$/.test(b.date)) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '') ? b.time : null;
  const adv = [0, 5, 10, 15, 30, 60].includes(+b.advance) ? +b.advance : 0;
  return [title, String(b.body || '').slice(0, 2000), b.date, time, time && b.alarm ? 1 : 0, time && b.email ? 1 : 0, adv,
    time && Number.isFinite(+b.fire_at) ? Math.round(+b.fire_at) : null, b.done ? 1 : 0];
}
const get = (id, uid) => db.prepare('select * from notes where id=? and user_id=?').get(id, uid);
app.get('/api/notes', auth, (req, res) => res.json({ notes: db.prepare('select * from notes where user_id=? order by date,time').all(req.user.id) }));
app.post('/api/notes', auth, (req, res) => {
  const v = clean(req.body); if (!v) return res.status(400).json({ error: 'Título e data são obrigatórios.' });
  const r = db.prepare('insert into notes(user_id,title,body,date,time,alarm,email,advance,fire_at,done) values(?,?,?,?,?,?,?,?,?,?)').run(req.user.id, ...v);
  res.json({ note: get(r.lastInsertRowid, req.user.id) });
});
app.put('/api/notes/:id', auth, (req, res) => {
  if (!get(+req.params.id, req.user.id)) return res.status(404).json({ error: 'Nota não encontrada.' });
  const v = clean(req.body); if (!v) return res.status(400).json({ error: 'Dados inválidos.' });
  db.prepare('update notes set title=?,body=?,date=?,time=?,alarm=?,email=?,advance=?,fire_at=?,done=?,emailed=0 where id=? and user_id=?').run(...v, +req.params.id, req.user.id);
  res.json({ note: get(+req.params.id, req.user.id) });
});
app.delete('/api/notes/:id', auth, (req, res) => { db.prepare('delete from notes where id=? and user_id=?').run(+req.params.id, req.user.id); res.json({ ok: 1 }); });

// ----- agendador: envia o e-mail quando chega a hora (considerando a antecedência) -----
setInterval(async () => {
  const now = Date.now();
  const rows = db.prepare('select n.*,u.email as to_email from notes n join users u on u.id=n.user_id where n.email=1 and n.emailed=0 and n.done=0 and n.fire_at<=? and n.fire_at>?').all(now, now - 864e5);
  for (const n of rows) {
    try {
      const [y, m, d] = n.date.split('-');
      await sendMail(n.to_email, `⏰ Lembrete: ${n.title}`, `${n.title}\n${d}/${m}/${y} às ${n.time}${n.advance ? ` (aviso ${n.advance} min antes)` : ''}\n\n${n.body || ''}`);
      db.prepare('update notes set emailed=1 where id=?').run(n.id);
    } catch (e) { console.error('e-mail falhou:', e.message); }
  }
}, 20000);

app.listen(PORT, () => console.log(`Rotina Diária em http://localhost:${PORT}  (e-mail: ${smtp ? 'SMTP' : 'modo teste -> outbox.log'})`));
