'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const showTime = (ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fullAddr = (h) => [h.address, [[h.city, h.state].filter(Boolean).join(', '), h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

const state = { me: null, settings: {}, holders: [], filter: 'all', current: null, today: '' };

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' } };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  if (res.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let tt;
function toast(m, ms = 3500) {
  const t = $('#toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms);
}
const fail = (e) => toast(e.message, 6000);

function pill(h) {
  if (!h.active) return '<span class="pill muted">Box returned</span>';
  const label = h.status === 'over' ? 'Overdue · ' : h.status === 'due' ? 'Due soon · ' : '';
  return `<span class="pill ${h.status}">${label}${h.days_since}d</span>`;
}
const emailPill = (r) => r.voided ? `<span class="pill void">Voided</span>`
  : r.email_status === 'sent' ? '<span class="pill ok">Emailed</span>'
  : r.email_status === 'failed' ? `<span class="pill failed" title="${esc(r.email_error)}">Not sent</span>`
  : '<span class="pill muted">Not emailed</span>';

// ---------- Navigation ----------
const VIEWS = ['dashboard', 'boxes', 'receipts', 'io', 'settings'];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === v));
  $$('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === v));
  ({ dashboard: loadDashboard, boxes: loadHolders, receipts: loadReceipts, io: loadReports, settings: loadSettings })[v]().catch(fail);
}
window.addEventListener('hashchange', route);

// ---------- Dashboard ----------
async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('#sBoxes').textContent = d.boxes;
  $('#sYear').textContent = fmt(d.yearTotal);
  $('#sYearLbl').textContent = d.year;
  $('#sDue').textContent = d.dueCount;
  $('#sDueLbl').textContent = `not emptied in ${state.settings.due_soon_days || 60}+ days`;
  $('#sRec').textContent = d.receiptsYear;
  $('#dueList').innerHTML = d.due.map((h) => `
    <li><div class="who"><b>${esc(h.first_name)} ${esc(h.last_name)}</b><small>${esc(fullAddr(h))}${h.phone ? ' · ' + esc(h.phone) : ''}</small></div>
    <div class="actions">${pill(h)}<button class="btn sm" data-action="pickup" data-id="${h.id}">Pickup</button></div></li>`).join('')
    || '<li class="note">Everyone is up to date.</li>';
  $('#recentList').innerHTML = d.recent.map((r) => `
    <li><div class="who"><b>${esc(r.donor_name)}</b><small>${show(r.collected_on)} · <a href="/api/receipts/${r.id}.pdf" target="_blank">#${esc(r.receipt_no)}</a></small></div><b class="num">${fmt(r.amount)}</b></li>`).join('')
    || '<li class="note">No pickups yet.</li>';
}

// ---------- Holders ----------
async function loadHolders() {
  state.holders = await api('/api/holders?all=1');
  renderHolders();
}
function renderHolders() {
  const q = $('#q').value.trim().toLowerCase();
  const rows = state.holders.filter((h) => {
    if (state.filter === 'inactive' ? h.active : !h.active) return false;
    if (!['all', 'inactive'].includes(state.filter) && h.status !== state.filter) return false;
    return !q || [h.first_name, h.last_name, fullAddr(h), h.phone, h.box_no, h.email].join(' ').toLowerCase().includes(q);
  });
  $('#boxRows').innerHTML = rows.map((h) => `<tr>
    <td>${h.box_no ? `<span class="boxno">${esc(h.box_no)}</span>` : ''}</td>
    <td class="who"><button class="linkbtn" data-action="edit-holder" data-id="${h.id}">${esc(h.first_name)} ${esc(h.last_name)}</button></td>
    <td class="hide-m">${esc(fullAddr(h))}</td>
    <td class="hide-m who"><small>${esc(h.phone)}<br>${h.email ? esc(h.email) : '<i>no email</i>'}</small></td>
    <td class="hide-m">${show(h.date_given)}</td>
    <td>${h.last_pickup ? show(h.last_pickup) : '<span class="note">never</span>'}<br>${pill(h)}</td>
    <td class="num"><b>${fmt(h.year_total)}</b></td>
    <td>${h.active ? `<button class="btn sm gold" data-action="pickup" data-id="${h.id}">Record pickup</button>` : ''}</td></tr>`).join('')
    || `<tr><td colspan="8" class="empty">${state.holders.length ? 'No box holders match.' : 'No box holders yet. Add one, or import your list from Excel.'}</td></tr>`;
}
$('#q').addEventListener('input', renderHolders);
$('#filters').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  state.filter = c.dataset.f;
  $$('#filters .chip').forEach((x) => x.classList.toggle('on', x === c));
  renderHolders();
});

async function openHolder(id) {
  const f = $('#holderForm');
  f.reset();
  state.current = null;
  $('#hHistory').hidden = true;
  ['hActive', 'hStmt', 'hStmtYear'].forEach((i) => { $('#' + i).hidden = !id; });
  if (id) {
    const h = await api('/api/holders/' + id);
    state.current = h;
    $('#hTitle').textContent = `${h.first_name} ${h.last_name}`;
    for (const el of f.elements) if (el.name && el.name in h) el.value = h[el.name] ?? '';
    $('#hActive').textContent = h.active ? 'Mark box returned' : 'Reactivate';
    const years = [...new Set(h.receipts.filter((r) => !r.voided).map((r) => r.collected_on.slice(0, 4)))];
    $('#hStmtYear').innerHTML = years.map((y) => `<option>${y}</option>`).join('');
    $('#hStmt').hidden = $('#hStmtYear').hidden = !years.length;
    if (h.receipts.length) {
      const total = h.receipts.filter((r) => !r.voided).reduce((a, r) => a + r.amount, 0);
      $('#hHistory').innerHTML = `<h4>Pickup history · ${fmt(total)} total</h4><table><tbody>${h.receipts.map((r) => `
        <tr><td>${show(r.collected_on)}</td><td><a href="/api/receipts/${r.id}.pdf" target="_blank">#${esc(r.receipt_no)}</a></td>
        <td class="num">${fmt(r.amount)}</td><td>${emailPill(r)}</td></tr>`).join('')}</tbody></table>`;
      $('#hHistory').hidden = false;
    }
  } else {
    $('#hTitle').textContent = 'New box holder';
    f.date_given.value = state.today;
    const nums = state.holders.map((h) => /^SB-(\d+)$/.exec(h.box_no || '')).filter(Boolean).map((m) => Number(m[1]));
    f.box_no.value = 'SB-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  }
  openModal('holder');
  f.first_name.focus();
}
$('#holderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const h = state.current
      ? await api('/api/holders/' + state.current.id, { method: 'PUT', body })
      : await api('/api/holders', { method: 'POST', body });
    closeModals();
    toast(`${h.first_name} ${h.last_name} saved`);
    route();
  } catch (err) { fail(err); }
});

// ---------- Pickup ----------
function receiptPreview(h, amount, date) {
  const s = state.settings;
  const logo = s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="">` : '';
  const sig = s.signature ? `<img class="sigimg" src="${esc(s.signature)}" alt="">` : '';
  return `<div class="rh"><div>${logo}<h2>${esc(s.org_name)}</h2><small>${esc(s.website)}${s.ein ? '<br>EIN ' + esc(s.ein) : ''}</small></div>
    <div class="rno"><small>DONATION RECEIPT</small><b>No. (assigned on save)</b><small>${date ? show(date) : '—'}</small></div></div>
    <dl><dt>Received from</dt><dd><b>${esc(h.first_name)} ${esc(h.last_name)}</b></dd>
    <dt>Address</dt><dd>${esc(fullAddr(h)) || '—'}</dd>
    <dt>Description</dt><dd>Cash contents of home charity box ${esc(h.box_no || '')}</dd></dl>
    <div class="total"><span>Contribution received</span><b>${fmt(amount)}</b></div>
    <div class="legal">${esc(s.legal_name || s.org_name)} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code, EIN ${esc(s.ein || '[not set]')}. No goods or services were provided in exchange for this contribution. ${esc(s.thank_you)}</div>
    <div class="sig"><small style="color:var(--muted)">PDF emailed to donor</small><div>${sig}<div class="line">${esc([s.signer_name, s.signer_title].filter(Boolean).join(', ') || 'Authorized signer')}</div></div></div>`;
}
function drawPreview() {
  if (state.current) $('#rPreview').innerHTML = receiptPreview(state.current, $('#pAmt').value, $('#pDate').value);
}
function openPickup(id) {
  const h = state.holders.find((x) => x.id === id) || null;
  const go = (h) => {
    state.current = h;
    const f = $('#pickupForm'); f.reset();
    $('#pTitle').textContent = `Record pickup · ${h.first_name} ${h.last_name}`;
    $('#pWho').innerHTML = `${h.box_no ? `<span class="boxno">${esc(h.box_no)}</span> &nbsp;` : ''}${esc(fullAddr(h))}<br>Last emptied: ${h.last_pickup ? show(h.last_pickup) : 'never'}`;
    $('#pDate').value = state.today;
    $('#pDate').max = state.today;
    $('#pBy').value = state.me.user.name && state.me.user.name !== 'Administrator' ? state.me.user.name : '';
    const canEmail = !!h.email && state.me.email.configured;
    $('#pEmail').checked = canEmail;
    $('#pEmail').disabled = !canEmail;
    $('#pEmailLbl').textContent = !h.email ? 'No email on file. Print or download the PDF after saving'
      : !state.me.email.configured ? 'Email is not set up yet. Download the PDF after saving'
      : `Email the receipt to ${h.email}`;
    drawPreview();
    openModal('pickup');
    setTimeout(() => $('#pAmt').focus(), 50);
  };
  if (h) go(h); else api('/api/holders?all=1').then((list) => { state.holders = list; go(list.find((x) => x.id === id)); }).catch(fail);
}
$('#pAmt').addEventListener('input', drawPreview);
$('#pDate').addEventListener('input', drawPreview);
$('#pickupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#pSave'); btn.disabled = true;
  const body = Object.fromEntries(new FormData(e.target));
  body.send_email = $('#pEmail').checked;
  try {
    const { receipt: r, email } = await api(`/api/holders/${state.current.id}/pickups`, { method: 'POST', body });
    closeModals();
    if (email && email.ok) toast(`Receipt #${r.receipt_no} for ${fmt(r.amount)} emailed to ${email.to}`, 5000);
    else {
      toast(`Receipt #${r.receipt_no} saved${email ? ' but NOT emailed: ' + email.error : ''}. Opening PDF…`, 7000);
      window.open(`/api/receipts/${r.id}.pdf`, '_blank');
    }
    route();
  } catch (err) { fail(err); } finally { btn.disabled = false; }
});

// ---------- Receipts ----------
async function loadReceipts() {
  const sel = $('#recYear');
  if (!sel.options.length) {
    const y = Number(state.today.slice(0, 4));
    sel.innerHTML = [y, y - 1, y - 2, y - 3].map((v) => `<option>${v}</option>`).join('');
  }
  const rows = await api('/api/receipts?year=' + sel.value);
  $('#recRows').innerHTML = rows.reverse().map((r) => `<tr>
    <td><a href="/api/receipts/${r.id}.pdf" target="_blank" style="font-family:ui-monospace,Menlo,monospace;font-weight:700">${esc(r.receipt_no)}</a></td>
    <td>${show(r.collected_on)}</td><td class="who"><b>${esc(r.donor_name)}</b></td>
    <td class="hide-m">${r.box_no ? `<span class="boxno">${esc(r.box_no)}</span>` : ''}</td>
    <td class="num"><b>${fmt(r.amount)}</b></td><td>${emailPill(r)}</td>
    <td><div class="actions">${r.voided ? '' : `<button class="btn sm" data-action="email-receipt" data-id="${r.id}" data-to="${esc(r.donor_email)}">${r.email_status === 'sent' ? 'Resend' : 'Email'}</button>
      <button class="btn sm danger" data-action="void-receipt" data-id="${r.id}" data-no="${esc(r.receipt_no)}">Void</button>`}</div></td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No receipts for this year.</td></tr>';
}
$('#recYear').addEventListener('change', () => loadReceipts().catch(fail));

// ---------- Import / export / reports ----------
async function loadReports() {
  if (!$('#expMonth').value) {
    $('#expMonth').value = $('#sendMonth').value = state.prevMonth;
    $('#expYear').value = state.today.slice(0, 4);
  }
  const s = state.settings;
  const f = $('#reportForm');
  f.report_auto.checked = s.report_auto === '1';
  f.israel_email.value = s.israel_email;
  f.report_cc.value = s.report_cc;
  const d = await api('/api/reports');
  $('#nextAuto').textContent = d.nextAuto ? `Next automatic send: ${show(d.nextAuto)} (${d.nextAutoMonth} report)` : 'Automatic sending is off.';
  $('#sentRows').innerHTML = d.sends.map((x) => `<tr><td><b>${monthName(x.month)}</b>${x.trigger === 'auto' ? ' <span class="note">auto</span>' : ''}</td>
    <td>${showTime(x.sent_at)}</td><td>${esc(x.recipients)}</td><td class="num">${x.pickups}</td><td class="num"><b>${fmt(x.total)}</b></td>
    <td>${x.status === 'sent' ? '<span class="pill ok">Delivered</span>' : `<span class="pill failed" title="${esc(x.error)}">Failed</span> <small class="note">${esc(x.error)}</small>`}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">No reports sent yet.</td></tr>';
}
$('#expWhat').addEventListener('change', () => {
  $('#expMonthWrap').hidden = $('#expWhat').value !== 'month';
  $('#expYearWrap').hidden = $('#expWhat').value !== 'year';
});
$('#impFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  $('#impResult').innerHTML = '<p class="note">Importing…</p>';
  try {
    const r = await api('/api/import', { method: 'POST', body: fd });
    $('#impResult').innerHTML = `<div class="alert ok" style="margin-top:12px">Imported from ${esc(file.name)}: <b>${r.added} added</b>, ${r.updated} updated.</div>`
      + (r.errors.length ? `<ul class="err-list">${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    state.holders = await api('/api/holders?all=1');
  } catch (err) {
    $('#impResult').innerHTML = `<div class="alert err" style="margin-top:12px">${esc(err.message)}</div>`;
  }
  e.target.value = '';
});
$('#reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body: { report_auto: f.report_auto.checked ? '1' : '0', israel_email: f.israel_email.value, report_cc: f.report_cc.value } });
    toast('Monthly report settings saved');
    loadReports();
  } catch (err) { fail(err); }
});

// ---------- Settings ----------
async function loadSettings() {
  const s = state.settings = await api('/api/settings');
  const f = $('#settingsForm');
  for (const el of f.elements) if (el.name && el.name in s) el.value = s[el.name];
  for (const k of ['logo', 'signature']) { const img = $('#' + k + 'Prev'); img.hidden = !s[k]; if (s[k]) img.src = s[k]; }
  const users = await api('/api/users');
  $('#userList').innerHTML = users.map((u) => `<li><span><b>${esc(u.name || u.email)}</b><br><small class="note">${esc(u.email)}</small></span>
    ${u.id === state.me.user.id ? '<span class="note">you</span>' : `<button class="btn sm danger" data-action="remove-user" data-id="${u.id}" data-email="${esc(u.email)}">Remove</button>`}</li>`).join('');
}
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { state.settings = await api('/api/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Settings saved'); checkSetup(); }
  catch (err) { fail(err); }
});
$$('input[data-image]').forEach((inp) => inp.addEventListener('change', async () => {
  if (!inp.files[0]) return;
  const fd = new FormData(); fd.append('file', inp.files[0]);
  try { await api('/api/settings/image/' + inp.dataset.image, { method: 'POST', body: fd }); toast('Image saved'); loadSettings(); }
  catch (err) { fail(err); }
  inp.value = '';
}));
$('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Person added. Give them their temporary password.'); loadSettings(); }
  catch (err) { fail(err); }
});
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password changed'); }
  catch (err) { fail(err); }
});

// ---------- Modals ----------
function openModal(id) { $('#' + id).classList.add('open'); }
function closeModals() { $$('.backdrop').forEach((b) => b.classList.remove('open')); }
$$('.backdrop').forEach((b) => b.addEventListener('mousedown', (e) => { if (e.target === b) closeModals(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

// ---------- Click actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const id = Number(el.dataset.id);
  try {
    switch (el.dataset.action) {
      case 'close': closeModals(); break;
      case 'new-holder': await openHolder(null); break;
      case 'edit-holder': await openHolder(id); break;
      case 'pickup': openPickup(id); break;
      case 'holder-active': {
        const h = state.current;
        if (h.active && !confirm(`Mark ${h.first_name} ${h.last_name}'s box as returned? They will be hidden from the visit list. Their receipts are kept.`)) return;
        await api(`/api/holders/${h.id}/active`, { method: 'POST', body: { active: !h.active } });
        closeModals(); toast(h.active ? 'Box marked returned' : 'Box holder reactivated'); route(); break;
      }
      case 'holder-statement': window.open(`/api/holders/${state.current.id}/statement/${$('#hStmtYear').value}.pdf`, '_blank'); break;
      case 'email-receipt': {
        const to = prompt('Email the receipt to:', el.dataset.to || '');
        if (to === null) return;
        el.disabled = true;
        const r = await api(`/api/receipts/${id}/email`, { method: 'POST', body: { to } });
        toast(r.ok ? `Receipt emailed to ${r.to}` : `Not sent: ${r.error}`, 6000);
        loadReceipts(); break;
      }
      case 'void-receipt': {
        const reason = prompt(`Void receipt #${el.dataset.no}? The number stays in the records, marked VOID.\n\nReason (e.g. "wrong amount entered"):`);
        if (!reason) return;
        await api(`/api/receipts/${id}/void`, { method: 'POST', body: { reason } });
        toast(`Receipt #${el.dataset.no} voided. Record the pickup again with the correct amount.`, 6000);
        loadReceipts(); break;
      }
      case 'export-year': location.href = `/api/export?what=year&year=${$('#recYear').value}`; break;
      case 'email-statements': {
        const y = $('#recYear').value;
        if (!confirm(`Email a ${y} year-end statement to every donor who gave in ${y} and has an email address?`)) return;
        el.disabled = true; toast('Sending statements…', 20000);
        const r = await api(`/api/statements/${y}/email`, { method: 'POST' });
        toast(`${r.sent} statements emailed. ${r.noEmail} donors have no email.${r.failed.length ? ' ' + r.failed.length + ' failed: ' + r.failed[0] : ''}`, 9000);
        el.disabled = false; break;
      }
      case 'export': {
        const w = $('#expWhat').value;
        location.href = `/api/export?what=${w}&month=${$('#expMonth').value}&year=${$('#expYear').value}`; break;
      }
      case 'send-report': {
        const m = $('#sendMonth').value;
        if (!m) return toast('Choose a month');
        if (!confirm(`Email the ${monthName(m)} report to ${state.settings.israel_email || '(no address set)'} now?`)) return;
        el.disabled = true;
        try {
          const r = await api('/api/reports/send', { method: 'POST', body: { month: m } });
          toast(`${monthName(m)} report (${r.pickups} pickup${r.pickups === 1 ? '' : 's'}, ${fmt(r.total)}) emailed to ${r.recipients}`, 6000);
        } finally { el.disabled = false; loadReports(); }
        break;
      }
      case 'clear-image':
        e.preventDefault();
        await api('/api/settings/image/' + el.dataset.kind, { method: 'POST', body: new FormData() });
        loadSettings(); break;
      case 'remove-user':
        if (!confirm(`Remove ${el.dataset.email}? They will no longer be able to sign in.`)) return;
        await api('/api/users/' + id, { method: 'DELETE' }); loadSettings(); break;
    }
  } catch (err) { fail(err); el.disabled = false; }
});

// ---------- Start ----------
function checkSetup() {
  const s = state.settings;
  const missing = [];
  if (!s.ein) missing.push('the EIN (Settings)');
  if (!s.signer_name) missing.push('the signer name (Settings)');
  if (!state.me.email.configured) missing.push('email sending (ask your web person to add the SMTP settings)');
  const w = $('#setupWarn');
  w.hidden = !missing.length;
  w.textContent = missing.length ? `To finish setting up: add ${missing.join(', ')}.` : '';
}
(async function init() {
  try {
    state.me = await api('/api/me');
    state.today = state.me.today;
    const [y, m] = state.today.split('-').map(Number);
    state.prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    $('#meEmail').textContent = state.me.user.email;
    state.settings = await api('/api/settings');
    checkSetup();
    route();
  } catch (err) { fail(err); }
})();
