import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

export const IMPORT_COLUMNS = ['First Name', 'Last Name', 'Address', 'City', 'State', 'ZIP', 'Phone', 'Email', 'Box #', 'Date Given', 'Notes'];

// Accepted header spellings (lower-case, letters/digits/# only) -> field
const HEADER_MAP = {
  firstname: 'first_name', first: 'first_name', givenname: 'first_name',
  lastname: 'last_name', last: 'last_name', surname: 'last_name', familyname: 'last_name',
  name: 'full_name', fullname: 'full_name', donor: 'full_name', donorname: 'full_name',
  address: 'address', street: 'address', streetaddress: 'address', address1: 'address',
  city: 'city', town: 'city',
  state: 'state', st: 'state',
  zip: 'zip', zipcode: 'zip', postalcode: 'zip', zip5: 'zip',
  phone: 'phone', phonenumber: 'phone', cell: 'phone', mobile: 'phone', tel: 'phone', telephone: 'phone',
  email: 'email', emailaddress: 'email', 'e-mail': 'email',
  'box#': 'box_no', box: 'box_no', boxno: 'box_no', boxnumber: 'box_no', boxid: 'box_no',
  dategiven: 'date_given', given: 'date_given', datedelivered: 'date_given', boxgiven: 'date_given', date: 'date_given',
  notes: 'notes', note: 'notes', comments: 'notes',
};
const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9#]/g, '');

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text);             // hyperlink / email cells
    if ('result' in v) return cellText(v.result);        // formula cells
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  }
  return String(v).trim();
}

export function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);       // US style M/D/YYYY
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  if (/^\d{5}$/.test(s)) {                                          // Excel serial number
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/** Parse an uploaded .xlsx or .csv into holder objects. Returns { rows, errors }. */
export async function parseHolderFile(buffer, filename) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    await wb.csv.read(Readable.from(buffer), { parserOptions: { trim: true } });
  } else if (/\.xlsx$/i.test(filename)) {
    await wb.xlsx.load(buffer);
  } else {
    throw new Error('Please upload an .xlsx or .csv file. (Older .xls files: open in Excel and "Save As" .xlsx.)');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The file has no sheets.');

  // Find the header row: first row (within the first 10) that has a first-name or name column.
  let headerRow = 0;
  let fields = [];
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const vals = ws.getRow(r).values;
    const f = vals.map((v) => HEADER_MAP[normHeader(cellText(v))] || null);
    if (f.includes('first_name') || f.includes('full_name')) { headerRow = r; fields = f; break; }
  }
  if (!headerRow) throw new Error('Could not find a header row with a "First Name" (or "Name") column.');

  const rows = [];
  const errors = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values;
    const o = {};
    fields.forEach((f, i) => { if (f && !o[f]) o[f] = vals[i] instanceof Date ? vals[i] : cellText(vals[i]); });
    if (o.full_name && !o.first_name) {
      const parts = String(o.full_name).trim().split(/\s+/);
      o.last_name = o.last_name || (parts.length > 1 ? parts.pop() : '');
      o.first_name = parts.join(' ');
    }
    delete o.full_name;
    const empty = Object.values(o).every((v) => !v);
    if (empty) continue;
    if (!o.first_name) { errors.push(`Row ${r}: missing first name – skipped`); continue; }
    o.date_given = toIsoDate(o.date_given);
    o.state = (o.state || '').toUpperCase();
    o.email = (o.email || '').replace(/^mailto:/i, '');
    rows.push(o);
  }
  return { rows, errors };
}

const asDate = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z') : null);

function styleSheet(ws, moneyCols = [], dateCols = []) {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const key of moneyCols) ws.getColumn(key).numFmt = '"$"#,##0.00';
  for (const key of dateCols) ws.getColumn(key).numFmt = 'mm/dd/yyyy';
  ws.columns.forEach((col) => {
    let w = 10;
    col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, c.value instanceof Date ? 12 : String(c.value ?? '').length + 2); });
    col.width = Math.min(w, 50);
  });
}

export async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Box Holders');
  ws.columns = IMPORT_COLUMNS.map((h) => ({ header: h, key: h }));
  ws.addRow(['Yosef', 'Example', '123 Main St', 'Brooklyn', 'NY', '11219', '(718) 555-0100', 'yosef@example.com', 'SB-101', '11/23/2026', 'Delete this example row']);
  styleSheet(ws);
  return wb.xlsx.writeBuffer();
}

export async function holdersWorkbook(holders) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Box Holders');
  ws.columns = [
    { header: 'Box #', key: 'box_no' }, { header: 'First Name', key: 'first_name' }, { header: 'Last Name', key: 'last_name' },
    { header: 'Address', key: 'address' }, { header: 'City', key: 'city' }, { header: 'State', key: 'state' }, { header: 'ZIP', key: 'zip' },
    { header: 'Phone', key: 'phone' }, { header: 'Email', key: 'email' }, { header: 'Date Given', key: 'date_given' },
    { header: 'Last Emptied', key: 'last_pickup' }, { header: 'Total This Year', key: 'year_total' },
    { header: 'Total All Time', key: 'all_total' }, { header: 'Active', key: 'active' }, { header: 'Notes', key: 'notes' },
  ];
  holders.forEach((h) => ws.addRow({ ...h, date_given: asDate(h.date_given), last_pickup: asDate(h.last_pickup), active: h.active ? 'Yes' : 'No (box returned)' }));
  styleSheet(ws, ['year_total', 'all_total'], ['date_given', 'last_pickup']);
  return wb.xlsx.writeBuffer();
}

/** Collections report: detail sheet + per-family summary sheet. */
export async function collectionsWorkbook(title, receipts) {
  const wb = new ExcelJS.Workbook();
  wb.title = title;
  const ws = wb.addWorksheet('Collections');
  ws.columns = [
    { header: 'Date', key: 'collected_on' }, { header: 'Receipt #', key: 'receipt_no' }, { header: 'Box #', key: 'box_no' },
    { header: 'Donor', key: 'donor_name' }, { header: 'Address', key: 'donor_address' },
    { header: 'Amount (USD)', key: 'amount' }, { header: 'Counted By', key: 'counted_by' },
    { header: 'Receipt Emailed', key: 'emailed' }, { header: 'Note', key: 'note' },
  ];
  const live = receipts.filter((r) => !r.voided);
  live.forEach((r) => ws.addRow({ ...r, collected_on: asDate(r.collected_on), emailed: r.email_status === 'sent' ? 'Yes' : 'No' }));
  const total = live.reduce((a, r) => a + Number(r.amount), 0);
  const tr = ws.addRow({ donor_name: 'TOTAL', amount: total });
  tr.font = { bold: true };
  styleSheet(ws, ['amount'], ['collected_on']);

  const ss = wb.addWorksheet('Summary by Family');
  ss.columns = [{ header: 'Donor', key: 'donor' }, { header: 'Box #', key: 'box' }, { header: 'Pickups', key: 'n' }, { header: 'Total (USD)', key: 't' }];
  const by = new Map();
  for (const r of live) {
    const k = r.holder_id;
    const e = by.get(k) || { donor: r.donor_name, box: r.box_no, n: 0, t: 0 };
    e.n++; e.t += Number(r.amount);
    by.set(k, e);
  }
  [...by.values()].sort((a, b) => b.t - a.t).forEach((e) => ss.addRow(e));
  const st = ss.addRow({ donor: 'TOTAL', n: live.length, t: total });
  st.font = { bold: true };
  styleSheet(ss, ['t']);

  const voided = receipts.filter((r) => r.voided);
  if (voided.length) {
    const vs = wb.addWorksheet('Voided Receipts');
    vs.columns = [{ header: 'Receipt #', key: 'receipt_no' }, { header: 'Date', key: 'collected_on' }, { header: 'Donor', key: 'donor_name' },
      { header: 'Amount (USD)', key: 'amount' }, { header: 'Reason', key: 'void_reason' }];
    voided.forEach((r) => vs.addRow({ ...r, collected_on: asDate(r.collected_on) }));
    styleSheet(vs, ['amount'], ['collected_on']);
  }
  return { buffer: await wb.xlsx.writeBuffer(), count: live.length, total };
}
