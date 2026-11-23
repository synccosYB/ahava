import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseHolderFile, toIsoDate, collectionsWorkbook } from '../lib/excel.js';

test('toIsoDate understands US, ISO and Excel dates', () => {
  assert.equal(toIsoDate('3/8/2026'), '2026-03-08');
  assert.equal(toIsoDate('2026-02-02'), '2026-02-02');
  assert.equal(toIsoDate('12/1/26'), '2026-12-01');
  assert.equal(toIsoDate(new Date('2026-01-14T00:00:00Z')), '2026-01-14');
  assert.equal(toIsoDate(''), null);
});

test('import finds the header row, splits full names and skips blank rows', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('List');
  ws.addRow(['Congregation list']);
  ws.addRow(['Name', 'Street Address', 'Zip Code', 'E-mail', 'Box Number', 'Date Delivered']);
  ws.addRow(['Moshe Friedman', '1420 50th St', '11219', 'mailto:m@example.com', 'SB-001', '1/14/2026']);
  ws.addRow([]);
  ws.addRow(['', 'no name', '', '', '', '']);
  const { rows, errors } = await parseHolderFile(Buffer.from(await wb.xlsx.writeBuffer()), 'list.xlsx');
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(
    { ...rows[0] },
    { first_name: 'Moshe', last_name: 'Friedman', address: '1420 50th St', zip: '11219', email: 'm@example.com', box_no: 'SB-001', date_given: '2026-01-14', state: '' },
  );
});

test('CSV import works', async () => {
  const csv = 'First Name,Last Name,City,State\nChana,Rosenberg,Lakewood,nj\n';
  const { rows } = await parseHolderFile(Buffer.from(csv), 'x.csv');
  assert.equal(rows[0].first_name, 'Chana');
  assert.equal(rows[0].state, 'NJ');
});

test('collections report totals exclude voided receipts', async () => {
  const base = { receipt_no: 'x', box_no: 'SB-1', donor_address: '', counted_by: '', note: '', email_status: 'sent', void_reason: '' };
  const { count, total, buffer } = await collectionsWorkbook('t', [
    { ...base, holder_id: 1, donor_name: 'A', collected_on: '2026-11-02', amount: 100, voided: false },
    { ...base, holder_id: 1, donor_name: 'A', collected_on: '2026-11-09', amount: 50.25, voided: false },
    { ...base, holder_id: 2, donor_name: 'B', collected_on: '2026-11-10', amount: 999, voided: true },
  ]);
  assert.equal(count, 2);
  assert.equal(total, 150.25);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Collections', 'Summary by Family', 'Voided Receipts']);
  assert.ok(wb.worksheets[0].getCell('A2').value instanceof Date);
});
