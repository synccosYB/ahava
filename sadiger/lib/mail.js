import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Email transport.
 *  - SMTP_HOST etc. set  -> real email via SMTP (Google Workspace, Outlook, Postmark, SendGrid...)
 *  - MAIL_DEV_DIR set    -> emails are written as .eml files to that folder (for testing)
 *  - neither             -> email is "not configured"; sends fail with a clear message
 */
let transport = null;
let mode = 'none';

if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  mode = 'smtp';
} else if (process.env.MAIL_DEV_DIR) {
  transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  mode = 'dev';
}

export const emailConfigured = () => mode !== 'none';
export const emailMode = () => mode;

export async function sendMail({ to, cc, subject, text, html, attachments, replyTo }) {
  if (!transport) throw new Error('Email is not set up yet (SMTP settings missing).');
  if (!to) throw new Error('No email address to send to.');
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (mode === 'smtp' && !from) throw new Error('MAIL_FROM is not set.');
  const info = await transport.sendMail({
    from: from || 'Sadiger <no-reply@givetosadiger.org>',
    to, cc: cc || undefined, replyTo: replyTo || undefined, subject, text, html, attachments,
  });
  if (mode === 'dev') {
    fs.mkdirSync(process.env.MAIL_DEV_DIR, { recursive: true });
    const name = `${Date.now()}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.eml`;
    fs.writeFileSync(path.join(process.env.MAIL_DEV_DIR, name), info.message);
  }
  return info;
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
