import pg from 'pg';

// Return DATE columns as plain 'YYYY-MM-DD' strings and NUMERIC as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL database and set DATABASE_URL.');
  process.exit(1);
}

const useSSL = process.env.PGSSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL);
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const query = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists users (
  id serial primary key,
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null default ''
);

create table if not exists holders (
  id serial primary key,
  box_no text unique,
  first_name text not null,
  last_name text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  phone text not null default '',
  email text not null default '',
  date_given date,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists receipt_counters (
  year int primary key,
  last_no int not null
);

create table if not exists receipts (
  id serial primary key,
  receipt_no text not null unique,
  holder_id int not null references holders(id),
  collected_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  counted_by text not null default '',
  note text not null default '',
  donor_name text not null,
  donor_address text not null default '',
  donor_email text not null default '',
  box_no text not null default '',
  email_status text not null default 'not_sent',  -- not_sent | sent | failed
  email_error text not null default '',
  emailed_at timestamptz,
  voided boolean not null default false,
  void_reason text not null default '',
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create index if not exists receipts_holder_idx on receipts(holder_id);
create index if not exists receipts_date_idx on receipts(collected_on);

create table if not exists report_sends (
  id serial primary key,
  month text not null,               -- 'YYYY-MM'
  trigger text not null,             -- 'auto' | 'manual'
  recipients text not null,
  pickups int not null default 0,
  total numeric(12,2) not null default 0,
  status text not null,              -- 'sent' | 'failed'
  error text not null default '',
  sent_at timestamptz not null default now()
);
`;

export const DEFAULT_SETTINGS = {
  org_name: 'Sadiger Institution in Israel',
  legal_name: '',
  ein: '',
  tax_status: '501(c)(3) public charity',
  address: '',
  phone: '',
  email: '',
  website: 'givetosadiger.org',
  signer_name: '',
  signer_title: 'Treasurer',
  receipt_start: '1',
  overdue_days: '90',
  due_soon_days: '60',
  thank_you: 'Thank you for your generosity.',
  israel_email: '',
  report_cc: '',
  report_auto: '1',
  logo: '',
  signature: '',
};

export async function migrate() {
  await pool.query(SCHEMA);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query('insert into settings(key, value) values ($1, $2) on conflict (key) do nothing', [key, value]);
  }
}

export async function getSettings() {
  const rows = await query('select key, value from settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
