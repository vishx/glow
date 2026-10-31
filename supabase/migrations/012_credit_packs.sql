-- One-time AI credit packs, bought in the app through RevenueCat (consumable store products).
-- Run once in the Supabase SQL editor after 009 and 010. Safe to run again.
--   * Every pack bought is recorded once per store transaction, so a webhook sent twice never
--     gives credits twice.
--   * Bought credits go into profiles.bonus_credits (migration 009): they never expire and are
--     used only after the plan's own daily or weekly credits.
--   * A refunded pack takes back the credits it gave, as far as the user still has them.
--   * The admin page shows packs sold and their revenue.

create table if not exists public.credit_purchases (
  transaction_id text primary key,              -- the store's transaction id, from RevenueCat
  user_id uuid references auth.users(id) on delete set null,
  product_id text not null,
  credits int not null check (credits > 0),
  price_usd numeric(10, 2),                     -- RevenueCat's USD price, before store fees
  store text,
  environment text,                             -- SANDBOX for test purchases
  refunded_at timestamptz,
  credits_taken_back int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists credit_purchases_created_idx on public.credit_purchases (created_at desc);
create index if not exists credit_purchases_user_idx on public.credit_purchases (user_id, created_at desc);
alter table public.credit_purchases enable row level security;   -- service role only

-- Called by functions/revenuecat-webhook. Returns the credits added (0 when this transaction was
-- already counted).
create or replace function public.grant_credit_pack(p_user uuid, p_txn text, p_product text, p_credits int,
  p_price numeric default null, p_store text default null, p_env text default null)
returns int language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (p_user) on conflict (id) do nothing;
  insert into public.credit_purchases (transaction_id, user_id, product_id, credits, price_usd, store, environment)
    values (p_txn, p_user, p_product, p_credits, p_price, p_store, p_env)
    on conflict (transaction_id) do nothing;
  if not found then return 0; end if;
  update public.profiles set bonus_credits = bonus_credits + p_credits where id = p_user;
  return p_credits;
end;
$$;
revoke all on function public.grant_credit_pack(uuid, text, text, int, numeric, text, text) from public, anon, authenticated;
grant execute on function public.grant_credit_pack(uuid, text, text, int, numeric, text, text) to service_role;

-- A refund takes the pack's credits back, but never below zero (credits already used stay used).
-- Returns the credits taken back. Refunding twice does nothing.
create or replace function public.refund_credit_pack(p_txn text)
returns int language plpgsql security definer set search_path = ''
as $$
declare r record; v_take int;
begin
  select * into r from public.credit_purchases where transaction_id = p_txn and refunded_at is null for update;
  if not found or r.user_id is null then
    update public.credit_purchases set refunded_at = now() where transaction_id = p_txn and refunded_at is null;
    return 0;
  end if;
  select least(p.bonus_credits, r.credits) into v_take from public.profiles p where p.id = r.user_id for update;
  v_take := coalesce(v_take, 0);
  update public.profiles set bonus_credits = bonus_credits - v_take where id = r.user_id;
  update public.credit_purchases set refunded_at = now(), credits_taken_back = v_take where transaction_id = p_txn;
  return v_take;
end;
$$;
revoke all on function public.refund_credit_pack(text) from public, anon, authenticated;
grant execute on function public.refund_credit_pack(text) to service_role;

-- Packs sold, for the admin page: per pack over the last p_days, test purchases left out.
create or replace function public.admin_credit_packs(p_days int default 30)
returns table(product_id text, sold int, buyers int, credits int, refunded int, revenue numeric)
language sql stable security definer set search_path = ''
as $$
  select c.product_id, count(*)::int, count(distinct c.user_id)::int, sum(c.credits)::int,
         count(*) filter (where c.refunded_at is not null)::int,
         round(coalesce(sum(c.price_usd) filter (where c.refunded_at is null), 0), 2)
  from public.credit_purchases c
  where c.environment is distinct from 'SANDBOX'
    and c.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by c.product_id order by 4 desc;
$$;
revoke all on function public.admin_credit_packs(int) from public, anon, authenticated;
grant execute on function public.admin_credit_packs(int) to service_role;
