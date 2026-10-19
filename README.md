# Lighter

Track cigarettes, see whether your intake is going up or down, and cut down gradually.
A small Node server with a SQLite database and a username/password login, serving an
installable web app (PWA).

No npm packages: it uses Node's built-in `node:sqlite`, `http` and `crypto`.

## Requirements

- **Node.js 22.13 or newer** (`node -v`). Older versions don't have `node:sqlite` enabled.

## Run it

```bash
cp users.example.json users.json   # skip if users.json already exists, then edit it
npm start                          # http://localhost:3000
```

Sign in with a user from `users.json`. The default file has `akhil` / `change-me`; change it.

Want to see the trend chart with data straight away?

```bash
npm run seed -- akhil   # replaces akhil's entries with ~60 days of sample data
```

`npm run dev` restarts the server when files change.

## Users (no registration)

Users come from `users.json`, which is read every time the server starts:

```json
{
  "users": [
    { "username": "akhil", "displayName": "Akhil", "password": "change-me" },
    { "username": "sam", "passwordHash": "scrypt$16384$..." }
  ]
}
```

- `password` is plain text and gets hashed (scrypt) before it goes into the database.
- Better: store only a hash. Generate one with `npm run hash -- "the password"` and paste it as `passwordHash`.
- To change a password, edit the file and restart. Existing sessions stay valid.
- Remove a user from the file and restart to deactivate them: they're signed out and can't
  sign in, but their history stays in the database and comes back if you re-add them.
- Usernames: 2–40 characters, letters, digits, `.`, `_`, `-`. Case-insensitive.

`users.json` and `data/` are in `.gitignore`.

## What's in the app

- **Today**: one-tap logging with optional trigger (coffee, stress, after a meal…), undo,
  today's count against your daily limit, time since the last one, last 7 days vs the week before.
- **Trends**: the intake graph. Bars for each day, a 7-day rolling average line, and your
  daily limit as a dashed line. Ranges 2W / 1M / 3M / 1Y / All (ranges over ~4 months
  switch to weekly bars with a 4-week average). The headline says whether you're **up or
  down** versus the previous week and the overall slope across the range. Hover or tap for
  exact values, use arrow keys when the chart is focused, or open "Show as table".
  Also a time-of-day chart.
- **History**: entries grouped by day, delete (with undo), and add a missed one at any past time.
- Light and dark themes follow the system. Installable on phone and desktop.

Today's bar is drawn faded and left out of averages, since the day isn't finished.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | all interfaces (IPv4 + IPv6) | use `127.0.0.1` to keep it local-only |
| `DB_PATH` | `data/lighter.db` | SQLite file |
| `USERS_FILE` | `users.json` | |
| `COOKIE_SECURE` | unset | set to `1` when served over HTTPS (also auto-detected from `X-Forwarded-Proto`) |

## API

All JSON. Everything except login needs the session cookie.

| Method | Path | Body / query |
|---|---|---|
| POST | `/api/login` | `{ username, password }` |
| POST | `/api/logout` | |
| GET | `/api/me` | user, settings, first and last entry time |
| PUT | `/api/settings` | `{ dailyLimit: number \| null }` |
| GET | `/api/entries` | `?from=<ms>&to=<ms>` |
| POST | `/api/entries` | `{ ts?, trigger?, note? }` (ts defaults to now) |
| PATCH | `/api/entries/:id` | `{ ts?, trigger?, note? }` |
| DELETE | `/api/entries/:id` | |

## Database

`data/lighter.db` with tables `users`, `sessions`, `entries` (`ts` is epoch ms) and `settings`.
Back it up by copying the file while the server is stopped, or with
`sqlite3 data/lighter.db ".backup backup.db"`.

## Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed, in an
  HttpOnly, SameSite=Lax cookie, valid 30 days.
- Writes must be `application/json`, which blocks cross-site form posts.
- Sign-in is limited to 8 failed attempts per 15 minutes per IP and username.
- For use beyond your own network, put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel)
  and set `COOKIE_SECURE=1`. Service workers and "Install" also need HTTPS outside localhost.

## Phone install

Open the HTTPS URL, then:
- Android / Chrome / Edge: the **Install** button in the header, or "Add to Home screen".
- iPhone: Safari → Share → **Add to Home Screen**.

The app shell works offline, but logging needs the server, so you'll see an offline notice.
