'use strict';

const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const IS_VERCEL = Boolean(process.env.VERCEL);

if (IS_VERCEL && !DATABASE_URL) {
  throw new Error('DATABASE_URL precisa ser definida no Vercel.');
}

function postgresSql(query) {
  return query.replace(/\?(\d+)/g, (_, index) => `$${index}`);
}

let ready;
let localDb;
let sql;

if (DATABASE_URL) {
  const { neon } = require('@neondatabase/serverless');
  sql = neon(DATABASE_URL);
  ready = (async () => {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        hash TEXT NOT NULL,
        created BIGINT
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        date TEXT NOT NULL,
        time TEXT,
        alarm INTEGER DEFAULT 0,
        email INTEGER DEFAULT 0,
        advance INTEGER DEFAULT 0,
        fire_at BIGINT,
        emailed INTEGER DEFAULT 0,
        done INTEGER DEFAULT 0,
        email_claimed_at BIGINT
      )
    `);
    await sql.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS email_claimed_at BIGINT');
    await sql.query('CREATE INDEX IF NOT EXISTS n_user ON notes(user_id, date)');
    await sql.query('CREATE INDEX IF NOT EXISTS n_reminders ON notes(email, emailed, fire_at)');
  })();
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = process.env.DATA_DIR || __dirname;
  fs.mkdirSync(dataDir, { recursive: true });
  localDb = new DatabaseSync(path.join(dataDir, 'rotina.db'));
  localDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      hash TEXT NOT NULL,
      created INTEGER
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      date TEXT NOT NULL,
      time TEXT,
      alarm INTEGER DEFAULT 0,
      email INTEGER DEFAULT 0,
      advance INTEGER DEFAULT 0,
      fire_at INTEGER,
      emailed INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0,
      email_claimed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS n_user ON notes(user_id, date);
    CREATE INDEX IF NOT EXISTS n_reminders ON notes(email, emailed, fire_at);
  `);
  const columns = localDb.prepare('PRAGMA table_info(notes)').all().map(column => column.name);
  if (!columns.includes('email_claimed_at')) {
    localDb.exec('ALTER TABLE notes ADD COLUMN email_claimed_at INTEGER');
  }
  ready = Promise.resolve();
}

async function get(query, params = []) {
  await ready;
  if (localDb) return localDb.prepare(query).get(...params);
  const rows = await sql.query(postgresSql(query), params);
  return rows[0];
}

async function all(query, params = []) {
  await ready;
  if (localDb) return localDb.prepare(query).all(...params);
  return sql.query(postgresSql(query), params);
}

async function run(query, params = []) {
  await ready;
  if (localDb) return localDb.prepare(query).run(...params);
  const rows = await sql.query(postgresSql(query), params);
  return { changes: rows.length };
}

function close() {
  if (localDb) localDb.close();
}

module.exports = { ready, get, all, run, close };
