-- 013: Feature switches (feature flags) for every Glow Studio tool and feature.
--
-- The owner switches tools on and off from the admin page (Features tab) with no app release.
-- The app asks my_features() on launch and when it comes back to the front, keeps the answer
-- for offline use, and falls back to its built-in defaults (public/features.js) when it has
-- never heard from the server. The enhance function checks feature_on() before it charges,
-- so a switched-off AI tool can never cost anyone a credit.
--
-- A key with no row here simply follows the app's built-in default. Each row is one of:
--   off      nobody (instant kill switch)
--   testers  only the accounts in feature_testers
--   rollout  testers plus `percent`% of everyone else, picked by a stable hash of the key and
--            the account, so the same people keep it as the percentage grows
--   on       everyone
-- `platforms` (web, ios, android) and `min_build` (the APP_BUILD number in features.js) limit
-- any state except off, for example "on, but only in phone builds that have the fix".
-- Safe to run more than once.

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9:_.-]{1,64}$'),
  status text not null default 'on' check (status in ('off', 'testers', 'rollout', 'on')),
  percent int not null default 0 check (percent between 0 and 100),
  platforms text[] check (platforms is null or platforms <@ array['web', 'ios', 'android']::text[]),
  min_build int check (min_build is null or min_build > 0),
  note text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_testers (
  user_id uuid primary key,
  label text check (label is null or length(label) <= 80),
  created_at timestamptz not null default now()
);

-- Only the service role (admin and enhance functions) reads or writes these tables directly.
alter table public.feature_flags enable row level security;
alter table public.feature_testers enable row level security;
revoke all on public.feature_flags, public.feature_testers from anon, authenticated;

-- 0-99, the same for a key and an account every time; a different key reshuffles people, so one
-- account isn't first in line for every rollout.
create or replace function public.feature_bucket(p_key text, p_user uuid)
returns int language sql immutable as $$
  select (('x' || lpad(substr(md5(p_key || ':' || p_user::text), 1, 8), 16, '0'))::bit(64)::bigint % 100)::int
$$;

-- One switch for one account: null when there is no row (the app's own default applies).
create or replace function public.feature_on(p_key text, p_user uuid, p_platform text default null, p_build int default null)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when f.key is null then null
    when f.status = 'off' then false
    when f.platforms is not null and (p_platform is null or not p_platform = any (f.platforms)) then false
    when f.min_build is not null and (p_build is null or p_build < f.min_build) then false
    when f.status = 'on' then true
    when p_user is not null and exists (select 1 from feature_testers t where t.user_id = p_user) then true
    when f.status = 'rollout' and p_user is not null then feature_bucket(f.key, p_user) < f.percent
    else false
  end
  from (select 1) one left join feature_flags f on f.key = p_key
$$;

-- Every switch with a row, worked out for the signed-in account. The app calls this through the
-- REST API with its own token, so auth.uid() is the person asking and nobody can ask for another.
create or replace function public.my_features(p_platform text default null, p_build int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'flags', coalesce((select jsonb_object_agg(f.key, feature_on(f.key, auth.uid(), p_platform, p_build)) from feature_flags f), '{}'::jsonb),
    'tester', auth.uid() is not null and exists (select 1 from feature_testers t where t.user_id = auth.uid()),
    'at', now()
  )
$$;

revoke all on function public.feature_bucket(text, uuid) from public, anon, authenticated;
revoke all on function public.feature_on(text, uuid, text, int) from public, anon, authenticated;
revoke all on function public.my_features(text, int) from public, anon;
grant execute on function public.my_features(text, int) to authenticated;
grant execute on function public.feature_on(text, uuid, text, int) to service_role;
grant execute on function public.feature_bucket(text, uuid) to service_role;
