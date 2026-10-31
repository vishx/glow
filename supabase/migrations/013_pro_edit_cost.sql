-- Pro Edit costs 2 credits (owner's choice 2026-10-31): it now runs Nano Banana 2 (about $0.067 an
-- edit, was Nano Banana at $0.039). Run in the SQL editor at the Pro Edit release, together with
-- the web release (the app shows the 2-credit price from then on).
create or replace function public.ai_edit_cost(p_mode text) returns int
language sql immutable set search_path = ''
as $$ select case when p_mode in ('headshot', 'anime', 'watercolor', 'fashion', 'fill', 'expand', 'bgscene', 'custom', 'pro') then 2 else 1 end $$;
