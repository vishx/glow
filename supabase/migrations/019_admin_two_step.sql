-- 019: two-step login for the admin page. After the admin key, the page asks for a 6-digit code from an
-- authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, ...). No email needed.
--   * admin_security: one row. The authenticator secret, a pending one while setting up, and hashes of
--     the 8 one-time recovery codes (for a lost phone).
--   * admin_sessions: the browsers that passed the code (hashed tokens), for 12 hours or 30 days.
--   * admin_login_attempts: wrong codes, so guessing is cut off after 5 in 10 minutes.
-- Only the admin function (service role) can read or write these tables.
-- Lost your phone AND your recovery codes? Run this in the SQL editor to turn two-step login off:
--   update public.admin_security set totp_secret = null, enabled_at = null, recovery_hashes = '{}'; delete from public.admin_sessions;
-- Run once in the Supabase SQL editor (the whole file), before deploying the admin function.

create table if not exists public.admin_security (
  id int primary key default 1 check (id = 1),
  totp_secret text,
  pending_secret text,
  enabled_at timestamptz,
  recovery_hashes text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.admin_security (id) values (1) on conflict (id) do nothing;
alter table public.admin_security enable row level security;

create table if not exists public.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  device text
);
create index if not exists admin_sessions_expires_idx on public.admin_sessions (expires_at);
alter table public.admin_sessions enable row level security;

create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists admin_login_attempts_idx on public.admin_login_attempts (created_at desc);
alter table public.admin_login_attempts enable row level security;
