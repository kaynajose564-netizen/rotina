'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.SECRET = 'rotina-test-secret-32-characters-minimum';
process.env.CRON_SECRET = 'rotina-test-cron-secret-32-characters';
process.env.SMTP_HOST = '';
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

const app = require('../server');
const db = require('../db');
let server;
let base;

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(route, options = {}, cookie) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${route}`, { ...options, headers });
  const body = await response.json();
  return { response, body };
}

test('serve o painel e mantém os cabeçalhos de segurança', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('cadastro valida dados, cria sessão e permite consultar as notas', async () => {
  const invalid = await request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ruim', password: '12345678' }),
  });
  assert.equal(invalid.response.status, 400);

  const created = await request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' pessoa@example.com ', name: 'Pessoa', password: 'Senha-forte-123' }),
  });
  assert.equal(created.response.status, 200);
  assert.deepEqual(created.body.user, { email: 'pessoa@example.com', name: 'Pessoa' });
  const cookie = created.response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);

  const notes = await request('/api/notes', {}, cookie.split(';')[0]);
  assert.equal(notes.response.status, 200);
  assert.deepEqual(notes.body.notes, []);

  const duplicate = await request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pessoa@example.com', password: 'Senha-forte-123' }),
  });
  assert.equal(duplicate.response.status, 409);
});

test('notas podem ser criadas, editadas e apagadas somente pelo dono', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pessoa@example.com', password: 'Senha-forte-123' }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];

  const created = await request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Consulta', date: '2026-10-14', time: '10:00', alarm: true }),
  }, cookie);
  assert.equal(created.response.status, 200);
  const id = created.body.note.id;

  const updated = await request(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Consulta médica', date: '2026-10-15', time: '11:30' }),
  }, cookie);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.note.title, 'Consulta médica');

  const forbidden = await request(`/api/notes/${id}`, { method: 'DELETE' });
  assert.equal(forbidden.response.status, 401);
  const deleted = await request(`/api/notes/${id}`, { method: 'DELETE' }, cookie);
  assert.equal(deleted.response.status, 200);
});

test('endpoint do agendador exige segredo e relata a execução', async () => {
  const denied = await request('/api/cron/reminders', { method: 'POST' });
  assert.equal(denied.response.status, 401);

  const accepted = await request('/api/cron/reminders', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(accepted.response.status, 200);
  assert.deepEqual(accepted.body, { sent: 0, failed: 0 });
});
