-- 016: the name and email a person types into Contact support are saved on their account, so the
-- admin page can show who an account belongs to and find it by name or email. Nothing else in Glow
-- Studio asks for a name. Deleting the account deletes these with the profile.
-- Run once in the Supabase SQL editor (the whole file), before deploying the account and admin functions.

alter table public.profiles add column if not exists contact_name text check (contact_name is null or length(contact_name) between 1 and 120);
alter table public.profiles add column if not exists contact_email text check (contact_email is null or length(contact_email) between 3 and 200);
alter table public.profiles add column if not exists contact_updated_at timestamptz;

alter table public.support_requests add column if not exists name text check (name is null or length(name) between 1 and 120);

create index if not exists profiles_contact_email_idx on public.profiles (lower(contact_email)) where contact_email is not null;

-- Same as before plus contact_name and contact_email. A query that looks like the start of an
-- account ID (hex, with a digit or 8+ long) matches IDs; anything else (a name, part of a name, an email) matches name or email.
drop function if exists public.admin_users(text, int);
create function public.admin_users(p_query text default null, p_limit int default 50)
returns table(user_id uuid, created_at timestamptz, last_seen timestamptz, plan text, plan_period text, plan_expires_at timestamptz,
              bonus_credits int, blocked boolean, runs_7d int, credits_7d int, runs_total int, contact_name text, contact_email text)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.created_at, a.last_sign_in_at,
         case when p.plan = 'pro' and p.plan_expires_at > now() then 'pro' else 'free' end, p.plan_period, p.plan_expires_at,
         coalesce(p.bonus_credits, 0), p.blocked_at is not null,
         (select count(*) from public.ai_usage u where u.user_id = a.id and u.created_at >= now() - interval '7 days')::int,
         (select coalesce(sum(u.cost), 0) from public.ai_usage u where u.user_id = a.id and not u.refunded and u.created_at >= now() - interval '7 days')::int,
         (select count(*) from public.ai_usage u where u.user_id = a.id)::int,
         p.contact_name, p.contact_email
  from auth.users a left join public.profiles p on p.id = a.id
  cross join lateral (select lower(trim(coalesce(p_query, ''))) as q) s
  cross join lateral (select s.q ~ '^[0-9a-f-]+$' and (s.q ~ '[0-9]' or length(s.q) >= 8) as is_id) k
  where s.q = ''
     or (k.is_id and a.id::text like s.q || '%')
     or (not k.is_id and (p.contact_name ilike '%' || s.q || '%' or p.contact_email ilike '%' || s.q || '%'))
  order by a.created_at desc limit least(greatest(p_limit, 1), 200);
$$;
revoke all on function public.admin_users(text, int) from public, anon, authenticated;
grant execute on function public.admin_users(text, int) to service_role;
