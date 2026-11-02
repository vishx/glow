-- 017: a real support inbox. Each Contact support message becomes a conversation:
--   * replies from the admin page are shown to the customer inside the app (Settings > Your messages),
--     and can also be emailed from the admin page's mail link;
--   * the customer can answer back in the app, which reopens the conversation;
--   * private notes, statuses (open / waiting on customer / closed), priority, tags,
--     saved replies and a thumbs up / down rating after a conversation is closed.
-- Run once in the Supabase SQL editor (the whole file), before deploying the account and admin functions.

-- Conversation fields on the existing support_requests (the first message stays in support_requests.message).
alter table public.support_requests drop constraint if exists support_requests_status_check;
alter table public.support_requests add constraint support_requests_status_check check (status in ('open', 'pending', 'closed'));
alter table public.support_requests add column if not exists priority text not null default 'normal' check (priority in ('normal', 'high'));
alter table public.support_requests add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 10);
alter table public.support_requests add column if not exists updated_at timestamptz not null default now();
alter table public.support_requests add column if not exists last_customer_at timestamptz;
alter table public.support_requests add column if not exists first_reply_at timestamptz;
alter table public.support_requests add column if not exists last_reply_at timestamptz;
alter table public.support_requests add column if not exists closed_at timestamptz;
alter table public.support_requests add column if not exists user_seen_at timestamptz;
alter table public.support_requests add column if not exists rating smallint check (rating is null or rating in (-1, 1));
alter table public.support_requests add column if not exists rating_at timestamptz;
update public.support_requests set last_customer_at = created_at where last_customer_at is null;
update public.support_requests set updated_at = created_at where updated_at < created_at or updated_at is null;
update public.support_requests set closed_at = created_at where status = 'closed' and closed_at is null;
create index if not exists support_requests_user_idx on public.support_requests (user_id, created_at desc);
create index if not exists support_requests_updated_idx on public.support_requests (status, updated_at desc);

-- Every message after the first one: customer follow-ups, replies, and private notes (never shown to the customer).
create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.support_requests(id) on delete cascade,
  author text not null check (author in ('customer', 'admin', 'note')),
  body text not null check (length(body) between 1 and 4000),
  via text check (via is null or via in ('app', 'email')),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_request_idx on public.support_messages (request_id, created_at);
alter table public.support_messages enable row level security;   -- service role only (account and admin functions)

-- Saved replies (macros) for the admin page. {name} is replaced with the customer's first name.
create table if not exists public.support_macros (
  id bigint generated always as identity primary key,
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 4000),
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.support_macros enable row level security;     -- service role only

insert into public.support_macros (title, body, sort)
select * from (values
  ('Thanks, looking into it', E'Hi {name},\n\nThanks for getting in touch. I''m looking into this now and will get back to you here as soon as I can.\n\nThe Glow Studio team', 1),
  ('Credits returned', E'Hi {name},\n\nSorry that didn''t work as it should. I''ve put the credits back on your account, so you can try again. Open Glow Studio and you''ll see them under AI credits.\n\nThe Glow Studio team', 2),
  ('Bad AI result', E'Hi {name},\n\nSorry the result wasn''t what you hoped for. AI tools work best on a clear, well-lit photo where the face is not too small. I''ve returned the credits for that try so you can give it another go.\n\nThe Glow Studio team', 3),
  ('Refund: iPhone', E'Hi {name},\n\nPayments on iPhone go through Apple, so only Apple can refund them. Go to reportaproblem.apple.com, sign in with your Apple ID, choose "Request a refund" and pick Glow Studio. Apple usually answers within 48 hours.\n\nThe Glow Studio team', 4),
  ('Refund: Android', E'Hi {name},\n\nI''ve asked Google Play to refund your purchase. You''ll get an email from Google, and the money usually reaches you within a few days.\n\nThe Glow Studio team', 5),
  ('How to cancel', E'Hi {name},\n\nYou can cancel any time and keep Pro until the end of the period you paid for.\n\niPhone: Settings > your name > Subscriptions > Glow Studio > Cancel.\nAndroid: Play Store > your profile picture > Payments and subscriptions > Subscriptions > Glow Studio > Cancel.\n\nThe Glow Studio team', 6),
  ('Restore purchases', E'Hi {name},\n\nIf Pro is missing after reinstalling or on a new phone, open Glow Studio > Settings > Manage subscription and tap Restore purchases, signed in to the same Apple or Google account you paid with.\n\nThe Glow Studio team', 7),
  ('Gave free Pro', E'Hi {name},\n\nSorry for the trouble. I''ve added free Glow Studio Pro to your account. Close and reopen the app and it''s ready to use.\n\nThe Glow Studio team', 8),
  ('Bug: fixed in next update', E'Hi {name},\n\nThanks for reporting this, it really helps. I found the problem and the fix will be in the next update.\n\nThe Glow Studio team', 9),
  ('Data deleted', E'Hi {name},\n\nYour account and data have been deleted, as you asked. If you use Glow Studio again you''ll start with a new, empty account.\n\nThe Glow Studio team', 10),
  ('Idea: thanks', E'Hi {name},\n\nThanks for the idea! I''ve added it to the list for future updates.\n\nThe Glow Studio team', 11)
) as v(title, body, sort)
where not exists (select 1 from public.support_macros);

-- Numbers for the Support page: how many are waiting, the oldest, and how fast replies go out.
create or replace function public.admin_support_stats(p_days int default 30)
returns table(open int, pending int, closed_7d int, high_open int, unanswered int, oldest_open timestamptz,
              median_first_reply_mins int, replied int, received int, rated_up int, rated_down int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from public.support_requests where status = 'open')::int,
    (select count(*) from public.support_requests where status = 'pending')::int,
    (select count(*) from public.support_requests where status = 'closed' and closed_at >= now() - interval '7 days')::int,
    (select count(*) from public.support_requests where status = 'open' and priority = 'high')::int,
    (select count(*) from public.support_requests where status = 'open' and first_reply_at is null)::int,
    (select min(coalesce(last_customer_at, created_at)) from public.support_requests where status = 'open'),
    (select (percentile_cont(0.5) within group (order by extract(epoch from first_reply_at - created_at)) / 60)::int
       from public.support_requests where first_reply_at is not null and created_at >= now() - make_interval(days => p_days)),
    (select count(*) from public.support_requests where first_reply_at is not null and created_at >= now() - make_interval(days => p_days))::int,
    (select count(*) from public.support_requests where created_at >= now() - make_interval(days => p_days))::int,
    (select count(*) from public.support_requests where rating = 1 and rating_at >= now() - make_interval(days => p_days))::int,
    (select count(*) from public.support_requests where rating = -1 and rating_at >= now() - make_interval(days => p_days))::int;
$$;
revoke all on function public.admin_support_stats(int) from public, anon, authenticated;
grant execute on function public.admin_support_stats(int) to service_role;
