-- 020: the shared free limit per network (20 credits a day across every free account on one IP)
-- now answers with its own pool, 'ip_limit', so the app can say what really happened instead of
-- "You've used today's free AI credits" (the user's own count may still show credits left).
-- Same function as before otherwise. The enhance function (v-next) groups IPv6 addresses by /64.
create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null::bigint)
 returns table(ok boolean, plan text, used integer, quota integer, remaining integer, usage_id bigint, photo bigint, pool text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
      return query select false, a.plan, a.used, a.quota, 0, null::bigint, null::bigint, 'ip_limit'::text; return;
    end if;
  end if;
  if v_from_bonus then
    update public.profiles set bonus_credits = bonus_credits - v_cost where id = p_user;
  end if;
  insert into public.ai_usage (user_id, mode, ip, cost, from_bonus) values (p_user, p_mode, p_ip, v_cost, v_from_bonus) returning id into v_id;
  return query select true, a.plan, a.used + v_cost, a.quota, a.remaining - v_cost, v_id, null::bigint, a.pool;
end;
$function$;
