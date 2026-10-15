'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const E = process.env;
const PORT = Number(E.PORT) || 3000;
const DIR = E.DATA_DIR || __dirname;

if (E.VERCEL && !E.SECRET) {
  throw new Error('SECRET precisa ser definida nas variáveis de ambiente do Vercel.');
}

const secretFile = path.join(DIR, '.secret');
const SECRET = E.SECRET || (fs.existsSync(secretFile)
  ? fs.readFileSync(secretFile, 'utf8')
  : (() => {
      const value = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, value, { mode: 0o600 });
      return value;
    })());

if (SECRET.length < 32) {
  throw new Error('SECRET precisa ter pelo menos 32 caracteres.');
}

const sign = value => crypto.createHmac('sha256', SECRET).update(value).digest('hex');
const same = (a, b) => a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
const okPass = (password, value) => {
  const [salt, expected] = value.split(':');
  return Boolean(salt && expected && same(hash(password, salt), value));
};
const startSession = (res, id) => {
  const value = `${id}.${Date.now() + 30 * 864e5}`;
  res.setHeader(
    'Set-Cookie',
    `s=${value}.${sign(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${E.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
};
const asyncHandler = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const auth = asyncHandler(async (req, res, next) => {
  const match = /(?:^|; )s=([^;]+)/.exec(req.headers.cookie || '');
  if (match) {
    const [id, exp, signature] = match[1].split('.');
    const value = `${id}.${exp}`;
    if (signature && same(signature, sign(value)) && Number(exp) > Date.now()) {
      const user = await db.get(
        'SELECT id, email, name FROM users WHERE id = ?1',
        [Number(id)]
      );
      if (user) {
        req.user = user;
        return next();
      }
    }
  }
  res.status(401).json({ error: 'Faça login.' });
});

const hits = new Map();
const limit = (req, res, next) => {
  const now = Date.now();
  let entry = hits.get(req.ip);
  if (!entry || now - entry.t > 9e5) entry = { n: 0, t: now };
  entry.n++;
  hits.set(req.ip, entry);
  if (entry.n > 20) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  next();
};

const smtp = E.SMTP_HOST
  ? nodemailer.createTransport({
      host: E.SMTP_HOST,
      port: Number(E.SMTP_PORT) || 587,
      secure: Number(E.SMTP_PORT) === 465,
      auth: { user: E.SMTP_USER, pass: E.SMTP_PASS },
    })
  : null;

async function sendMail(to, subject, text) {
  if (!smtp) {
    if (E.VERCEL) throw new Error('SMTP_HOST não está configurado no Vercel.');
    fs.appendFileSync(path.join(DIR, 'outbox.log'), `[${new Date().toISOString()}] PARA: ${to} | ${subject}\n${text}\n\n`);
    return;
  }
  await smtp.sendMail({ from: E.MAIL_FROM || E.SMTP_USER, to, subject, text });
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', E.VERCEL ? 1 : false);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  if (
    req.is('application/json')
    && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
  ) {
    return res.status(400).json({ error: 'O corpo da requisição deve ser um objeto JSON.' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', asyncHandler(async (req, res, next) => {
  await db.ready;
  next();
}));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validDate = date => {
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

app.post('/api/register', limit, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim().slice(0, 60);
  const password = String(req.body.password || '');

  if (!EMAIL.test(email) || email.length > 120) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
  }

  let user;
  try {
    user = await db.get(
      'INSERT INTO users(email, name, hash, created) VALUES(?1, ?2, ?3, ?4) RETURNING id',
      [email, name, hash(password), Date.now()]
    );
  } catch (error) {
    if (
      error.code === '23505'
      || error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      || (error.code === 'ERR_SQLITE_ERROR' && error.errcode === 2067)
    ) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    throw error;
  }

  startSession(res, user.id);
  sendMail(
    email,
    'Bem-vindo à Rotina Diária',
    `Olá${name ? ', ' + name : ''}! Sua conta foi criada. Os lembretes das suas notas chegarão neste e-mail.`
  ).catch(error => console.error('Falha ao enviar e-mail de boas-vindas:', error.message));
  res.json({ user: { email, name } });
}));

app.post('/api/login', limit, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await db.get('SELECT * FROM users WHERE email = ?1', [email]);
  if (!user || !okPass(String(req.body.password || ''), user.hash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  startSession(res, user.id);
  res.json({ user: { email: user.email, name: user.name } });
}));

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 's=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: 1 });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

function clean(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title || !validDate(body.date)) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '') ? body.time : null;
  const advance = [0, 5, 10, 15, 30, 60].includes(+body.advance) ? +body.advance : 0;
  return [
    title,
    String(body.body || '').slice(0, 2000),
    body.date,
    time,
    time && body.alarm ? 1 : 0,
    time && body.email ? 1 : 0,
    advance,
    time && Number.isFinite(+body.fire_at) ? Math.round(+body.fire_at) : null,
    body.done ? 1 : 0,
  ];
}

const getNote = (id, userId) =>
  db.get('SELECT * FROM notes WHERE id = ?1 AND user_id = ?2', [id, userId]);

app.get('/api/notes', auth, asyncHandler(async (req, res) => {
  const notes = await db.all(
    'SELECT * FROM notes WHERE user_id = ?1 ORDER BY date, time',
    [req.user.id]
  );
  res.json({ notes });
}));

app.post('/api/notes', auth, asyncHandler(async (req, res) => {
  const values = clean(req.body);
  if (!values) return res.status(400).json({ error: 'Título e data são obrigatórios.' });

  const inserted = await db.get(
    `INSERT INTO notes(user_id, title, body, date, time, alarm, email, advance, fire_at, done)
     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
    [req.user.id, ...values]
  );
  res.json({ note: await getNote(inserted.id, req.user.id) });
}));

app.put('/api/notes/:id', auth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!await getNote(id, req.user.id)) {
    return res.status(404).json({ error: 'Nota não encontrada.' });
  }
  const values = clean(req.body);
  if (!values) return res.status(400).json({ error: 'Dados inválidos.' });

  await db.run(
    `UPDATE notes
     SET title = ?1, body = ?2, date = ?3, time = ?4, alarm = ?5, email = ?6,
         advance = ?7, fire_at = ?8, done = ?9, emailed = 0,
         email_claimed_at = NULL
     WHERE id = ?10 AND user_id = ?11`,
    [...values, id, req.user.id]
  );
  res.json({ note: await getNote(id, req.user.id) });
}));

app.delete('/api/notes/:id', auth, asyncHandler(async (req, res) => {
  await db.run(
    'DELETE FROM notes WHERE id = ?1 AND user_id = ?2',
    [Number(req.params.id), req.user.id]
  );
  res.json({ ok: 1 });
}));

async function processReminders() {
  const now = Date.now();
  await db.run(
    'UPDATE notes SET emailed = 0, email_claimed_at = NULL WHERE emailed = 2 AND email_claimed_at < ?1',
    [now - 10 * 60 * 1000]
  );
  const rows = await db.all(
    `SELECT n.*, u.email AS to_email
     FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.email = 1 AND n.emailed = 0 AND n.done = 0
       AND n.fire_at <= ?1 AND n.fire_at > ?2
     ORDER BY n.fire_at ASC LIMIT 50`,
    [now, now - 864e5]
  );

  let sent = 0;
  let failed = 0;
  for (const note of rows) {
    const claimed = await db.get(
      'UPDATE notes SET emailed = 2, email_claimed_at = ?1 WHERE id = ?2 AND emailed = 0 RETURNING id',
      [now, note.id]
    );
    if (!claimed) continue;

    try {
      const [year, month, day] = note.date.split('-');
      await sendMail(
        note.to_email,
        `⏰ Lembrete: ${note.title}`,
        `${note.title}\n${day}/${month}/${year} às ${note.time}${note.advance ? ` (aviso ${note.advance} min antes)` : ''}\n\n${note.body || ''}`
      );
      await db.run(
        'UPDATE notes SET emailed = 1, email_claimed_at = NULL WHERE id = ?1',
        [note.id]
      );
      sent++;
    } catch (error) {
      await db.run(
        'UPDATE notes SET emailed = 0, email_claimed_at = NULL WHERE id = ?1',
        [note.id]
      );
      failed++;
      console.error(`Falha no lembrete da nota ${note.id}:`, error.message);
    }
  }
  return { sent, failed };
}

function validCronAuthorization(req) {
  const expected = E.CRON_SECRET || '';
  const authorization = req.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return expected.length >= 32
    && supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

app.post('/api/cron/reminders', asyncHandler(async (req, res) => {
  if (!validCronAuthorization(req)) {
    return res.status(E.CRON_SECRET ? 401 : 503).json({
      error: E.CRON_SECRET ? 'Não autorizado.' : 'CRON_SECRET não está configurada.',
    });
  }
  const result = await processReminders();
  res.status(result.failed ? 502 : 200).json(result);
}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  if (status === 500) console.error('Erro na requisição:', error);
  res.status(status).json({
    error: status === 400 ? 'JSON inválido.' : status === 413 ? 'Requisição muito grande.' : 'Erro interno.',
  });
});

if (require.main === module) {
  if (!E.VERCEL) {
    const timer = setInterval(() => {
      processReminders().catch(error => console.error('Falha no agendador local:', error.message));
    }, 20000);
    timer.unref();
  }
  app.listen(PORT, () => console.log(`Rotina Diária em http://localhost:${PORT}`));
}

module.exports = app;
