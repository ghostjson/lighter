// Lighter front end. Plain ES modules, no build step.

const TRIGGERS = ['Coffee', 'After meal', 'Stress', 'Break', 'Social', 'Alcohol', 'Boredom', 'Driving'];
const DAY = 864e5;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  me: null,
  tab: 'today',
  range: '30',
  trigger: null,
  logDay: null,
  historyDays: 14,
};

// ---------- api ----------
class AuthError extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new AuthError('Signed out'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const getEntries = (from, to = Date.now() + DAY) => api(`/api/entries?from=${Math.floor(from)}&to=${Math.ceil(to)}`).then((d) => d.entries);

// ---------- dates ----------
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtShort = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtLong = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

function dayLabel(t) {
  const today = startOfDay(Date.now()).getTime();
  const d = startOfDay(t).getTime();
  if (d === today) return 'Today';
  if (d === today - DAY) return 'Yesterday';
  return new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function humanDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function countByDay(entries) {
  const map = new Map();
  for (const e of entries) map.set(dayKey(e.ts), (map.get(dayKey(e.ts)) || 0) + 1);
  return map;
}

// Average per day over complete days [fromDay, toDay], ignoring days before tracking began.
function avgOver(counts, fromDay, toDay, firstDay) {
  let total = 0, days = 0;
  for (let d = new Date(Math.max(fromDay, firstDay)); d <= toDay; d = addDays(d, 1)) { total += counts.get(dayKey(d)) || 0; days++; }
  return days ? { avg: total / days, days } : { avg: null, days: 0 };
}

// ---------- auth ----------
function showLogin() {
  state.me = null;
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  setTimeout(() => $('#login-form [name=username]').focus(), 0);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const err = $('#login-error');
  err.textContent = '';
  const btn = f.querySelector('button');
  btn.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value } });
    f.password.value = '';
    await boot();
  } catch (ex) {
    err.textContent = ex.message;
  } finally { btn.disabled = false; }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  $('#user-menu').hidden = true;
  showLogin();
});

$('#user-btn').addEventListener('click', (e) => {
  const m = $('#user-menu');
  m.hidden = !m.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.top-actions')) { $('#user-menu').hidden = true; $('#user-btn').setAttribute('aria-expanded', 'false'); }
});

async function boot() {
  try {
    state.me = await api('/api/me');
  } catch (e) {
    if (!(e instanceof AuthError)) showLogin();
    return;
  }
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-btn').textContent = state.me.user.name || state.me.user.username;
  $('#limit-input').value = state.me.settings.dailyLimit ?? '';
  setTab(location.hash.slice(1) || state.tab, false);
}

async function refreshMe() {
  state.me = await api('/api/me');
}

// ---------- tabs ----------
function setTab(tab, push = true) {
  if (!['today', 'trends', 'history'].includes(tab)) tab = 'today';
  state.tab = tab;
  for (const b of $$('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const p of $$('.page')) p.hidden = p.id !== `tab-${tab}`;
  if (push) history.replaceState(null, '', `#${tab}`);
  render();
}
$$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function render() {
  const fn = { today: renderToday, trends: renderTrends, history: renderHistory }[state.tab];
  fn().catch((e) => { if (!(e instanceof AuthError)) toast(e.message); });
}

// ---------- toast ----------
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  $('#toast-msg').textContent = msg;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.onclick = action ? async () => { t.hidden = true; await action.fn(); } : null;
  if (action) btn.textContent = action.label;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 7000 : 3500);
}

// ---------- today ----------
function buildChips() {
  const wrap = $('#trigger-chips');
  wrap.replaceChildren();
  for (const t of TRIGGERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = t;
    b.setAttribute('aria-pressed', String(state.trigger === t));
    b.addEventListener('click', () => {
      state.trigger = state.trigger === t ? null : t;
      for (const c of wrap.children) c.setAttribute('aria-pressed', String(c.textContent === state.trigger));
    });
    wrap.append(b);
  }
  const sel = $('#missed-trigger');
  sel.replaceChildren(new Option('None', ''), ...TRIGGERS.map((t) => new Option(t, t)));
}

let sinceTimer;
// The day the Today card is logging for: null = today, otherwise a past day (local midnight).
function logDay() {
  const today = startOfDay(Date.now());
  return state.logDay && state.logDay < today ? state.logDay : today;
}
function setLogDay(d) {
  const today = startOfDay(Date.now());
  d = startOfDay(d);
  state.logDay = d < today ? d : null;
  renderToday().catch((e) => { if (!(e instanceof AuthError)) toast(e.message); });
}

async function renderToday() {
  const today = startOfDay(Date.now());
  const day = logDay();
  const isToday = day.getTime() === today.getTime();
  const entries = await getEntries(Math.min(day.getTime(), addDays(today, -14).getTime()));
  const counts = countByDay(entries);
  const n = counts.get(dayKey(day)) || 0;
  const limit = state.me.settings.dailyLimit;
  const firstDay = state.me.firstEntryTs ? startOfDay(state.me.firstEntryTs) : today;

  // day picker
  const input = $('#day-input');
  input.value = dayKey(day);
  input.max = dayKey(today);
  $('#day-next').disabled = isToday;
  $('#day-today').hidden = isToday;
  $('.count-card').classList.toggle('past', !isToday);
  $('#log-btn').textContent = isToday ? 'Log a cigarette' : `Add one to ${fmtLong(day)}`;
  const when = isToday ? 'today' : 'that day';

  $('#today-count').textContent = n;
  const ring = $('#ring-fill');
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  const status = $('#today-status');
  status.classList.remove('over');
  if (limit != null) {
    const frac = limit === 0 ? (n > 0 ? 1 : 0) : Math.min(1, n / limit);
    ring.style.strokeDashoffset = C * (1 - frac);
    ring.classList.toggle('over', n > limit);
    $('#today-sub').textContent = `of ${limit} ${when}`;
    if (n < limit) status.textContent = isToday ? `${limit - n} left under your limit` : `${limit - n} under your limit that day`;
    else if (n === limit) status.textContent = isToday ? "That's your limit for today" : 'Right at your limit that day';
    else {
      status.textContent = isToday ? `${n - limit} over your limit. The count resets at midnight.` : `${n - limit} over your limit that day`;
      status.classList.add('over');
    }
  } else {
    ring.style.strokeDashoffset = C;
    ring.classList.remove('over');
    $('#today-sub').textContent = when;
    if (isToday) {
      const y = counts.get(dayKey(addDays(today, -1)));
      status.textContent = y != null ? `Yesterday: ${y}` : 'Set a daily limit to track progress against it';
    } else status.textContent = 'Tap the button once for each cigarette that day';
  }

  // since last
  const last = entries.length ? entries[entries.length - 1].ts : state.me.lastEntryTs;
  clearInterval(sinceTimer);
  const paintSince = () => {
    if (!last) { $('#since-last').textContent = '–'; $('#since-detail').textContent = 'Nothing logged yet'; return; }
    $('#since-last').textContent = humanDuration(Date.now() - last);
    const sameDay = dayKey(last) === dayKey(Date.now());
    $('#since-detail').textContent = `${sameDay ? 'at' : dayLabel(last) + ' at'} ${fmtTime(last)}`;
  };
  paintSince();
  sinceTimer = setInterval(paintSince, 30000);

  // last 7 complete days vs the 7 before
  const yest = addDays(today, -1);
  const a = avgOver(counts, addDays(today, -7), yest, firstDay);
  const b = avgOver(counts, addDays(today, -14), addDays(today, -8), firstDay);
  if (a.avg == null) { $('#week-avg').textContent = '–'; $('#week-detail').textContent = 'Shows after your first full day'; }
  else {
    $('#week-avg').textContent = `${fmt1(a.avg)} / day`;
    $('#week-detail').textContent = b.avg != null ? `vs ${fmt1(b.avg)} / day the week before` : `over ${a.days} day${a.days > 1 ? 's' : ''}`;
  }
}

$('#log-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const day = logDay();
    const isToday = day.getTime() === startOfDay(Date.now()).getTime();
    const body = { trigger: state.trigger };
    // Past day: use the current clock time on that day (it's always in the past).
    if (!isToday) body.ts = day.getTime() + (Date.now() - startOfDay(Date.now()).getTime());
    const { entry } = await api('/api/entries', { method: 'POST', body });
    await refreshMe();
    state.trigger = null;
    for (const c of $('#trigger-chips').children) c.setAttribute('aria-pressed', 'false');
    if (navigator.vibrate) navigator.vibrate(15);
    toast(isToday ? `Logged at ${fmtTime(entry.ts)}` : `Added to ${fmtLong(entry.ts)}`, { label: 'Undo', fn: () => removeEntry(entry.id, false) });
    await renderToday();
  } catch (ex) {
    if (!(ex instanceof AuthError)) toast(navigator.onLine ? ex.message : "You're offline, so this wasn't saved.");
  } finally { btn.disabled = false; }
});

$('#day-prev').addEventListener('click', () => setLogDay(addDays(logDay(), -1)));
$('#day-next').addEventListener('click', () => setLogDay(addDays(logDay(), 1)));
$('#day-today').addEventListener('click', () => setLogDay(Date.now()));
$('#day-input').addEventListener('change', (e) => {
  const [y, m, d] = e.target.value.split('-').map(Number);
  if (y && m && d) setLogDay(new Date(y, m - 1, d));
});

async function removeEntry(id, offerUndo = true, restore) {
  await api(`/api/entries/${id}`, { method: 'DELETE' });
  await refreshMe();
  if (offerUndo && restore) {
    toast('Entry deleted', { label: 'Undo', fn: async () => { await api('/api/entries', { method: 'POST', body: restore }); await refreshMe(); render(); } });
  } else if (!offerUndo) toast('Removed');
  render();
}

$('#limit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#limit-input').value.trim();
  try {
    const { settings } = await api('/api/settings', { method: 'PUT', body: { dailyLimit: v === '' ? null : Number(v) } });
    state.me.settings = settings;
    toast(settings.dailyLimit == null ? 'Daily limit cleared' : `Daily limit set to ${settings.dailyLimit}`);
    render();
  } catch (ex) { if (!(ex instanceof AuthError)) toast(ex.message); }
});

// ---------- trends ----------
$$('.seg button').forEach((b) => b.addEventListener('click', () => {
  state.range = b.dataset.range;
  $$('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  renderTrends();
}));

function linearSlope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return num / den;
}

async function renderTrends() {
  const today = startOfDay(Date.now());
  const limit = state.me.settings.dailyLimit;
  if (!state.me.firstEntryTs) {
    paintHeadline('neutral', 'No data yet', 'Log a few cigarettes and your trend shows up here.', '–');
    drawEmpty($('#trend-chart'), 'Nothing logged yet');
    drawEmpty($('#hour-chart'), 'Nothing logged yet');
    $('#chart-legend').replaceChildren();
    $('#trend-table').replaceChildren();
    ['#k-total', '#k-avg', '#k-low', '#k-under'].forEach((s) => ($(s).textContent = '–'));
    ['#k-low-d', '#k-under-d'].forEach((s) => ($(s).textContent = ''));
    return;
  }
  const firstDay = startOfDay(state.me.firstEntryTs);
  const rangeStart = state.range === 'all' ? firstDay : new Date(Math.max(addDays(today, -(Number(state.range) - 1)), firstDay));
  const fetchFrom = Math.min(rangeStart.getTime(), addDays(today, -14).getTime()) - 28 * DAY;
  const entries = await getEntries(fetchFrom);
  const counts = countByDay(entries);
  const yest = addDays(today, -1);

  // --- headline: last 7 complete days vs the 7 before
  const a = avgOver(counts, addDays(today, -7), yest, firstDay);
  const b = avgOver(counts, addDays(today, -14), addDays(today, -8), firstDay);

  // --- days in range
  const days = [];
  for (let d = new Date(rangeStart); d <= today; d = addDays(d, 1)) {
    const key = dayKey(d);
    const isToday = d.getTime() === today.getTime();
    // 7-day rolling average over complete days, only once tracking began
    let avg = null;
    if (!isToday) { const r = avgOver(counts, addDays(d, -6), d, firstDay); avg = r.avg; }
    days.push({ t: d.getTime(), count: counts.get(key) || 0, avg, isToday });
  }
  const complete = days.filter((d) => !d.isToday);

  // range-level slope (per week) for the subtitle
  const slopeWeek = complete.length >= 7 ? linearSlope(complete.map((d) => d.count)) * 7 : null;
  let rangeNote = '';
  if (slopeWeek != null) {
    rangeNote = Math.abs(slopeWeek) < 0.15 ? ' Over this range it has been roughly flat.'
      : ` Over this range: ${slopeWeek < 0 ? 'falling' : 'rising'} by about ${fmt1(Math.abs(slopeWeek))} a day each week.`;
  }

  if (a.days < 3) {
    paintHeadline('neutral', 'Building your baseline', `Keep logging. The week-on-week comparison appears after 3 full days.${rangeNote}`, 'New');
  } else if (b.days < 3) {
    paintHeadline('neutral', `${fmt1(a.avg)} a day lately`, `Average over the last ${a.days} full days. A comparison with the previous week appears next week.${rangeNote}`, 'New');
  } else {
    const pct = b.avg === 0 ? (a.avg === 0 ? 0 : 1) : (a.avg - b.avg) / b.avg;
    const dir = Math.abs(pct) < 0.05 ? 'flat' : pct < 0 ? 'down' : 'up';
    const pctTxt = `${Math.round(Math.abs(pct) * 100)}%`;
    const title = dir === 'flat' ? 'Holding steady' : dir === 'down' ? `Down ${pctTxt} from the week before` : `Up ${pctTxt} from the week before`;
    paintHeadline(dir, title, `${fmt1(a.avg)} a day over the last 7 days, vs ${fmt1(b.avg)} the 7 days before.${rangeNote}`,
      dir === 'flat' ? 'Steady' : dir === 'down' ? `${pctTxt} less` : `${pctTxt} more`);
  }

  // --- buckets: daily, or weekly when the range is long
  const weekly = days.length > 120;
  let items;
  if (!weekly) {
    items = days.map((d) => ({
      x: d.t, value: d.count, avg: d.avg, partial: d.isToday,
      title: d.isToday ? `Today (so far)` : fmtLong(d.t),
    }));
  } else {
    const groups = [];
    for (const d of days) {
      const wd = (new Date(d.t).getDay() + 6) % 7; // Monday start
      const wk = addDays(new Date(d.t), -wd).getTime();
      let g = groups[groups.length - 1];
      if (!g || g.wk !== wk) { g = { wk, total: 0, n: 0, t: d.t, partial: false }; groups.push(g); }
      g.total += d.count; g.n++; if (d.isToday) g.partial = true;
    }
    items = groups.map((g, i) => {
      const window = groups.slice(Math.max(0, i - 3), i + 1).filter((x) => !x.partial);
      const avg = window.length ? window.reduce((s, x) => s + x.total, 0) / window.reduce((s, x) => s + x.n, 0) : null;
      return { x: g.wk, value: g.total / g.n, avg: g.partial ? null : avg, partial: g.partial, title: `Week of ${fmtShort(g.t)}${g.partial ? ' (so far)' : ''}` };
    });
  }

  $('#chart-title').textContent = weekly ? 'Cigarettes per day, by week' : 'Cigarettes per day';
  const avgName = weekly ? '4-week average' : '7-day average';
  const legend = $('#chart-legend');
  legend.replaceChildren(
    legendItem('key-rect', 'var(--series-1)', weekly ? 'Daily average that week' : 'Per day'),
    legendItem('key-line', 'var(--series-2)', avgName),
    ...(limit != null ? [legendItem('key-dash', null, 'Daily limit')] : []),
  );
  $('#trend-chart').setAttribute('aria-label',
    `Bar chart of cigarettes per ${weekly ? 'day, averaged by week' : 'day'} from ${fmtShort(items[0].x)} to today, with a ${avgName} line.`);

  barChart($('#trend-chart'), $('#chart-tip'), items, {
    limit,
    avgLabel: avgName,
    valueLabel: weekly ? 'per day' : 'cigarettes',
    fmtValue: (v) => (weekly ? fmt1(v) : String(v)),
    xLabel: (it) => fmtShort(it.x),
  });

  // table
  const table = $('#trend-table');
  const head = document.createElement('tr');
  for (const h of [weekly ? 'Week of' : 'Day', weekly ? 'Per day' : 'Count', avgName]) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
  const rows = [...items].reverse().map((it) => {
    const tr = document.createElement('tr');
    for (const v of [it.title, weekly ? fmt1(it.value) : it.value, it.avg == null ? '–' : fmt1(it.avg)]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    return tr;
  });
  const thead = document.createElement('thead'); thead.append(head);
  const tbody = document.createElement('tbody'); tbody.append(...rows);
  table.replaceChildren(thead, tbody);

  // KPIs
  const total = days.reduce((s, d) => s + d.count, 0);
  $('#k-total').textContent = total.toLocaleString();
  const basis = complete.length ? complete : days;
  $('#k-avg').textContent = fmt1(basis.reduce((s, d) => s + d.count, 0) / basis.length);
  if (complete.length) {
    const low = complete.reduce((m, d) => (d.count < m.count ? d : m), complete[0]);
    $('#k-low').textContent = low.count; $('#k-low-d').textContent = fmtLong(low.t);
  } else { $('#k-low').textContent = '–'; $('#k-low-d').textContent = 'needs a full day'; }
  if (limit != null && complete.length) {
    const under = complete.filter((d) => d.count <= limit).length;
    $('#k-under').textContent = `${under} / ${complete.length}`;
    $('#k-under-d').textContent = `at today's limit of ${limit}`;
  } else { $('#k-under').textContent = '–'; $('#k-under-d').textContent = limit == null ? 'no limit set' : 'needs a full day'; }

  // time of day
  const inRange = entries.filter((e) => e.ts >= rangeStart.getTime());
  const hours = Array.from({ length: 24 }, () => 0);
  for (const e of inRange) hours[new Date(e.ts).getHours()]++;
  const nDays = days.length;
  const hourItems = hours.map((c, h) => ({
    x: h, value: c / nDays, avg: null,
    title: `${new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })} – ${new Date(2000, 0, 1, (h + 1) % 24).toLocaleTimeString([], { hour: 'numeric' })}`,
  }));
  $('#hour-chart').setAttribute('aria-label', 'Bar chart of average cigarettes per day by hour of day.');
  barChart($('#hour-chart'), $('#chart-tip'), hourItems, {
    valueLabel: 'per day', fmtValue: (v) => (v < 0.05 && v > 0 ? '<0.1' : fmt1(v)),
    xLabel: (it) => (it.x % 6 === 0 ? new Date(2000, 0, 1, it.x).toLocaleTimeString([], { hour: 'numeric' }) : ''),
    labelEvery: 1, decimals: true,
  });
}

function paintHeadline(dir, title, sub, badge) {
  const el = $('#trend-badge');
  el.className = `trend-badge ${dir === 'down' ? 'down' : dir === 'up' ? 'up' : ''}`;
  const icon = dir === 'down' ? 'M8 3v10M3.5 8.5 8 13l4.5-4.5' : dir === 'up' ? 'M8 13V3M3.5 7.5 8 3l4.5 4.5' : 'M3 8h10';
  el.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"/></svg>`;
  el.append(document.createTextNode(badge));
  $('#trend-title').textContent = title;
  $('#trend-sub').textContent = sub;
}

function legendItem(kind, color, label) {
  const s = document.createElement('span');
  s.className = 'legend-item';
  const k = document.createElement('span');
  k.className = kind;
  if (color) k.style.background = color;
  s.append(k, document.createTextNode(label));
  return s;
}

// ---------- chart ----------
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}

function niceMax(v, decimals) {
  if (v <= 0) return decimals ? 1 : 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) {
    const max = m * exp;
    return decimals ? max : Math.max(4, Math.ceil(max));
  }
  return v;
}

function drawEmpty(container, msg) {
  chartRegistry.delete(container);
  container.replaceChildren();
  const w = container.clientWidth || 300, h = container.clientHeight || 200;
  const svg = el('svg', { width: w, height: h }, container);
  const t = el('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'empty' }, svg);
  t.textContent = msg;
}

const chartRegistry = new Map();
function barChart(container, tip, items, opts) {
  chartRegistry.set(container, () => barChart(container, tip, items, opts));
  container.replaceChildren();
  const W = container.clientWidth, H = container.clientHeight;
  drawnWidth.set(container, W);
  if (!W || !items.length) return;
  const m = { l: 34, r: 10, t: 14, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = items.length;
  const band = pw / n;
  const gap = band > 8 ? 2 : band > 3 ? 1 : 0;
  const bw = Math.max(1, band - gap);

  const maxVal = Math.max(...items.map((d) => d.value), ...items.map((d) => d.avg ?? 0), opts.limit ?? 0);
  const yMax = niceMax(maxVal * 1.08, opts.decimals);
  const y = (v) => m.t + ph - (v / yMax) * ph;
  const xc = (i) => m.l + band * (i + 0.5);

  const svg = el('svg', { width: W, height: H, tabindex: 0, focusable: 'true' }, container);

  // grid + y labels
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const yy = Math.round(y(v)) + 0.5;
    if (i > 0) el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'gridline' }, svg);
    const t = el('text', { x: m.l - 8, y: yy + 3.5, 'text-anchor': 'end' }, svg);
    t.textContent = opts.decimals ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Math.round(v);
  }

  // hover column (behind marks)
  const hover = el('rect', { y: m.t, height: ph, width: band, class: 'hover-col' }, svg);

  // bars: rounded data end (top), flat on the baseline
  for (let i = 0; i < n; i++) {
    const d = items[i];
    if (d.value <= 0) continue;
    const x = m.l + band * i + gap / 2, top = y(d.value), h = m.t + ph - top;
    const r = Math.min(4, bw / 2, h);
    const p = `M${x},${m.t + ph} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ph} Z`;
    el('path', { d: p, class: `bar${d.partial ? ' dim' : ''}` }, svg);
  }
  el('line', { x1: m.l, x2: W - m.r, y1: m.t + ph + 0.5, y2: m.t + ph + 0.5, class: 'baseline' }, svg);

  // limit reference line
  if (opts.limit != null) {
    const ly = Math.round(y(opts.limit)) + 0.5;
    el('line', { x1: m.l, x2: W - m.r, y1: ly, y2: ly, class: 'limit' }, svg);
    const t = el('text', { x: W - m.r, y: ly - 5, 'text-anchor': 'end', class: 'limit-label' }, svg);
    t.textContent = `Limit ${opts.limit}`;
  }

  // rolling average line (breaks on gaps)
  let dStr = '', pen = false, lastPt = null;
  items.forEach((d, i) => {
    if (d.avg == null) { pen = false; return; }
    dStr += `${pen ? 'L' : 'M'}${xc(i).toFixed(1)},${y(d.avg).toFixed(1)}`;
    pen = true; lastPt = [xc(i), y(d.avg)];
  });
  if (dStr) {
    el('path', { d: dStr, class: 'avg' }, svg);
    el('circle', { cx: lastPt[0], cy: lastPt[1], r: 4, class: 'avg-ring' }, svg);
  }

  // x labels
  const every = opts.labelEvery || Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 64))));
  for (let i = n - 1; i >= 0; i -= every) {
    const lbl = opts.xLabel(items[i]);
    if (!lbl) continue;
    const t = el('text', { x: xc(i), y: H - 8, 'text-anchor': 'middle' }, svg);
    t.textContent = lbl;
  }

  // interaction: one tooltip per column, pointer and keyboard
  let active = -1;
  const show = (i) => {
    active = i;
    const d = items[i];
    hover.setAttribute('x', m.l + band * i);
    hover.classList.add('on');
    tip.replaceChildren();
    const date = document.createElement('div'); date.className = 'tip-date'; date.textContent = d.title; tip.append(date);
    const row = (keyStyle, val, label, dashed) => {
      const r = document.createElement('div'); r.className = 'tip-row';
      const k = document.createElement('span'); k.className = `tip-key${dashed ? ' dash' : ''}`; k.style.borderColor = keyStyle;
      const s = document.createElement('strong'); s.textContent = val;
      const l = document.createElement('span'); l.textContent = label;
      r.append(k, s, l); tip.append(r);
    };
    row('var(--series-1)', opts.fmtValue(d.value), opts.valueLabel);
    if (opts.avgLabel) row('var(--series-2)', d.avg == null ? '–' : fmt1(d.avg), opts.avgLabel);
    if (opts.limit != null) row('var(--ref)', String(opts.limit), 'limit', true);
    // keep the tip inside this chart's own wrapper so it positions against it
    if (tip.parentElement !== container.parentElement) container.parentElement.append(tip);
    tip.hidden = false;
    const root = container.parentElement.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const tw = tip.offsetWidth;
    let left = box.left - root.left + xc(i) + 12;
    if (left + tw > root.width) left = box.left - root.left + xc(i) - tw - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${box.top - root.top + m.t}px`;
  };
  const hide = () => { active = -1; hover.classList.remove('on'); tip.hidden = true; };
  const idxAt = (clientX) => {
    const x = clientX - svg.getBoundingClientRect().left - m.l;
    return Math.min(n - 1, Math.max(0, Math.floor(x / band)));
  };
  svg.addEventListener('pointermove', (e) => show(idxAt(e.clientX)));
  svg.addEventListener('pointerdown', (e) => show(idxAt(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(n - 1));
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { show(Math.max(0, (active < 0 ? n : active) - 1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(Math.min(n - 1, active + 1)); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });
}

// Redraw a chart only when its own width changes (or it becomes visible again).
const drawnWidth = new WeakMap();
let resizeRaf;
const chartObserver = new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    for (const [c, redraw] of chartRegistry) {
      const w = c.clientWidth;
      if (w && drawnWidth.get(c) !== w) redraw();
    }
  });
});
for (const c of $$('.chart')) chartObserver.observe(c);

// ---------- history ----------
async function renderHistory() {
  const today = startOfDay(Date.now());
  const from = addDays(today, -(state.historyDays - 1));
  const entries = await getEntries(from.getTime());
  const limit = state.me.settings.dailyLimit;
  const list = $('#history-list');
  list.replaceChildren();

  const groups = new Map();
  for (const e of [...entries].reverse()) {
    const k = dayKey(e.ts);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  if (!groups.size) {
    const p = document.createElement('p'); p.className = 'empty-state';
    p.textContent = `Nothing logged in the last ${state.historyDays} days.`;
    list.append(p);
  }
  for (const [, items] of groups) {
    const g = document.createElement('section'); g.className = 'day-group';
    const head = document.createElement('div'); head.className = 'day-head';
    const h = document.createElement('h2'); h.textContent = dayLabel(items[0].ts);
    const c = document.createElement('span');
    c.className = `day-count${limit != null && items.length > limit ? ' over' : ''}`;
    c.textContent = `${items.length} ${items.length === 1 ? 'cigarette' : 'cigarettes'}${limit != null && items.length > limit ? ` · ${items.length - limit} over limit` : ''}`;
    head.append(h, c);
    const ul = document.createElement('ul'); ul.className = 'entry-list';
    for (const e of items) {
      const li = document.createElement('li'); li.className = 'entry';
      const t = document.createElement('span'); t.className = 'entry-time'; t.textContent = fmtTime(e.ts);
      const meta = document.createElement('span'); meta.className = 'entry-meta';
      if (e.trigger) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = e.trigger; meta.append(tag); }
      if (e.note) meta.append(document.createTextNode(e.note));
      const del = document.createElement('button');
      del.className = 'icon-btn'; del.setAttribute('aria-label', `Delete entry at ${fmtTime(e.ts)}`);
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
      del.addEventListener('click', () => removeEntry(e.id, true, { ts: e.ts, trigger: e.trigger, note: e.note }).catch((ex) => toast(ex.message)));
      li.append(t, meta, del);
      ul.append(li);
    }
    g.append(head, ul);
    list.append(g);
  }
  const more = $('#history-more');
  more.hidden = !state.me.firstEntryTs || from.getTime() <= startOfDay(state.me.firstEntryTs).getTime();
}

$('#history-more').addEventListener('click', () => { state.historyDays += 14; renderHistory(); });

function toLocalInput(t) {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
$('#add-missed-btn').addEventListener('click', () => {
  const f = $('#missed-form');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    $('#missed-when').value = toLocalInput(Date.now() - 30 * 60000);
    $('#missed-when').max = toLocalInput(Date.now());
    $('#missed-when').focus();
  }
});
$('#missed-cancel').addEventListener('click', () => ($('#missed-form').hidden = true));
$('#missed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ts = new Date($('#missed-when').value).getTime();
  if (!Number.isFinite(ts)) return toast('Pick a date and time');
  if (ts > Date.now() + 60000) return toast("That's in the future");
  try {
    await api('/api/entries', { method: 'POST', body: { ts, trigger: $('#missed-trigger').value || null, note: $('#missed-note').value || null } });
    $('#missed-form').hidden = true;
    $('#missed-note').value = '';
    await refreshMe();
    const age = Math.ceil((Date.now() - ts) / DAY) + 1;
    if (age > state.historyDays) state.historyDays = Math.ceil(age / 14) * 14;
    toast(`Added for ${fmtLong(ts)} at ${fmtTime(ts)}`);
    renderHistory();
  } catch (ex) { if (!(ex instanceof AuthError)) toast(ex.message); }
});

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#install-btn').hidden = false; });
$('#install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#install-btn').hidden = true;
});
const syncOnline = () => ($('#offline-banner').hidden = navigator.onLine);
window.addEventListener('online', () => { syncOnline(); if (state.me) render(); });
window.addEventListener('offline', syncOnline);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) render(); });

// ---------- start ----------
buildChips();
syncOnline();
boot();
