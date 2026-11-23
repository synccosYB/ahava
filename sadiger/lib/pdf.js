import PDFDocument from 'pdfkit';

const NAVY = '#1f3a5f';
const GOLD_SOFT = '#f6ecd6';
const MUTED = '#6b7280';

export const money = (n) =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const longDate = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

function imageFromDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function legalText(s) {
  const ein = s.ein || '[EIN not set]';
  return `${s.legal_name || s.org_name} is a tax-exempt organization under Section 501(c)(3) of the ` +
    `Internal Revenue Code, EIN ${ein}. No goods or services were provided in exchange for this ` +
    `contribution. Please keep this receipt for your tax records.`;
}

function header(doc, s, title, rightLines) {
  const left = 60;
  let x = left;
  const logo = imageFromDataUrl(s.logo);
  if (logo) {
    try { doc.image(logo, left, 52, { fit: [56, 56] }); x = left + 68; } catch { /* bad image: skip */ }
  }
  doc.fillColor(NAVY).font('Times-Bold').fontSize(22).text(s.org_name, x, 54, { width: 300 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  const sub = [s.address, [s.phone, s.email].filter(Boolean).join('  ·  '), s.website,
    s.ein ? `EIN ${s.ein}` : ''].filter(Boolean);
  doc.text(sub.join('\n'), x, doc.y + 4, { width: 300 });
  const headerBottom = Math.max(doc.y, 110);

  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(title, 360, 56, { width: 192, align: 'right' });
  doc.fillColor('#111').font('Courier-Bold').fontSize(13).text(rightLines[0], 360, doc.y + 2, { width: 192, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(rightLines.slice(1).join('\n'), 360, doc.y + 2, { width: 192, align: 'right' });

  const y = Math.max(headerBottom, doc.y) + 12;
  doc.moveTo(left, y).lineTo(552, y).lineWidth(2).strokeColor(NAVY).stroke();
  return y + 18;
}

function signature(doc, s, y) {
  const sig = imageFromDataUrl(s.signature);
  if (sig) {
    try { doc.image(sig, 392, y - 46, { fit: [150, 44], align: 'center' }); } catch { /* skip */ }
  }
  doc.moveTo(382, y).lineTo(552, y).lineWidth(0.7).strokeColor('#9ca3af').stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text([s.signer_name, s.signer_title].filter(Boolean).join(', ') || 'Authorized signer', 382, y + 4, { width: 170, align: 'center' });
}

/** Single donation receipt (one box pickup). */
export async function receiptPdf(r, s) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 60, info: { Title: `Donation Receipt ${r.receipt_no}` } });
  let y = header(doc, s, 'DONATION RECEIPT', [`No. ${r.receipt_no}`, longDate(r.collected_on)]);

  const row = (label, value) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text(label, 60, y, { width: 120 });
    doc.fillColor('#111').font('Helvetica').fontSize(10.5).text(value, 180, y, { width: 372 });
    y = doc.y + 8;
  };
  doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text('Received from', 60, y, { width: 120 });
  doc.fillColor('#111').font('Helvetica-Bold').text(r.donor_name, 180, y, { width: 372 });
  y = doc.y + 8;
  if (r.donor_address) row('Address', r.donor_address);
  row('Date received', longDate(r.collected_on));
  row('Description', `Cash contents of home charity box${r.box_no ? ' ' + r.box_no : ''}`);
  row('Form of payment', 'Cash');

  y += 6;
  doc.roundedRect(60, y, 492, 50, 6).fill(GOLD_SOFT);
  doc.fillColor('#333').font('Helvetica').fontSize(12).text('Contribution received', 78, y + 18);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(22).text(money(r.amount), 300, y + 13, { width: 234, align: 'right' });
  y += 72;

  if (r.voided) {
    doc.save().rotate(-20, { origin: [306, 380] }).fillColor('#b03a2e').opacity(0.25)
      .font('Helvetica-Bold').fontSize(90).text('VOID', 160, 330).restore();
  }

  doc.fillColor('#374151').font('Helvetica').fontSize(9.5).text(legalText(s), 60, y, { width: 492, lineGap: 2 });
  y = doc.y + 10;
  if (s.thank_you) {
    doc.fillColor('#111').font('Helvetica-Oblique').fontSize(10.5).text(s.thank_you, 60, y, { width: 492 });
    y = doc.y;
  }
  signature(doc, s, Math.max(y + 70, 520));
  return toBuffer(doc);
}

/** Year-end statement: all pickups for one donor in one year. */
export async function statementPdf(holder, year, rows, s) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 60, info: { Title: `${year} Contribution Statement` } });
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  let y = header(doc, s, `${year} CONTRIBUTION STATEMENT`, [money(total), `Jan 1 – Dec 31, ${year}`]);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text(`${holder.first_name} ${holder.last_name}`, 60, y);
  doc.font('Helvetica').fillColor(MUTED).fontSize(10)
    .text([holder.address, [holder.city, holder.state].filter(Boolean).join(', ') + ' ' + holder.zip].filter((t) => t.trim()).join('\n'));
  y = doc.y + 16;

  const cols = [60, 170, 300, 440];
  const th = (t, i, align = 'left') => doc.text(t, cols[i], y, { width: i === 3 ? 112 : 120, align });
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9);
  th('DATE', 0); th('RECEIPT NO.', 1); th('DESCRIPTION', 2); th('AMOUNT', 3, 'right');
  y += 16;
  doc.font('Helvetica').fontSize(10).fillColor('#111');
  for (const r of rows) {
    if (y > 650) { doc.addPage(); y = 60; }
    doc.text(longDate(r.collected_on), cols[0], y, { width: 110 });
    doc.text(r.receipt_no, cols[1], y, { width: 120 });
    doc.text('Charity box (cash)', cols[2], y, { width: 140 });
    doc.text(money(r.amount), cols[3], y, { width: 112, align: 'right' });
    y += 18;
  }
  doc.moveTo(60, y).lineTo(552, y).lineWidth(0.7).strokeColor('#d1d5db').stroke();
  y += 8;
  doc.font('Helvetica-Bold').text('Total contributions', cols[2], y, { width: 140 });
  doc.text(money(total), cols[3], y, { width: 112, align: 'right' });
  y += 34;
  doc.fillColor('#374151').font('Helvetica').fontSize(9.5).text(legalText(s), 60, y, { width: 492, lineGap: 2 });
  signature(doc, s, Math.max(doc.y + 70, 560));
  return toBuffer(doc);
}
