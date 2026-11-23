import { query, one, tx, getSettings } from './db.js';
import { receiptPdf, statementPdf, money, longDate } from './pdf.js';
import { collectionsWorkbook } from './excel.js';
import { sendMail, escapeHtml, emailConfigured } from './mail.js';

export const todayIso = () => {
  // Dates follow US Eastern time so a late-evening pickup isn't dated "tomorrow".
  const tz = process.env.TZ_DISPLAY || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};

export const fullAddress = (h) =>
  [h.address, [[h.city, h.state].filter(Boolean).join(', '), h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Holders with last pickup, totals and visit status. */
export async function listHolders({ includeInactive = false } = {}) {
  const s = await getSettings();
  const year = Number(todayIso().slice(0, 4));
  const rows = await query(`
    select h.*,
      (select max(collected_on) from receipts r where r.holder_id = h.id and not r.voided) as last_pickup,
      coalesce((select sum(amount) from receipts r where r.holder_id = h.id and not r.voided
                and extract(year from collected_on) = $1), 0) as year_total,
      coalesce((select sum(amount) from receipts r where r.holder_id = h.id and not r.voided), 0) as all_total,
      (select count(*)::int from receipts r where r.holder_id = h.id and not r.voided) as pickups
    from holders h
    where ($2 or h.active)
    order by h.last_name, h.first_name`, [year, includeInactive]);
  const today = new Date(todayIso() + 'T00:00:00Z');
  const over = Number(s.overdue_days) || 90;
  const soon = Number(s.due_soon_days) || 60;
  for (const h of rows) {
    const since = h.last_pickup || h.date_given || h.created_at.toISOString().slice(0, 10);
    h.days_since = Math.max(0, Math.round((today - new Date(since + 'T00:00:00Z')) / 864e5));
    h.status = h.days_since >= over ? 'over' : h.days_since >= soon ? 'due' : 'ok';
  }
  return rows;
}

async function nextReceiptNo(db, year) {
  const s = await getSettings();
  const start = Math.max(1, parseInt(s.receipt_start, 10) || 1);
  const row = await db.one(
    `insert into receipt_counters(year, last_no) values ($1, $2)
     on conflict (year) do update set last_no = receipt_counters.last_no + 1
     returning last_no`, [year, start]);
  return `${year}-${String(row.last_no).padStart(4, '0')}`;
}

/** Record a pickup and create its receipt (numbered atomically). */
export async function createReceipt({ holderId, amount, collectedOn, countedBy, note, userId }) {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0)) throw httpError(400, 'Enter the amount counted (more than $0).');
  if (amt > 1_000_000) throw httpError(400, 'That amount looks too large – please check it.');
  const date = collectedOn || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Invalid date.');
  if (date > todayIso()) throw httpError(400, 'The pickup date cannot be in the future.');

  return tx(async (db) => {
    const h = await db.one('select * from holders where id = $1', [holderId]);
    if (!h) throw httpError(404, 'Box holder not found.');
    // Number receipts by the year they are issued, so numbers always go up.
    const receiptNo = await nextReceiptNo(db, Number(todayIso().slice(0, 4)));
    return db.one(
      `insert into receipts(receipt_no, holder_id, collected_on, amount, counted_by, note,
         donor_name, donor_address, donor_email, box_no, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [receiptNo, h.id, date, amt, countedBy || '', note || '',
        `${h.first_name} ${h.last_name}`.trim(), fullAddress(h), h.email, h.box_no || '', userId || null]);
  });
}

export async function receiptPdfById(id) {
  const r = await one('select * from receipts where id = $1', [id]);
  if (!r) throw httpError(404, 'Receipt not found.');
  return { receipt: r, pdf: await receiptPdf(r, await getSettings()) };
}

/** Email a receipt PDF to the donor. Records the outcome on the receipt. */
export async function emailReceipt(id, toOverride) {
  const s = await getSettings();
  const { receipt: r, pdf } = await receiptPdfById(id);
  if (r.voided) throw httpError(400, 'This receipt was voided and cannot be sent.');
  const to = toOverride || r.donor_email;
  try {
    if (!to) throw new Error('This box holder has no email address.');
    const first = r.donor_name.split(' ')[0];
    await sendMail({
      to,
      replyTo: s.email || undefined,
      subject: `Your donation receipt from ${s.org_name} – ${money(r.amount)}`,
      text: `Dear ${first},\n\nThank you for your donation of ${money(r.amount)}, collected from your charity box on ${longDate(r.collected_on)}.\n\nYour tax-deductible receipt (No. ${r.receipt_no}) is attached. Please keep it for your records.\n\n${s.thank_you}\n\n${s.org_name}\n${s.website}`,
      html: `<p>Dear ${escapeHtml(first)},</p><p>Thank you for your donation of <b>${money(r.amount)}</b>, collected from your charity box on ${longDate(r.collected_on)}.</p><p>Your tax-deductible receipt (No. ${escapeHtml(r.receipt_no)}) is attached. Please keep it for your records.</p><p>${escapeHtml(s.thank_you)}</p><p>${escapeHtml(s.org_name)}<br>${escapeHtml(s.website)}</p>`,
      attachments: [{ filename: `Sadiger-Receipt-${r.receipt_no}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    await query(`update receipts set email_status='sent', email_error='', emailed_at=now() where id=$1`, [id]);
    return { ok: true, to };
  } catch (err) {
    await query(`update receipts set email_status='failed', email_error=$2 where id=$1`, [id, err.message]);
    return { ok: false, error: err.message };
  }
}

export async function receiptsForRange(from, to) {
  return query(`select * from receipts where collected_on >= $1 and collected_on < $2 order by collected_on, receipt_no`, [from, to]);
}

export const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [`${month}-01`, next];
};
export const monthName = (month) =>
  new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const previousMonth = () => {
  const [y, m] = todayIso().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export async function monthlyWorkbook(month) {
  const rows = await receiptsForRange(...monthRange(month));
  return collectionsWorkbook(`Sadiger collections ${monthName(month)}`, rows);
}

/** Build the month's Excel report and email it to the administration in Israel. */
export async function sendMonthlyReport(month, trigger = 'manual') {
  if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, 'Invalid month.');
  const s = await getSettings();
  const recipients = [s.israel_email, s.report_cc].filter(Boolean).join(', ');
  const { buffer, count, total } = await monthlyWorkbook(month);
  let status = 'sent';
  let error = '';
  try {
    if (!s.israel_email) throw new Error('No email address set for the administration in Israel (Import / Export page).');
    await sendMail({
      to: s.israel_email,
      cc: s.report_cc || undefined,
      replyTo: s.email || undefined,
      subject: `${s.org_name} – charity box collections, ${monthName(month)}`,
      text: `Attached is the charity box collections report for ${monthName(month)}.\n\nPickups: ${count}\nTotal collected: ${money(total)}\n\n${s.org_name} (US)\n${s.website}`,
      html: `<p>Attached is the charity box collections report for <b>${monthName(month)}</b>.</p><table cellpadding="4"><tr><td>Pickups:</td><td><b>${count}</b></td></tr><tr><td>Total collected:</td><td><b>${money(total)}</b></td></tr></table><p>${escapeHtml(s.org_name)} (US)<br>${escapeHtml(s.website)}</p>`,
      attachments: [{
        filename: `Sadiger-Collections-${month}.xlsx`,
        content: Buffer.from(buffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
  } catch (err) {
    status = 'failed';
    error = err.message;
  }
  const row = await one(
    `insert into report_sends(month, trigger, recipients, pickups, total, status, error)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`, [month, trigger, recipients || '(none)', count, total, status, error]);
  return row;
}

/**
 * Automatic monthly send: on/after the 1st, if last month's report hasn't been sent
 * successfully yet. Failed attempts are retried at most every 6 hours.
 */
export async function runMonthlyIfDue() {
  const s = await getSettings();
  if (s.report_auto !== '1' || !s.israel_email || !emailConfigured()) return null;
  const month = previousMonth();
  // Only a send made after the month ended counts (an early mid-month send is incomplete).
  const [, monthEnd] = monthRange(month);
  const done = await one(
    `select 1 from report_sends where month=$1 and status='sent' and sent_at >= $2::date limit 1`, [month, monthEnd]);
  if (done) return null;
  const recentFail = await one(
    `select 1 from report_sends where month=$1 and trigger='auto' and sent_at > now() - interval '6 hours' limit 1`, [month]);
  if (recentFail) return null;
  return sendMonthlyReport(month, 'auto');
}

export async function yearStatement(holderId, year) {
  const h = await one('select * from holders where id=$1', [holderId]);
  if (!h) throw httpError(404, 'Box holder not found.');
  const rows = await query(
    `select * from receipts where holder_id=$1 and not voided and extract(year from collected_on)=$2 order by collected_on`,
    [holderId, year]);
  return { holder: h, rows, pdf: await statementPdf(h, year, rows, await getSettings()) };
}

export async function emailYearStatement(holderId, year) {
  const s = await getSettings();
  const { holder: h, rows, pdf } = await yearStatement(holderId, year);
  if (!rows.length) return { ok: false, skipped: true, error: 'No donations that year' };
  if (!h.email) return { ok: false, error: 'No email address' };
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  try {
    await sendMail({
      to: h.email,
      replyTo: s.email || undefined,
      subject: `Your ${year} contribution statement from ${s.org_name}`,
      text: `Dear ${h.first_name},\n\nThank you for your support in ${year}. Your total charity box contributions were ${money(total)}. Your year-end statement for tax purposes is attached.\n\n${s.thank_you}\n\n${s.org_name}\n${s.website}`,
      attachments: [{ filename: `Sadiger-${year}-Statement.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
