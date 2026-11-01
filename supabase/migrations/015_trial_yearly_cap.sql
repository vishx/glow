-- 015: Yearly free trial and a lower yearly cap (owner's choice 2026-11-01). Run once in the Supabase
-- SQL editor, before deploying revenuecat-webhook v10 and the web release.
--   * Yearly plan cap: 60 credits per rolling 30 days (was 80). HD Enhance (Topaz, about $0.05 a
--     credit) could otherwise cost more than a yearly plan earns.
--   * Free trial (RevenueCat period_type TRIAL): Pro features, but only 10 AI credits in the trial,
--     so a trial can't cost more than about $0.50. When the trial converts, the webhook clears the
--     flag and the normal 40 a week applies (credits used in the trial count toward that week).
-- Same return columns as migration 009, so consume_ai_edit and the account function are unchanged.

alter table public.profiles add column if not exists plan_trial boolean not null default false;

create or replace function public.ai_allowance(p_user uuid, p_mode text default null)
returns table(plan text, period text, pool text, used int, quota int, remaining int, trial_left int, ads_left int, bonus int, blocked boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_plan text; v_period text; v_since timestamptz; v_bonus int; v_cheap int; v_trial int; v_week int; v_month int;
  v_extra int; v_blocked boolean; v_in_trial boolean; v_quota int;
begin
  select case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period,
         coalesce(p.bonus_credits, 0), p.blocked_at is not null, coalesce(p.plan_trial, false)
    into v_plan, v_period, v_extra, v_blocked, v_in_trial from public.profiles p where p.id = p_user;
  v_plan := coalesce(v_plan, 'free'); v_extra := coalesce(v_extra, 0); v_blocked := coalesce(v_blocked, false);
  if v_plan = 'pro' then
    v_quota := case when coalesce(v_in_trial, false) then 10 else 40 end;
    select coalesce(sum(u.cost), 0) into v_week from public.ai_usage u
      where u.user_id = p_user and not u.refunded and not u.from_bonus and u.created_at >= now() - interval '7 days';
    if v_period = 'yearly' then
      select coalesce(sum(u.cost), 0) into v_month from public.ai_usage u
        where u.user_id = p_user and not u.refunded and not u.from_bonus and u.created_at >= now() - interval '30 days';
      return query select v_plan, v_period, 'pro'::text, v_week, v_quota, greatest(0, least(v_quota - v_week, 60 - v_month)) + v_extra, 0, 0, v_extra, v_blocked;
    else
      return query select v_plan, v_period, 'pro'::text, v_week, v_quota, greatest(0, v_quota - v_week) + v_extra, 0, 0, v_extra, v_blocked;
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
