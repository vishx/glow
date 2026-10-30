-- Pricing v2 (owner chose $4.99/week, $49.99/year on 2026-10-30). NOT applied yet: the owner runs it
-- in the SQL editor after the store and RevenueCat prices are changed.
-- 1. Fill and Expand use FLUX Fill Pro (about $0.05 a run), so they cost 2 credits.
-- 2. The yearly plan keeps 40 credits per rolling week and adds a cap of 80 per rolling 30 days.
alter table public.profiles add column if not exists plan_period text check (plan_period in ('weekly', 'yearly'));

create or replace function public.ai_edit_cost(p_mode text) returns int
language sql immutable set search_path = ''
as $$ select case when p_mode in ('headshot', 'anime', 'watercolor', 'fashion', 'fill', 'expand') then 2 else 1 end $$;

create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint, photo bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text; v_period text; v_quota int; v_since timestamptz; v_used int; v_month int; v_ip_used int; v_id bigint; v_bonus int;
  v_cost int := public.ai_edit_cost(p_mode);
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period
    into v_plan, v_period from public.profiles p where p.id = p_user for update;
  if v_plan = 'pro' then v_quota := 40; v_since := now() - interval '7 days';
  else
    v_since := date_trunc('day', now());
    select least(count(*), 3) into v_bonus from public.ad_rewards r where r.user_id = p_user and r.created_at >= v_since;
    v_quota := 3 + v_bonus;
  end if;
  select coalesce(sum(u.cost), 0) into v_used from public.ai_usage u
    where u.user_id = p_user and u.created_at >= v_since and not u.refunded;

  if v_used + v_cost > v_quota then
    return query select false, v_plan, v_used, v_quota, greatest(v_quota - v_used, 0), null::bigint, null::bigint; return;
  end if;
  if v_plan = 'pro' and v_period = 'yearly' then
    select coalesce(sum(u.cost), 0) into v_month from public.ai_usage u
      where u.user_id = p_user and u.created_at >= now() - interval '30 days' and not u.refunded;
    if v_month + v_cost > 80 then
      return query select false, v_plan, v_used, v_quota, 0, null::bigint, null::bigint; return;
    end if;
  end if;
  if v_plan = 'free' and p_ip is not null then
    perform pg_advisory_xact_lock(hashtext(p_ip));
    select coalesce(sum(u.cost), 0) into v_ip_used from public.ai_usage u join public.profiles p on p.id = u.user_id
      where u.ip = p_ip and u.created_at >= v_since and not u.refunded
        and not (p.plan = 'pro' and p.plan_expires_at > now());
    if v_ip_used + v_cost > 20 then
      return query select false, v_plan, v_quota, v_quota, 0, null::bigint, null::bigint; return;
    end if;
  end if;
  insert into public.ai_usage (user_id, mode, ip, cost) values (p_user, p_mode, p_ip, v_cost) returning id into v_id;
  return query select true, v_plan, v_used + v_cost, v_quota, v_quota - v_used - v_cost, v_id, null::bigint;
end;
$$;
revoke all on function public.consume_ai_edit(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text, bigint) to service_role;
