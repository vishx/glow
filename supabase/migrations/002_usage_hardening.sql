alter table public.ai_usage
  add column if not exists prediction_id text,
  add column if not exists ip text,
  add column if not exists refunded boolean not null default false;
create index if not exists ai_usage_ip_idx on public.ai_usage (ip, created_at);
create index if not exists ai_usage_pred_idx on public.ai_usage (prediction_id);

drop function if exists public.consume_ai_edit(uuid, text);
drop function if exists public.refund_ai_edit(uuid);

-- Counts an AI edit against the user's plan. Free edits are also capped per
-- network address, so making new anonymous accounts can't give unlimited free edits.
create function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text; v_quota int; v_since timestamptz; v_used int; v_ip_used int; v_id bigint;
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end
    into v_plan from public.profiles p where p.id = p_user for update;
  if v_plan = 'pro' then v_quota := 50; v_since := now() - interval '7 days';
  else v_quota := 3; v_since := date_trunc('day', now()); end if;
  select count(*) into v_used from public.ai_usage u
    where u.user_id = p_user and u.created_at >= v_since and not u.refunded;
  if v_used >= v_quota then
    return query select false, v_plan, v_used, v_quota, 0, null::bigint; return;
  end if;
  if v_plan = 'free' and p_ip is not null then
    perform pg_advisory_xact_lock(hashtext(p_ip));
    select count(*) into v_ip_used from public.ai_usage u join public.profiles p on p.id = u.user_id
      where u.ip = p_ip and u.created_at >= v_since and not u.refunded
        and not (p.plan = 'pro' and p.plan_expires_at > now());
    if v_ip_used >= 20 then
      return query select false, v_plan, v_quota, v_quota, 0, null::bigint; return;
    end if;
  end if;
  insert into public.ai_usage (user_id, mode, ip) values (p_user, p_mode, p_ip) returning id into v_id;
  return query select true, v_plan, v_used + 1, v_quota, v_quota - v_used - 1, v_id;
end;
$$;

create function public.refund_ai_edit(p_usage bigint)
returns void language sql security definer set search_path = ''
as $$ update public.ai_usage set refunded = true where id = p_usage; $$;

revoke all on function public.consume_ai_edit(uuid, text, text) from public, anon, authenticated;
revoke all on function public.refund_ai_edit(bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text) to service_role;
grant execute on function public.refund_ai_edit(bigint) to service_role;

-- Pro always needs an end date; null used to mean "Pro forever".
update public.profiles set plan = 'free' where plan = 'pro' and plan_expires_at is null;
