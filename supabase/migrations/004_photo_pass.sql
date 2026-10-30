-- One photo = one AI credit. The first AI edit on a photo is counted; more AI
-- edits on the same photo for the next 2 hours are free (up to 10), so trying
-- several tools on one picture doesn't use up the daily allowance.
alter table public.ai_usage add column if not exists photo_of bigint references public.ai_usage(id) on delete cascade;
create index if not exists ai_usage_photo_of_idx on public.ai_usage (photo_of);

drop function if exists public.consume_ai_edit(uuid, text, text);
create or replace function public.consume_ai_edit(p_user uuid, p_mode text, p_ip text, p_photo bigint default null)
returns table(ok boolean, plan text, used int, quota int, remaining int, usage_id bigint, photo bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text; v_quota int; v_since timestamptz; v_used int; v_ip_used int; v_id bigint; v_bonus int; v_extra int;
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
    where u.user_id = p_user and u.created_at >= v_since and not u.refunded and u.photo_of is null;

  -- More edits on a photo that was already paid for are free.
  if p_photo is not null and exists (
    select 1 from public.ai_usage u where u.id = p_photo and u.user_id = p_user and not u.refunded
      and u.photo_of is null and u.created_at > now() - interval '2 hours'
  ) then
    select count(*) into v_extra from public.ai_usage u where u.photo_of = p_photo and not u.refunded;
    if v_extra < 10 then
      insert into public.ai_usage (user_id, mode, ip, photo_of) values (p_user, p_mode, p_ip, p_photo) returning id into v_id;
      return query select true, v_plan, v_used, v_quota, greatest(v_quota - v_used, 0), v_id, p_photo; return;
    end if;
  end if;

  if v_used >= v_quota then
    return query select false, v_plan, v_used, v_quota, 0, null::bigint, null::bigint; return;
  end if;
  if v_plan = 'free' and p_ip is not null then
    perform pg_advisory_xact_lock(hashtext(p_ip));
    select count(*) into v_ip_used from public.ai_usage u join public.profiles p on p.id = u.user_id
      where u.ip = p_ip and u.created_at >= v_since and not u.refunded and u.photo_of is null
        and not (p.plan = 'pro' and p.plan_expires_at > now());
    if v_ip_used >= 20 then
      return query select false, v_plan, v_quota, v_quota, 0, null::bigint, null::bigint; return;
    end if;
  end if;
  insert into public.ai_usage (user_id, mode, ip) values (p_user, p_mode, p_ip) returning id into v_id;
  return query select true, v_plan, v_used + 1, v_quota, v_quota - v_used - 1, v_id, v_id;
end;
$$;
revoke all on function public.consume_ai_edit(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_edit(uuid, text, text, bigint) to service_role;
