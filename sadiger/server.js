import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool, query, one, migrate, getSettings, DEFAULT_SETTINGS } from './lib/db.js';
import { emailConfigured, emailMode } from './lib/mail.js';
import { parseHolderFile, templateWorkbook, holdersWorkbook, collectionsWorkbook, toIsoDate } from './lib/excel.js';
import {
  listHolders, createReceipt, emailReceipt, receiptPdfById, receiptsForRange, monthRange, monthName,
  monthlyWorkbook, sendMonthlyReport, runMonthlyIfDue, yearStatement, emailYearStatement,
  todayIso, previousMonth, httpError,
} from './lib/services.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === 'production';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false }));

const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  name: 'sadiger.sid',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth ----------
const attempts = new Map(); // simple login rate limit: ip -> {n, until}
function limited(ip) {
  const a = attempts.get(ip);
  return a && a.n >= 8 && a.until > Date.now();
}
function noteFail(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n = a.until > Date.now() ? a.n + 1 : 1;
  a.until = Date.now() + 15 * 60 * 1000;
  attempts.set(ip, a);
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', wrap(async (req, res) => {
  if (limited(req.ip)) return res.redirect('/login?error=locked');
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await one('select * from users where lower(email)=$1', [email]);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    noteFail(req.ip);
    return res.redirect('/login?error=1');
  }
  attempts.delete(req.ip);
  req.session.regenerate((err) => {
    if (err) return res.redirect('/login?error=1');
    req.session.userId = user.id;
    res.redirect('/');
  });
}));
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// Scheduled trigger for hosts that sleep when idle (call from an external cron).
app.all('/cron/monthly', wrap(async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const r = await runMonthlyIfDue();
  res.json({ ran: !!r, result: r });
}));

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: isProd ? '1h' : 0 }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Everything below requires login.
app.use(wrap(async (req, res, next) => {
  const user = req.session.userId && (await one('select id, email, name from users where id=$1', [req.session.userId]));
  if (!user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please log in again.' });
    return res.redirect('/login');
  }
  req.user = user;
  next();
}));

// CSRF protection: state-changing API calls must carry a custom header (cross-site forms can't).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: 'Bad request' });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ---------- API ----------
const api = express.Router();
app.use('/api', api);

api.get('/me', wrap(async (req, res) => {
  res.json({ user: req.user, email: { configured: emailConfigured(), mode: emailMode() }, today: todayIso() });
}));

api.post('/me/password', wrap(async (req, res) => {
  const { current, next: nextPw } = req.body;
  const u = await one('select * from users where id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw httpError(400, 'Current password is wrong.');
  if (String(nextPw || '').length < 10) throw httpError(400, 'New password must be at least 10 characters.');
  await query('update users set password_hash=$2 where id=$1', [u.id, await bcrypt.hash(nextPw, 12)]);
  res.json({ ok: true });
}));

// Users
api.get('/users', wrap(async (req, res) => res.json(await query('select id, email, name, created_at from users order by id'))));
api.post('/users', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter a valid email.');
  if (password.length < 10) throw httpError(400, 'Password must be at least 10 characters.');
  if (await one('select 1 from users where lower(email)=$1', [email])) throw httpError(400, 'That email already has an account.');
  const u = await one('insert into users(email, name, password_hash) values ($1,$2,$3) returning id, email, name',
    [email, name, await bcrypt.hash(password, 12)]);
  res.json(u);
}));
api.delete('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw httpError(400, "You can't remove your own account.");
  await query('delete from users where id=$1', [id]);
  res.json({ ok: true });
}));

// Settings
const IMAGE_KEYS = ['logo', 'signature'];
api.get('/settings', wrap(async (req, res) => res.json(await getSettings())));
api.put('/settings', wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULT_SETTINGS) || IMAGE_KEYS.includes(k)) continue;
    let val = String(v ?? '').trim();
    if (k === 'receipt_start' && !/^\d+$/.test(val)) throw httpError(400, 'Starting receipt number must be a whole number.');
    if ((k === 'overdue_days' || k === 'due_soon_days') && !/^\d+$/.test(val)) throw httpError(400, 'Days must be a whole number.');
    if ((k === 'israel_email' || k === 'report_cc' || k === 'email') && val) {
      const list = val.split(/[,;\s]+/).filter(Boolean);
      if (!list.every((e) => /^\S+@\S+\.\S+$/.test(e))) throw httpError(400, `Check the email address: ${val}`);
      val = list.join(', ');
    }
    await query('insert into settings(key,value) values ($1,$2) on conflict (key) do update set value=$2', [k, val]);
  }
  res.json(await getSettings());
}));
api.post('/settings/image/:kind', upload.single('file'), wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!IMAGE_KEYS.includes(kind)) throw httpError(404, 'Unknown image');
  let value = '';
  if (req.file) {
    if (!/^image\/(png|jpeg)$/.test(req.file.mimetype)) throw httpError(400, 'Please upload a PNG or JPG image.');
    if (req.file.size > 1024 * 1024) throw httpError(400, 'Image must be under 1 MB.');
    value = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }
  await query('insert into settings(key,value) values ($1,$2) on conflict (key) do update set value=$2', [kind, value]);
  res.json({ ok: true });
}));

// Dashboard
api.get('/dashboard', wrap(async (req, res) => {
  const holders = await listHolders();
  const year = todayIso().slice(0, 4);
  const yr = await one(`select coalesce(sum(amount),0) as total, count(*)::int as n from receipts
                        where not voided and extract(year from collected_on)=$1`, [year]);
  const recent = await query(`select id, receipt_no, donor_name, collected_on, amount, email_status
                              from receipts where not voided order by created_at desc limit 8`);
  res.json({
    year, boxes: holders.length, yearTotal: yr.total, receiptsYear: yr.n,
    dueCount: holders.filter((h) => h.status !== 'ok').length,
    due: holders.filter((h) => h.status !== 'ok').sort((a, b) => b.days_since - a.days_since).slice(0, 10),
    recent,
  });
}));

// Holders
const HOLDER_FIELDS = ['box_no', 'first_name', 'last_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_given', 'notes'];
function cleanHolder(b) {
  const h = {};
  for (const f of HOLDER_FIELDS) h[f] = String(b[f] ?? '').trim();
  if (!h.first_name) throw httpError(400, 'First name is required.');
  if (h.email && !/^\S+@\S+\.\S+$/.test(h.email)) throw httpError(400, 'That email address does not look right.');
  h.state = h.state.toUpperCase();
  h.box_no = h.box_no || null;
  h.date_given = h.date_given ? toIsoDate(h.date_given) : null;
  return h;
}
const dupBox = (err) => {
  if (err.code === '23505') throw httpError(400, 'Another box holder already has that box number.');
  throw err;
};

api.get('/holders', wrap(async (req, res) => res.json(await listHolders({ includeInactive: req.query.all === '1' }))));
api.get('/holders/:id', wrap(async (req, res) => {
  const h = await one('select * from holders where id=$1', [req.params.id]);
  if (!h) throw httpError(404, 'Not found');
  h.receipts = await query('select * from receipts where holder_id=$1 order by collected_on desc, id desc', [h.id]);
  res.json(h);
}));
api.post('/holders', wrap(async (req, res) => {
  const h = cleanHolder(req.body);
  const cols = Object.keys(h);
  const row = await one(`insert into holders(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
    Object.values(h)).catch(dupBox);
  res.json(row);
}));
api.put('/holders/:id', wrap(async (req, res) => {
  const h = cleanHolder(req.body);
  const cols = Object.keys(h);
  const row = await one(`update holders set ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} where id=$1 returning *`,
    [req.params.id, ...Object.values(h)]).catch(dupBox);
  if (!row) throw httpError(404, 'Not found');
  res.json(row);
}));
api.post('/holders/:id/active', wrap(async (req, res) => {
  const row = await one('update holders set active=$2 where id=$1 returning *', [req.params.id, !!req.body.active]);
  res.json(row);
}));
api.get('/holders/:id/statement/:year.pdf', wrap(async (req, res) => {
  const { holder, pdf } = await yearStatement(Number(req.params.id), Number(req.params.year));
  res.type('pdf').set('Content-Disposition', `inline; filename="${req.params.year}-Statement-${holder.last_name || holder.first_name}.pdf"`).send(pdf);
}));

// Pickups / receipts
api.post('/holders/:id/pickups', wrap(async (req, res) => {
  const r = await createReceipt({
    holderId: Number(req.params.id), amount: req.body.amount, collectedOn: req.body.collected_on,
    countedBy: req.body.counted_by, note: req.body.note, userId: req.user.id,
  });
  let email = null;
  if (req.body.send_email) email = await emailReceipt(r.id);
  res.json({ receipt: await one('select * from receipts where id=$1', [r.id]), email });
}));
api.get('/receipts', wrap(async (req, res) => {
  const year = Number(req.query.year) || Number(todayIso().slice(0, 4));
  res.json(await receiptsForRange(`${year}-01-01`, `${year + 1}-01-01`));
}));
api.get('/receipts/:id.pdf', wrap(async (req, res) => {
  const { receipt, pdf } = await receiptPdfById(Number(req.params.id));
  res.type('pdf').set('Content-Disposition', `inline; filename="Sadiger-Receipt-${receipt.receipt_no}.pdf"`).send(pdf);
}));
api.post('/receipts/:id/email', wrap(async (req, res) => {
  const to = String(req.body.to || '').trim();
  if (to && !/^\S+@\S+\.\S+$/.test(to)) throw httpError(400, 'That email address does not look right.');
  res.json(await emailReceipt(Number(req.params.id), to || undefined));
}));
api.post('/receipts/:id/void', wrap(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw httpError(400, 'Please give a reason for voiding.');
  const r = await one('update receipts set voided=true, void_reason=$2 where id=$1 and not voided returning *', [req.params.id, reason]);
  if (!r) throw httpError(400, 'Receipt not found or already voided.');
  res.json(r);
}));

// Year-end statements: email everyone who gave that year
api.post('/statements/:year/email', wrap(async (req, res) => {
  const year = Number(req.params.year);
  const ids = await query(`select distinct holder_id from receipts where not voided and extract(year from collected_on)=$1`, [year]);
  const result = { sent: 0, noEmail: 0, failed: [] };
  for (const { holder_id } of ids) {
    const r = await emailYearStatement(holder_id, year);
    if (r.ok) result.sent++;
    else if (r.error === 'No email address') result.noEmail++;
    else if (!r.skipped) result.failed.push(r.error);
  }
  res.json(result);
}));

// Import / export
api.get('/import/template', wrap(async (req, res) => {
  res.type(XLSX_TYPE).set('Content-Disposition', 'attachment; filename="Sadiger-Import-Template.xlsx"').send(Buffer.from(await templateWorkbook()));
}));
api.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a file to import.');
  const { rows, errors } = await parseHolderFile(req.file.buffer, req.file.originalname);
  let added = 0;
  let updated = 0;
  for (const [i, raw] of rows.entries()) {
    try {
      const h = cleanHolder(raw);
      // Match an existing holder by box number, else by name + address.
      const existing = (h.box_no && await one('select id from holders where box_no=$1', [h.box_no]))
        || await one(`select id from holders where lower(first_name)=lower($1) and lower(last_name)=lower($2) and lower(address)=lower($3)`,
          [h.first_name, h.last_name, h.address]);
      const cols = Object.keys(h).filter((c) => h[c] !== null && h[c] !== '');
      if (existing) {
        if (cols.length) await query(`update holders set ${cols.map((c, j) => `${c}=$${j + 2}`).join(',')} where id=$1`, [existing.id, ...cols.map((c) => h[c])]);
        updated++;
      } else {
        await query(`insert into holders(${cols.join(',')}) values (${cols.map((_, j) => '$' + (j + 1)).join(',')})`, cols.map((c) => h[c]));
        added++;
      }
    } catch (err) {
      errors.push(`${raw.first_name || ''} ${raw.last_name || ''} (data row ${i + 1}): ${err.message}`);
    }
  }
  res.json({ added, updated, errors });
}));
api.get('/export', wrap(async (req, res) => {
  const what = req.query.what;
  let buf;
  let name;
  if (what === 'holders') {
    buf = await holdersWorkbook(await listHolders({ includeInactive: true }));
    name = `Sadiger-Box-Holders-${todayIso()}.xlsx`;
  } else if (what === 'month') {
    const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : previousMonth();
    buf = (await monthlyWorkbook(month)).buffer;
    name = `Sadiger-Collections-${month}.xlsx`;
  } else if (what === 'year') {
    const year = Number(req.query.year) || Number(todayIso().slice(0, 4));
    buf = (await collectionsWorkbook(`Sadiger receipts ${year}`, await receiptsForRange(`${year}-01-01`, `${year + 1}-01-01`))).buffer;
    name = `Sadiger-Receipts-${year}.xlsx`;
  } else throw httpError(400, 'Unknown export');
  res.type(XLSX_TYPE).set('Content-Disposition', `attachment; filename="${name}"`).send(Buffer.from(buf));
}));

// Monthly report to Israel
api.get('/reports', wrap(async (req, res) => {
  const sends = await query('select * from report_sends order by sent_at desc limit 36');
  const s = await getSettings();
  const [y, m] = todayIso().split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  res.json({ sends, nextAuto: s.report_auto === '1' ? nextMonth : null, nextAutoMonth: monthName(todayIso().slice(0, 7)), previousMonth: previousMonth() });
}));
api.post('/reports/send', wrap(async (req, res) => {
  const month = String(req.body.month || previousMonth());
  const row = await sendMonthlyReport(month, 'manual');
  if (row.status !== 'sent') return res.status(400).json({ error: row.error, row });
  res.json(row);
}));

// ---------- Errors ----------
app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status === 500) console.error(err);
  const msg = status === 500 ? 'Something went wrong. Please try again.' : err.message;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: msg });
  res.status(status).send(msg);
});

// ---------- Start ----------
async function ensureFirstAdmin() {
  const n = await one('select count(*)::int as n from users');
  if (n.n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || pw.length < 10) {
    console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) and restart to create the first login.');
    return;
  }
  await query('insert into users(email, name, password_hash) values ($1,$2,$3)', [email, 'Administrator', await bcrypt.hash(pw, 12)]);
  console.log(`Created first admin login: ${email}`);
}

export async function start(port = Number(process.env.PORT) || 3000) {
  await migrate();
  await ensureFirstAdmin();
  const server = app.listen(port, () => console.log(`Sadiger charity boxes running on port ${port} (email: ${emailMode()})`));
  if (process.env.DISABLE_SCHEDULER !== '1') {
    const tick = () => runMonthlyIfDue()
      .then((r) => r && console.log(`Monthly report ${r.month}: ${r.status} ${r.error}`))
      .catch((e) => console.error('Monthly report check failed:', e.message));
    setTimeout(tick, 60 * 1000);
    setInterval(tick, 60 * 60 * 1000);
  }
  return server;
}

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
