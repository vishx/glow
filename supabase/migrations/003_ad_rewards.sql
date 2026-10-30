-- Rewarded ads: each finished ad (confirmed by Google) gives one extra free AI
-- edit that day, up to 3 a day.
create table if not exists public.ad_rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists ad_rewards_user_idx on public.ad_rewards (user_id, created_at);
alter table public.ad_rewards enable row level security;
create policy "read own rewards" on public.ad_rewards for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text; v_quota int; v_since timestamptz; v_used int; v_ip_used int; v_id bigint; v_bonus int;
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end
    into v_plan from public.profiles p where p.id = p_user for update;
  if v_plan = 'pro' then v_quota := 50; v_since := now() - interval '7 days';
  else
    v_since := date_trunc('day', now());
    select least(count(*), 3) into v_bonus from public.ad_rewards r where r.user_id = p_user and r.created_at >= v_since;
    v_quota := 3 + v_bonus;
  end if;
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
revoke all on function public.consume_ai_edit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text) to service_role;
