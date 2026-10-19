// Fills ~60 days of sample entries for one user so the trend chart has something to show.
// Usage: npm run seed -- <username>      (deletes that user's existing entries first)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, syncUsers } from '../lib/db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Creates data/ and the tables if needed, and loads users.json, so this works before the first `npm start`.
const db = openDb(process.env.DB_PATH || path.join(ROOT, 'data', 'lighter.db'));
syncUsers(db, process.env.USERS_FILE || path.join(ROOT, 'users.json'));
const username = process.argv[2];
if (!username) { console.error('Usage: npm run seed -- <username>'); process.exit(1); }
const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (!u) { console.error(`No user "${username}" in users.json.`); process.exit(1); }

const triggers = ['Coffee', 'After meal', 'Stress', 'Break', 'Social', 'Boredom', null, null];
db.prepare('DELETE FROM entries WHERE user_id = ?').run(u.id);
const ins = db.prepare('INSERT INTO entries (user_id, ts, trigger, note, created_at) VALUES (?, ?, ?, NULL, ?)');
const days = 60;
let n = 0;
for (let d = days; d >= 0; d--) {
  const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - d);
  // starts ~16/day, trends to ~7/day, with noise and heavier weekends
  const base = 16 - (9 * (days - d)) / days;
  const weekend = [0, 6].includes(day.getDay()) ? 2 : 0;
  const count = Math.max(0, Math.round(base + weekend + (Math.random() * 4 - 2)));
  for (let i = 0; i < count; i++) {
    const hour = 7 + Math.random() * 16;
    const ts = day.getTime() + hour * 3600e3;
    if (ts > Date.now()) continue;
    ins.run(u.id, Math.round(ts), triggers[Math.floor(Math.random() * triggers.length)], Date.now());
    n++;
  }
}
console.log(`✓ Added ${n} sample entries for ${username}`);
