-- Running Glow as a business: what the admin page (functions/admin) and the in-app support,
-- error and usage reporting need. Run once in the Supabase SQL editor. Safe to run again.
--   * Block a user or an internet address from AI tools.
--   * Bonus credits that support can give a user (used after their plan's credits).
--   * Support messages from the app's Contact support form.
--   * App errors and a few anonymous usage events (no photos, no personal details).
--   * An estimated AI cost per tool, for the cost-per-day report.
--   * An audit log of every change made from the admin page.

-- Blocking and bonus credits ----------------------------------------------------------------
alter table public.profiles
  add column if not exists bonus_credits int not null default 0 check (bonus_credits >= 0),
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;
alter table public.ai_usage add column if not exists from_bonus boolean not null default false;

create table if not exists public.blocked_ips (
  ip text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.blocked_ips enable row level security;   -- service role only

-- The same rules as migration 007/008, except that runs paid with bonus credits don't count
-- against the plan, and `remaining` now includes the user's bonus credits.
drop function if exists public.ai_allowance(uuid, text);
create function public.ai_allowance(p_user uuid, p_mode text default null)
returns table(plan text, period text, pool text, used int, quota int, remaining int, trial_left int, ads_left int, bonus int, blocked boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_plan text; v_period text; v_since timestamptz; v_bonus int; v_cheap int; v_trial int; v_week int; v_month int;
  v_extra int; v_blocked boolean;
begin
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period,
         coalesce(p.bonus_credits, 0), p.blocked_at is not null
    into v_plan, v_period, v_extra, v_blocked from public.profiles p where p.id = p_user;
  v_plan := coalesce(v_plan, 'free'); v_extra := coalesce(v_extra, 0); v_blocked := coalesce(v_blocked, false);
  if v_plan = 'pro' then
    select coalesce(sum(u.cost), 0) into v_week from public.ai_usage u
      where u.user_id = p_user and not u.refunded and not u.from_bonus and u.created_at >= now() - interval '7 days';
    if v_period = 'yearly' then
      select coalesce(sum(u.cost), 0) into v_month from public.ai_usage u
        where u.user_id = p_user and not u.refunded and not u.from_bonus and u.created_at >= now() - interval '30 days';
      return query select v_plan, v_period, 'pro'::text, v_week, 40, greatest(0, least(40 - v_week, 80 - v_month)) + v_extra, 0, 0, v_extra, v_blocked;
    else
      return query select v_plan, v_period, 'pro'::text, v_week, 40, greatest(0, 40 - v_week) + v_extra, 0, 0, v_extra, v_blocked;
    end if;
    return;
  end if;
  v_since := date_trunc('day', now());
  select least(count(*), 1) into v_bonus from public.ad_rewards r where r.user_id = p_user and r.created_at >= v_since;
  select coalesce(sum(u.cost), 0) into v_cheap from public.ai_usage u
    where u.user_id = p_user and not u.refunded and not u.from_bonus and u.created_at >= v_since and not public.ai_mode_premium(u.mode);
  select coalesce(sum(u.cost), 0) into v_trial from public.ai_usage u
    where u.user_id = p_user and not u.refunded and not u.from_bonus and public.ai_mode_premium(u.mode);
  if p_mode is not null and public.ai_mode_premium(p_mode) then
    return query select v_plan, null::text, 'trial'::text, v_trial, 3, greatest(0, 3 - v_trial) + v_extra, greatest(0, 3 - v_trial), 1 - v_bonus, v_extra, v_blocked;
  else
    return query select v_plan, null::text, 'daily'::text, v_cheap, 3 + v_bonus, greatest(0, 3 + v_bonus - v_cheap) + v_extra, greatest(0, 3 - v_trial), 1 - v_bonus, v_extra, v_blocked;
  end if;
end;
$$;
revoke all on function public.ai_allowance(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_allowance(uuid, text) to service_role;

create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint, photo bigint, pool text)
language plpgsql security definer set search_path = ''
as $$
declare
  a record; v_ip_used int; v_id bigint; v_from_bonus boolean := false;
  v_cost int := public.ai_edit_cost(p_mode);
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  perform 1 from public.profiles p where p.id = p_user for update;   -- one charge at a time per user
  select * into a from public.ai_allowance(p_user, p_mode);
  if a.blocked or (p_ip is not null and exists (select 1 from public.blocked_ips b where b.ip = p_ip)) then
    return query select false, a.plan, a.used, a.quota, 0, null::bigint, null::bigint, 'blocked'::text; return;
  end if;
  if a.remaining < v_cost then
    return query select false, a.plan, a.used, a.quota, a.remaining, null::bigint, null::bigint, a.pool; return;
  end if;
  -- The plan's own credits go first; bonus credits only cover what the plan can't.
  v_from_bonus := a.remaining - a.bonus < v_cost;
  if a.plan = 'free' and p_ip is not null and not v_from_bonus then
    perform pg_advisory_xact_lock(hashtext(p_ip));
    select coalesce(sum(u.cost), 0) into v_ip_used from public.ai_usage u join public.profiles p on p.id = u.user_id
      where u.ip = p_ip and u.created_at >= date_trunc('day', now()) and not u.refunded and not u.from_bonus
        and not (p.plan = 'pro' and p.plan_expires_at > now());
    if v_ip_used + v_cost > 20 then
      return query select false, a.plan, a.quota, a.quota, 0, null::bigint, null::bigint, a.pool; return;
    end if;
  end if;
  if v_from_bonus then
    update public.profiles set bonus_credits = bonus_credits - v_cost where id = p_user;
  end if;
  insert into public.ai_usage (user_id, mode, ip, cost, from_bonus) values (p_user, p_mode, p_ip, v_cost, v_from_bonus) returning id into v_id;
  return query select true, a.plan, a.used + v_cost, a.quota, a.remaining - v_cost, v_id, null::bigint, a.pool;
end;
$$;
revoke all on function public.consume_ai_edit(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text, bigint) to service_role;

-- Refunding a run paid with bonus credits gives those credits back. Refunding twice does nothing.
create or replace function public.refund_ai_edit(p_usage bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  update public.ai_usage set refunded = true where id = p_usage and not refunded returning user_id, cost, from_bonus into r;
  if found and r.from_bonus then
    update public.profiles set bonus_credits = bonus_credits + r.cost where id = r.user_id;
  end if;
end;
$$;
revoke all on function public.refund_ai_edit(bigint) from public, anon, authenticated;
grant execute on function public.refund_ai_edit(bigint) to service_role;

-- Support messages (written by functions/account, read on the admin page) ------------------
create table if not exists public.support_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text check (email is null or length(email) <= 200),
  topic text not null default 'other' check (topic in ('billing', 'ai', 'bug', 'privacy', 'other')),
  message text not null check (length(message) between 1 and 4000),
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) < 4000),
  status text not null default 'open' check (status in ('open', 'closed')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists support_requests_status_idx on public.support_requests (status, created_at desc);
alter table public.support_requests enable row level security;   -- service role only

-- App errors and usage events, written by the app straight to the database ------------------
-- Each user can only add rows for their own account, and a trigger quietly drops anything past
-- a sensible hourly limit, so a broken or hostile client can't flood the tables.
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  message text not null check (length(message) <= 500),
  detail text check (length(detail) <= 2000),
  build text check (length(build) <= 40),
  platform text check (length(platform) <= 20),
  created_at timestamptz not null default now()
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
alter table public.app_errors enable row level security;
drop policy if exists "add own errors" on public.app_errors;
create policy "add own errors" on public.app_errors for insert to authenticated with check ((select auth.uid()) = user_id);

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,39}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 1000),
  platform text check (length(platform) <= 20),
  created_at timestamptz not null default now()
);
create index if not exists app_events_name_idx on public.app_events (name, created_at);
create index if not exists app_events_created_idx on public.app_events (created_at);
alter table public.app_events enable row level security;
drop policy if exists "add own events" on public.app_events;
create policy "add own events" on public.app_events for insert to authenticated with check ((select auth.uid()) = user_id);

create or replace function public.limit_app_rows() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if tg_table_name = 'app_errors' then
    select count(*) into n from public.app_errors where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 30 then return null; end if;
  else
    select count(*) into n from public.app_events where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 300 then return null; end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists app_errors_limit on public.app_errors;
create trigger app_errors_limit before insert on public.app_errors for each row execute function public.limit_app_rows();
drop trigger if exists app_events_limit on public.app_events;
create trigger app_events_limit before insert on public.app_events for each row execute function public.limit_app_rows();
create index if not exists app_errors_user_idx on public.app_errors (user_id, created_at);
create index if not exists app_events_user_idx on public.app_events (user_id, created_at);

-- Estimated Replicate cost of one run of each tool, in US dollars (cost audit, 2026-10-30).
-- Edit the numbers here as real invoices come in; tools not listed use the 'default' row.
create table if not exists public.ai_mode_costs (
  mode text primary key,
  usd numeric(8, 4) not null check (usd >= 0)
);
alter table public.ai_mode_costs enable row level security;   -- service role only
insert into public.ai_mode_costs (mode, usd) values
  ('default', 0.039), ('enhance', 0.004), ('upscale', 0.004), ('faces', 0.004), ('retouch', 0.004),
  ('colorize', 0.001), ('erase', 0.001), ('bgcut', 0.002), ('older', 0.010), ('younger', 0.010),
  ('toon3d', 0.020), ('clay', 0.020), ('headshot', 0.025), ('anime', 0.025), ('watercolor', 0.025),
  ('fashion', 0.025), ('fill', 0.050), ('expand', 0.050), ('bgscene', 0.050), ('custom', 0.039), ('outfit', 0.039)
on conflict (mode) do nothing;

-- Audit log of admin changes -----------------------------------------------------------------
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;   -- service role only

-- Reports for the admin page ------------------------------------------------------------------
-- One row per day (UTC): new accounts, active users, AI runs, failed runs, credits, estimated
-- AI cost, ad credits, app errors, support messages and paywall views/purchases from app events.
create or replace function public.admin_daily(p_days int default 14)
returns table(day date, new_users int, active_users int, ai_runs int, ai_failed int, credits int, ai_cost numeric,
              ads int, errors int, support int, paywall_views int, purchases int)
language sql stable security definer set search_path = ''
as $$
  with days as (select generate_series(current_date - (least(greatest(p_days, 1), 90) - 1), current_date, interval '1 day')::date d),
  u as (
    select u.created_at::date d, count(*) runs, count(*) filter (where u.refunded) failed,
           sum(u.cost) filter (where not u.refunded) credits,
           sum(coalesce(c.usd, dflt.usd)) filter (where u.prediction_id is not null) cost
    from public.ai_usage u
    left join public.ai_mode_costs c on c.mode = u.mode
    cross join (select usd from public.ai_mode_costs where mode = 'default') dflt
    where u.created_at >= current_date - (least(greatest(p_days, 1), 90) - 1)
    group by 1),
  ev as (
    select e.created_at::date d,
           count(*) filter (where e.name = 'paywall_view') pv, count(*) filter (where e.name = 'purchase') buys
    from public.app_events e where e.created_at >= current_date - (least(greatest(p_days, 1), 90) - 1) group by 1),
  act as (
    select x.d, count(distinct x.user_id) users from (
      select created_at::date d, user_id from public.ai_usage where created_at >= current_date - (least(greatest(p_days, 1), 90) - 1)
      union select created_at::date, user_id from public.app_events where created_at >= current_date - (least(greatest(p_days, 1), 90) - 1)
    ) x group by 1)
  select days.d,
    (select count(*) from auth.users a where a.created_at::date = days.d)::int,
    coalesce(act.users, 0)::int,
    coalesce(u.runs, 0)::int, coalesce(u.failed, 0)::int, coalesce(u.credits, 0)::int, round(coalesce(u.cost, 0), 3),
    (select count(*) from public.ad_rewards r where r.created_at::date = days.d)::int,
    (select count(*) from public.app_errors x where x.created_at::date = days.d)::int,
    (select count(*) from public.support_requests s where s.created_at::date = days.d)::int,
    coalesce(ev.pv, 0)::int, coalesce(ev.buys, 0)::int
  from days left join u on u.d = days.d left join ev on ev.d = days.d left join act on act.d = days.d
  order by days.d desc;
$$;
revoke all on function public.admin_daily(int) from public, anon, authenticated;
grant execute on function public.admin_daily(int) to service_role;

-- AI runs per tool over the last p_days days: runs, failures, credits and estimated cost.
create or replace function public.admin_tools(p_days int default 7)
returns table(mode text, runs int, failed int, credits int, ai_cost numeric)
language sql stable security definer set search_path = ''
as $$
  select u.mode, count(*)::int, count(*) filter (where u.refunded)::int,
         coalesce(sum(u.cost) filter (where not u.refunded), 0)::int,
         round(coalesce(sum(coalesce(c.usd, (select usd from public.ai_mode_costs where mode = 'default'))) filter (where u.prediction_id is not null), 0), 3)
  from public.ai_usage u left join public.ai_mode_costs c on c.mode = u.mode
  where u.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
  group by u.mode order by 2 desc;
$$;
revoke all on function public.admin_tools(int) from public, anon, authenticated;
grant execute on function public.admin_tools(int) to service_role;

-- Accounts that used the most AI in the last 24 hours (to spot abuse), with how many accounts
-- shared their address.
create or replace function public.admin_heavy_users(p_limit int default 20)
returns table(user_id uuid, plan text, runs int, credits int, ips int, last_ip text, blocked boolean)
language sql stable security definer set search_path = ''
as $$
  select u.user_id,
         case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end,
         count(*)::int, coalesce(sum(u.cost) filter (where not u.refunded), 0)::int,
         count(distinct u.ip)::int, max(u.ip), p.blocked_at is not null
  from public.ai_usage u join public.profiles p on p.id = u.user_id
  where u.created_at >= now() - interval '24 hours'
  group by u.user_id, p.plan, p.plan_expires_at, p.blocked_at
  order by 3 desc limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.admin_heavy_users(int) from public, anon, authenticated;
grant execute on function public.admin_heavy_users(int) to service_role;

-- Newest accounts, or those whose id starts with p_query, with their plan and AI use.
create or replace function public.admin_users(p_query text default null, p_limit int default 50)
returns table(user_id uuid, created_at timestamptz, last_seen timestamptz, plan text, plan_period text, plan_expires_at timestamptz,
              bonus_credits int, blocked boolean, runs_7d int, credits_7d int, runs_total int)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.created_at, a.last_sign_in_at,
         case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period, p.plan_expires_at,
         coalesce(p.bonus_credits, 0), p.blocked_at is not null,
         (select count(*) from public.ai_usage u where u.user_id = a.id and u.created_at >= now() - interval '7 days')::int,
         (select coalesce(sum(u.cost), 0) from public.ai_usage u where u.user_id = a.id and not u.refunded and u.created_at >= now() - interval '7 days')::int,
         (select count(*) from public.ai_usage u where u.user_id = a.id)::int
  from auth.users a left join public.profiles p on p.id = a.id
  where p_query is null or p_query = '' or a.id::text like lower(trim(p_query)) || '%'
  order by a.created_at desc limit least(greatest(p_limit, 1), 200);
$$;
revoke all on function public.admin_users(text, int) from public, anon, authenticated;
grant execute on function public.admin_users(text, int) to service_role;

-- How many accounts are on each plan right now.
create or replace function public.admin_plans()
returns table(accounts int, pro_weekly int, pro_yearly int, pro_other int, blocked int, bonus_outstanding int)
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from auth.users)::int,
    count(*) filter (where p.plan = 'pro' and p.plan_expires_at > now() and p.plan_period = 'weekly')::int,
    count(*) filter (where p.plan = 'pro' and p.plan_expires_at > now() and p.plan_period = 'yearly')::int,
    count(*) filter (where p.plan = 'pro' and p.plan_expires_at > now() and p.plan_period is null)::int,
    count(*) filter (where p.blocked_at is not null)::int,
    coalesce(sum(p.bonus_credits), 0)::int
  from public.profiles p;
$$;
revoke all on function public.admin_plans() from public, anon, authenticated;
grant execute on function public.admin_plans() to service_role;
