-- Every AI edit uses credits, so no user can cost more than their plan earns.
-- Most tools cost 1 credit; the costlier portrait styles cost 2.
-- Free: 3 credits a day (+1 per optional ad, up to 3). Pro: 40 credits per rolling week.
alter table public.ai_usage add column if not exists cost smallint not null default 1;

create or replace function public.ai_edit_cost(p_mode text) returns int
language sql immutable set search_path = ''
as $$ select case when p_mode in ('headshot', 'anime', 'watercolor', 'fashion') then 2 else 1 end $$;

-- p_photo is kept so the server code keeps working, but it no longer makes edits free.
create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint, photo bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text; v_quota int; v_since timestamptz; v_used int; v_ip_used int; v_id bigint; v_bonus int;
  v_cost int := public.ai_edit_cost(p_mode);
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end
    into v_plan from public.profiles p where p.id = p_user for update;
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
