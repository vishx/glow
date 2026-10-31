-- Admin tracking, round 2 (audit of 2026-10-31). Run once in the Supabase SQL editor; safe to run again.
--   * Every RevenueCat event (purchases, renewals, trials, cancellations, refunds, billing issues),
--     with the price, so the admin page shows real revenue instead of an estimate.
--   * A record that an account was deleted (no ID or personal data kept), so deletions are counted.
--   * AI runs are kept (anonymously) when an account is deleted, so costs don't disappear.
--   * Each AI run's outcome (succeeded / failed), how long it took and Replicate's error message.
--   * Reports for the admin page: feature use, funnel, AI quality, revenue.
--   * Deletes old diagnostics every night, as the privacy policy promises.
--   * Closes an advisor warning: the row-limit trigger function can no longer be called directly.

-- Subscriptions ------------------------------------------------------------------------------
create table if not exists public.subscription_events (
  id bigint generated always as identity primary key,
  event_id text unique,                       -- RevenueCat's event id: a resent webhook is stored once
  user_id uuid,                               -- no foreign key: the history outlives a deleted account
  type text not null,
  product_id text,
  period_type text,                           -- NORMAL, TRIAL or INTRO
  store text,                                 -- APP_STORE, PLAY_STORE, ...
  environment text,                           -- PRODUCTION or SANDBOX (test purchases)
  price_usd numeric(10, 2),                   -- RevenueCat's USD price; negative for refunds
  currency text,
  price_local numeric(12, 2),
  cancel_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists subscription_events_created_idx on public.subscription_events (created_at desc);
create index if not exists subscription_events_user_idx on public.subscription_events (user_id, created_at desc);
alter table public.subscription_events enable row level security;   -- service role only

-- Deleted accounts ---------------------------------------------------------------------------
create table if not exists public.account_deletions (
  id bigint generated always as identity primary key,
  plan text,
  account_age_days int,
  ai_runs int,
  created_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;   -- service role only

-- AI run outcome -----------------------------------------------------------------------------
alter table public.ai_usage
  add column if not exists status text,
  add column if not exists finished_at timestamptz,
  add column if not exists error text check (error is null or length(error) <= 300);

-- A deleted account's AI runs stay, without the account or IP address, so past costs and usage
-- don't vanish from the reports. The account function clears the IP before deleting.
alter table public.ai_usage alter column user_id drop not null;
alter table public.ai_usage drop constraint if exists ai_usage_user_id_fkey;
alter table public.ai_usage add constraint ai_usage_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- The trigger still runs; it just can't be called on its own through the API.
revoke all on function public.limit_app_rows() from public, anon, authenticated;

-- Retention -----------------------------------------------------------------------------------
-- The privacy policy promises events are kept at most 180 days and error reports 60 days, and
-- IP addresses only a few days. This runs every night (pg_cron); the admin page also runs it.
create or replace function public.purge_old_diagnostics()
returns void language sql security definer set search_path = ''
as $$
  delete from public.app_events where created_at < now() - interval '180 days';
  delete from public.app_errors where created_at < now() - interval '60 days';
  update public.ai_usage set ip = null where ip is not null and created_at < now() - interval '2 days';
$$;
revoke all on function public.purge_old_diagnostics() from public, anon, authenticated;
grant execute on function public.purge_old_diagnostics() to service_role;
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('glow-purge-diagnostics') where exists (select 1 from cron.job where jobname = 'glow-purge-diagnostics');
  perform cron.schedule('glow-purge-diagnostics', '17 3 * * *', 'select public.purge_old_diagnostics()');
exception when others then
  raise notice 'pg_cron not available (%); the admin page still clears old diagnostics when opened.', sqlerrm;
end $$;

-- Reports ------------------------------------------------------------------------------------
-- The daily table gains real revenue (production purchases and renewals minus refunds, in USD,
-- before store fees), new Pro subscriptions and deleted accounts.
drop function if exists public.admin_daily(int);
create function public.admin_daily(p_days int default 14)
returns table(day date, new_users int, active_users int, ai_runs int, ai_failed int, credits int, ai_cost numeric,
              ads int, errors int, support int, paywall_views int, purchases int, revenue numeric, new_subs int, deletions int)
language sql stable security definer set search_path = ''
as $$
  with lim as (select least(greatest(p_days, 1), 90) n),
  days as (select generate_series(current_date - ((select n from lim) - 1), current_date, interval '1 day')::date d),
  u as (
    select u.created_at::date d, count(*) runs, count(*) filter (where u.refunded) failed,
           sum(u.cost) filter (where not u.refunded) credits,
           sum(coalesce(c.usd, dflt.usd)) filter (where u.prediction_id is not null) cost
    from public.ai_usage u
    left join public.ai_mode_costs c on c.mode = u.mode
    cross join (select usd from public.ai_mode_costs where mode = 'default') dflt
    where u.created_at >= current_date - ((select n from lim) - 1)
    group by 1),
  ev as (
    select e.created_at::date d,
           count(*) filter (where e.name = 'paywall_view') pv, count(*) filter (where e.name = 'purchase') buys
    from public.app_events e where e.created_at >= current_date - ((select n from lim) - 1) group by 1),
  act as (
    select x.d, count(distinct x.user_id) users from (
      select created_at::date d, user_id from public.ai_usage where created_at >= current_date - ((select n from lim) - 1)
      union select created_at::date, user_id from public.app_events where created_at >= current_date - ((select n from lim) - 1)
    ) x group by 1),
  sub as (
    select s.created_at::date d, sum(s.price_usd) rev,
           count(*) filter (where s.type = 'INITIAL_PURCHASE') subs
    from public.subscription_events s
    where s.environment is distinct from 'SANDBOX' and s.created_at >= current_date - ((select n from lim) - 1) group by 1)
  select days.d,
    (select count(*) from auth.users a where a.created_at::date = days.d)::int,
    coalesce(act.users, 0)::int,
    coalesce(u.runs, 0)::int, coalesce(u.failed, 0)::int, coalesce(u.credits, 0)::int, round(coalesce(u.cost, 0), 3),
    (select count(*) from public.ad_rewards r where r.created_at::date = days.d)::int,
    (select count(*) from public.app_errors x where x.created_at::date = days.d)::int,
    (select count(*) from public.support_requests s where s.created_at::date = days.d)::int,
    coalesce(ev.pv, 0)::int, coalesce(ev.buys, 0)::int,
    round(coalesce(sub.rev, 0), 2), coalesce(sub.subs, 0)::int,
    (select count(*) from public.account_deletions x where x.created_at::date = days.d)::int
  from days left join u on u.d = days.d left join ev on ev.d = days.d left join act on act.d = days.d left join sub on sub.d = days.d
  order by days.d desc;
$$;
revoke all on function public.admin_daily(int) from public, anon, authenticated;
grant execute on function public.admin_daily(int) to service_role;

-- How each feature is used: every app event name with its count, people and the most common detail.
create or replace function public.admin_features(p_days int default 7)
returns table(name text, events int, users int, top_detail text)
language sql stable security definer set search_path = ''
as $$
  with e as (
    select * from public.app_events
    where created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))),
  d as (
    select e.name, coalesce(e.props->>'tool', e.props->>'mode', e.props->>'id', e.props->>'from', e.props->>'dest', e.props->>'state', e.props->>'msg', '') v, count(*) c
    from e group by 1, 2),
  top as (select distinct on (d.name) d.name, nullif(d.v, '') || ' (' || d.c || ')' t from d order by d.name, d.c desc)
  select e.name, count(*)::int, count(distinct e.user_id)::int, top.t
  from e left join top on top.name = e.name
  group by e.name, top.t order by 2 desc;
$$;
revoke all on function public.admin_features(int) from public, anon, authenticated;
grant execute on function public.admin_features(int) to service_role;

-- Funnel over p_days: of the people who used the app at all, how many picked a photo, edited, ran AI,
-- saved, saw the paywall and bought.
create or replace function public.admin_funnel(p_days int default 7)
returns table(step int, label text, users int)
language sql stable security definer set search_path = ''
as $$
  with e as (
    select user_id, name from public.app_events
    where created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90)))
  select * from (values
    (1, 'Used Glow', (select count(distinct user_id) from e)::int),
    (2, 'Opened a photo or the camera', (select count(distinct user_id) from e where name in ('photo_open', 'capture', 'sample_open'))::int),
    (3, 'Edited or used AI', (select count(distinct user_id) from e where name in ('edit', 'ai_start'))::int),
    (4, 'Saved or shared', (select count(distinct user_id) from e where name in ('save', 'share'))::int),
    (5, 'Saw Glow Pro', (select count(distinct user_id) from e where name = 'paywall_view')::int),
    (6, 'Bought Glow Pro', (select count(distinct user_id) from e where name = 'purchase')::int)
  ) v(step, label, users);
$$;
revoke all on function public.admin_funnel(int) from public, anon, authenticated;
grant execute on function public.admin_funnel(int) to service_role;

-- AI quality per tool: success rate, typical time, and the most common error.
create or replace function public.admin_ai_quality(p_days int default 7)
returns table(mode text, runs int, succeeded int, failed int, pending int, median_secs numeric, top_error text)
language sql stable security definer set search_path = ''
as $$
  with u as (
    select * from public.ai_usage
    where created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
      and status is distinct from 'duplicate'),   -- a resent request, refunded and not a real run
  err as (
    select distinct on (mode) mode, error || ' (' || count(*) over (partition by mode, error) || ')' e
    from u where error is not null order by mode, count(*) over (partition by mode, error) desc)
  select u.mode, count(*)::int,
    count(*) filter (where u.status = 'succeeded')::int,
    count(*) filter (where u.status in ('failed', 'canceled'))::int,
    -- Still running (runs from before this migration have no outcome and count in neither column).
    count(*) filter (where u.status is null and not u.refunded and u.created_at > now() - interval '15 minutes')::int,
    round((percentile_cont(0.5) within group (order by extract(epoch from u.finished_at - u.created_at))
      filter (where u.status = 'succeeded'))::numeric, 1),
    max(err.e)
  from u left join err on err.mode = u.mode
  group by u.mode order by 2 desc;
$$;
revoke all on function public.admin_ai_quality(int) from public, anon, authenticated;
grant execute on function public.admin_ai_quality(int) to service_role;
