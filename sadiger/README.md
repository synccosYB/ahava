# Sadiger Charity Boxes

Web app for **Sadiger Institution in Israel** (US office, givetosadiger.org) to track the
charity boxes given to families, record each pickup, issue numbered tax-deductible receipts,
and send a monthly Excel report to the administration in Israel.

## What it does

- **Box holders**: name, address, phone, email, box number, date given. Search and filter by
  visit status (overdue / due soon / up to date / box returned). Click a name to edit it or see that family's history.
- **Record a pickup**: enter the amount counted. The app assigns the next receipt number
  (`2026-0001`, `2026-0002`, …), creates a PDF receipt with the 501(c)(3) wording and
  "no goods or services" statement, and emails it to the donor.
- **Receipts**: open any receipt PDF, resend it, or **void** it (the number is kept and marked VOID, as auditors expect).
- **Year-end statements**: one PDF per donor with all their pickups for the year; email them to everyone at once.
- **Import / Export**: import the congregation list from Excel (.xlsx) or CSV, with a blank template to download.
  Re-importing updates existing people instead of adding them twice. Export the box holder list,
  a month's collections, or a whole year's receipts to Excel.
- **Monthly report to Israel**: on the 1st of each month, last month's Excel report
  (every pickup, a summary per family, and any voided receipts) is emailed automatically to the
  address you set. A "Send report now" button is there too.
- **Logins**: only people you add can sign in (Settings → People who can sign in).

## Run it on Replit (recommended)

1. Create a new Repl from this folder's code, and add a **PostgreSQL database**
   (Replit sets `DATABASE_URL` for you).
2. In **Secrets**, add the values from `.env.example`: `SESSION_SECRET`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `NODE_ENV=production`, and the `SMTP_…` / `MAIL_FROM` email settings.
3. Click **Run**, then **Deploy**, and choose **Reserved VM**. This keeps it always on, so the
   automatic monthly report goes out on the 1st. (If you use Autoscale instead, set `CRON_SECRET`
   and have a free cron service call `https://givetosadiger.org/cron/monthly?key=…` once a day.)
4. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, open **Settings**, and fill in the EIN, legal name,
   address, signer, logo and signature. Then open **Import / Export** and upload the congregation list.

### Connect givetosadiger.org (domain bought at Squarespace)

1. In the Replit deployment, open **Settings → Link a domain** and enter `givetosadiger.org`
   (or `app.givetosadiger.org`). Replit shows the DNS records to add (usually an **A** record and a **TXT** record).
2. In Squarespace: **Domains → givetosadiger.org → DNS → DNS Settings → Add record**, and add exactly
   those records. Remove any Squarespace default records that point the same name elsewhere.
3. Wait for Replit to show the domain as verified (minutes to a few hours). HTTPS is set up automatically.

### Email setup

Receipts are sent from your own address so donors recognize them. Easiest options:

- **Google Workspace** (free for registered nonprofits through Google for Nonprofits):
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=receipts@givetosadiger.org`,
  `SMTP_PASS=` an *App Password* for that account.
- **Postmark / SendGrid / Mailgun**: use the SMTP host, user and password they give you.

Whichever you use, add the SPF/DKIM records it gives you in Squarespace DNS, so receipts don't land in spam.

## Run locally (for developers)

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL etc.
node --env-file=.env server.js
npm test
```

Without SMTP settings, set `MAIL_DEV_DIR=./mail-out` to have emails written to files instead of sent.

## Notes

- Receipt numbers restart each year at "First receipt number each year" (Settings).
- Amounts are stored to the cent. Receipts keep a copy of the donor's name and address as they were
  when the receipt was issued, so later edits don't change past receipts.
- The IRS requires a written acknowledgment for any single contribution of $250 or more. These receipts meet that requirement.
  Have your accountant confirm the wording in Settings once.
