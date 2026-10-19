// Lighter: cigarette tracker server.
// Zero dependencies: Node's built-in http + node:sqlite (Node >= 22.13).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './lib/passwords.js';
import { openDb, syncUsers } from './lib/db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || undefined; // undefined = all interfaces, IPv4 + IPv6
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'lighter.db');
const USERS_FILE = process.env.USERS_FILE || path.join(ROOT, 'users.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SESSION_DAYS = 30;
const COOKIE = 'lighter_sid';

// ---------- database ----------
const db = openDb(DB_PATH);

// ---------- sessions ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now, now + SESSION_DAYS * 864e5);
  return token;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha256(token), Date.now());
  return row || null;
}

function sessionCookie(req, token, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Simple in-memory brute-force guard: 8 failures per 15 min per IP+username.
const attempts = new Map();
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) return false;
  return a.count >= 8;
}
function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) attempts.set(key, { count: 1, reset: Date.now() + 15 * 60e3 });
  else a.count++;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const clean = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);

function validTs(v) {
  const n = Number(v);
  // between 2000-01-01 and 1 day in the future
  return Number.isFinite(n) && n > 946684800000 && n < Date.now() + 864e5 ? Math.round(n) : null;
}

const entryOut = (r) => ({ id: r.id, ts: r.ts, trigger: r.trigger, note: r.note });

// ---------- API ----------
async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  // Mutating requests must be JSON: this blocks cross-site form posts (CSRF) since
  // browsers can't send application/json cross-origin without a CORS preflight.
  if (method !== 'GET' && method !== 'HEAD' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'Content-Type must be application/json' });
  }

  if (p === '/api/login' && method === 'POST') {
    const { username, password } = await readJson(req);
    const key = `${req.socket.remoteAddress}|${String(username || '').toLowerCase()}`;
    if (tooManyAttempts(key)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const u = db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ? AND active = 1').get(String(username || ''));
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
      recordFailure(key);
      return send(res, 401, { error: 'Wrong username or password.' });
    }
    attempts.delete(key);
    const token = createSession(u.id);
    return send(res, 200, { user: { username: u.username, name: u.display_name } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  }

  if (p === '/api/logout' && method === 'POST') {
    const token = parseCookies(req)[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Not signed in' });

  if (p === '/api/me' && method === 'GET') {
    const s = db.prepare('SELECT daily_limit FROM settings WHERE user_id = ?').get(user.id);
    const span = db.prepare('SELECT MIN(ts) AS first, MAX(ts) AS last FROM entries WHERE user_id = ?').get(user.id);
    return send(res, 200, {
      user: { username: user.username, name: user.display_name },
      settings: { dailyLimit: s?.daily_limit ?? null },
      firstEntryTs: span?.first ?? null,
      lastEntryTs: span?.last ?? null,
    });
  }

  if (p === '/api/settings' && method === 'PUT') {
    const body = await readJson(req);
    let limit = body.dailyLimit;
    if (limit === null || limit === '' || limit === undefined) limit = null;
    else {
      limit = Math.round(Number(limit));
      if (!Number.isFinite(limit) || limit < 0 || limit > 200) return send(res, 400, { error: 'Daily limit must be 0-200.' });
    }
    db.prepare(`INSERT INTO settings (user_id, daily_limit, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET daily_limit = excluded.daily_limit, updated_at = excluded.updated_at`)
      .run(user.id, limit, Date.now());
    return send(res, 200, { settings: { dailyLimit: limit } });
  }

  if (p === '/api/entries' && method === 'GET') {
    const from = Number(url.searchParams.get('from')) || 0;
    const to = Number(url.searchParams.get('to')) || Date.now() + 864e5;
    const rows = db.prepare('SELECT id, ts, trigger, note FROM entries WHERE user_id = ? AND ts >= ? AND ts < ? ORDER BY ts ASC')
      .all(user.id, from, to);
    return send(res, 200, { entries: rows.map(entryOut) });
  }

  if (p === '/api/entries' && method === 'POST') {
    const body = await readJson(req);
    const ts = body.ts === undefined ? Date.now() : validTs(body.ts);
    if (ts === null) return send(res, 400, { error: 'Invalid time.' });
    const r = db.prepare('INSERT INTO entries (user_id, ts, trigger, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, ts, clean(body.trigger, 40), clean(body.note, 280), Date.now());
    return send(res, 201, { entry: { id: Number(r.lastInsertRowid), ts, trigger: clean(body.trigger, 40), note: clean(body.note, 280) } });
  }

  const m = p.match(/^\/api\/entries\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const row = db.prepare('SELECT id, ts, trigger, note FROM entries WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!row) return send(res, 404, { error: 'Entry not found' });

    if (method === 'DELETE') {
      db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(id, user.id);
      return send(res, 200, { ok: true });
    }
    if (method === 'PATCH') {
      const body = await readJson(req);
      const ts = body.ts === undefined ? row.ts : validTs(body.ts);
      if (ts === null) return send(res, 400, { error: 'Invalid time.' });
      const trigger = 'trigger' in body ? clean(body.trigger, 40) : row.trigger;
      const note = 'note' in body ? clean(body.note, 280) : row.note;
      db.prepare('UPDATE entries SET ts = ?, trigger = ?, note = ? WHERE id = ? AND user_id = ?').run(ts, trigger, note, id, user.id);
      return send(res, 200, { entry: { id, ts, trigger, note } });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback for navigations
      if (!path.extname(rel)) return serveStatic(req, res, new URL('/', url));
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- boot ----------
syncUsers(db, USERS_FILE);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`! Port ${PORT} is already in use by another app. Try: PORT=3030 npm start`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`✓ Lighter running at http://localhost:${PORT}`);
  console.log(`  database: ${path.relative(ROOT, DB_PATH) || DB_PATH}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
