-- Pricing v2, chosen by the owner on 2026-10-30 and applied that day, followed by the account and
-- revenuecat-webhook functions.
--   Pro: $4.99/week or $49.99/year. 40 credits per rolling week; the yearly plan also has a cap of
--        80 credits per rolling 30 days (plan_period comes from the RevenueCat webhook).
--   Free: 3 credits a day for the low-cost tools (each costs Glow under a cent), plus 3 one-time
--        trial credits for the premium tools (Fill, Expand, Nano Banana edits, styles), plus at most
--        1 optional rewarded-ad credit a day (low-cost tools only).
--   Fill and Expand cost 2 credits (FLUX Fill Pro, about $0.05 a run).
alter table public.profiles add column if not exists plan_period text check (plan_period in ('weekly', 'yearly'));

create or replace function public.ai_edit_cost(p_mode text) returns int
language sql immutable set search_path = ''
as $$ select case when p_mode in ('headshot', 'anime', 'watercolor', 'fashion', 'fill', 'expand') then 2 else 1 end $$;

-- Low-cost tools. Anything not listed (including any future tool) counts as premium.
create or replace function public.ai_mode_premium(p_mode text) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p_mode, '') not in ('erase', 'enhance', 'upscale', 'faces', 'colorize', 'retouch', 'toon3d', 'clay', 'older', 'younger') $$;

-- The balance the app shows, and the rules consume_ai_edit enforces, in one place.
create or replace function public.ai_allowance(p_user uuid, p_mode text default null)
returns table(plan text, period text, pool text, used int, quota int, remaining int, trial_left int, ads_left int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_plan text; v_period text; v_since timestamptz; v_bonus int; v_cheap int; v_trial int; v_week int; v_month int;
begin
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period
    into v_plan, v_period from public.profiles p where p.id = p_user;
  v_plan := coalesce(v_plan, 'free');
  if v_plan = 'pro' then
    select coalesce(sum(u.cost), 0) into v_week from public.ai_usage u
      where u.user_id = p_user and not u.refunded and u.created_at >= now() - interval '7 days';
    if v_period = 'yearly' then
      select coalesce(sum(u.cost), 0) into v_month from public.ai_usage u
        where u.user_id = p_user and not u.refunded and u.created_at >= now() - interval '30 days';
      return query select v_plan, v_period, 'pro'::text, v_week, 40, greatest(0, least(40 - v_week, 80 - v_month)), 0, 0;
    else
      return query select v_plan, v_period, 'pro'::text, v_week, 40, greatest(0, 40 - v_week), 0, 0;
    end if;
    return;
  end if;
  v_since := date_trunc('day', now());
  select least(count(*), 1) into v_bonus from public.ad_rewards r where r.user_id = p_user and r.created_at >= v_since;
  select coalesce(sum(u.cost), 0) into v_cheap from public.ai_usage u
    where u.user_id = p_user and not u.refunded and u.created_at >= v_since and not public.ai_mode_premium(u.mode);
  select coalesce(sum(u.cost), 0) into v_trial from public.ai_usage u
    where u.user_id = p_user and not u.refunded and public.ai_mode_premium(u.mode);
  if p_mode is not null and public.ai_mode_premium(p_mode) then
    return query select v_plan, null::text, 'trial'::text, v_trial, 3, greatest(0, 3 - v_trial), greatest(0, 3 - v_trial), 1 - v_bonus;
  else
    return query select v_plan, null::text, 'daily'::text, v_cheap, 3 + v_bonus, greatest(0, 3 + v_bonus - v_cheap), greatest(0, 3 - v_trial), 1 - v_bonus;
  end if;
end;
$$;
revoke all on function public.ai_allowance(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_allowance(uuid, text) to service_role;

-- The return columns change (adds pool), so the old function is replaced.
drop function if exists public.consume_ai_edit(uuid, text, text, bigint);
create function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint, photo bigint, pool text)
language plpgsql security definer set search_path = ''
as $$
declare
  a record; v_ip_used int; v_id bigint;
  v_cost int := public.ai_edit_cost(p_mode);
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  perform 1 from public.profiles p where p.id = p_user for update;   -- one charge at a time per user
  select * into a from public.ai_allowance(p_user, p_mode);
  if a.remaining < v_cost then
    return query select false, a.plan, a.used, a.quota, a.remaining, null::bigint, null::bigint, a.pool; return;
  end if;
  if a.plan = 'free' and p_ip is not null then
    perform pg_advisory_xact_lock(hashtext(p_ip));
    select coalesce(sum(u.cost), 0) into v_ip_used from public.ai_usage u join public.profiles p on p.id = u.user_id
      where u.ip = p_ip and u.created_at >= date_trunc('day', now()) and not u.refunded
        and not (p.plan = 'pro' and p.plan_expires_at > now());
    if v_ip_used + v_cost > 20 then
      return query select false, a.plan, a.quota, a.quota, 0, null::bigint, null::bigint, a.pool; return;
    end if;
  end if;
  insert into public.ai_usage (user_id, mode, ip, cost) values (p_user, p_mode, p_ip, v_cost) returning id into v_id;
  return query select true, a.plan, a.used + v_cost, a.quota, a.remaining - v_cost, v_id, null::bigint, a.pool;
end;
$$;
revoke all on function public.consume_ai_edit(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text, bigint) to service_role;
