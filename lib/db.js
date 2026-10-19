// Database setup and users.json sync, shared by the server and the scripts.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword, isHash } from './passwords.js';

// ---------- database ----------
export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT,
    password_hash TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts         INTEGER NOT NULL,          -- epoch ms
    trigger    TEXT,
    note       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_user_ts ON entries(user_id, ts);

  CREATE TABLE IF NOT EXISTS settings (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_limit INTEGER,
    updated_at  INTEGER NOT NULL
  );
`);
  return db;
}

// ---------- users.json -> users table ----------
export function syncUsers(db, USERS_FILE) {
  if (!fs.existsSync(USERS_FILE)) {
    console.warn(`! ${path.basename(USERS_FILE)} not found. Copy users.example.json to users.json and add your users.`);
    return;
  }
  let list;
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    list = Array.isArray(raw) ? raw : raw.users;
    if (!Array.isArray(list)) throw new Error('expected an array or { "users": [...] }');
  } catch (e) {
    console.error(`! Could not read ${USERS_FILE}: ${e.message}`);
    return;
  }

  const now = Date.now();
  const seen = new Set();
  const find = db.prepare('SELECT id, password_hash FROM users WHERE username = ?');
  const insert = db.prepare('INSERT INTO users (username, display_name, password_hash, active, created_at) VALUES (?, ?, ?, 1, ?)');
  const update = db.prepare('UPDATE users SET display_name = ?, password_hash = ?, active = 1 WHERE id = ?');
  let plain = 0;

  for (const u of list) {
    const username = String(u.username || '').trim();
    const secret = u.passwordHash || u.password;
    if (!username || !secret) { console.warn('! Skipping user entry without username/password'); continue; }
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) { console.warn(`! Skipping "${username}": use 2-40 letters, digits, . _ -`); continue; }
    seen.add(username.toLowerCase());

    const existing = find.get(username);
    let hash;
    if (isHash(secret)) hash = secret;
    else {
      plain++;
      // Keep the stored hash if the plain password hasn't changed (avoids new salts every boot).
      hash = existing && verifyPassword(secret, existing.password_hash) ? existing.password_hash : hashPassword(secret);
    }
    const name = u.displayName || u.name || username;
    if (existing) update.run(name, hash, existing.id);
    else insert.run(username, name, hash, now);
  }

  // Users removed from the file are deactivated (their data is kept) and logged out.
  const all = db.prepare('SELECT id, username FROM users WHERE active = 1').all();
  for (const row of all) {
    if (!seen.has(row.username.toLowerCase())) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      console.log(`- deactivated "${row.username}" (not in users.json)`);
    }
  }
  console.log(`✓ ${seen.size} user(s) loaded from ${path.basename(USERS_FILE)}`);
  if (plain) console.log(`  tip: ${plain} password(s) are plain text. Run "npm run hash -- <password>" and use "passwordHash" instead.`);
}
