-- AI backgrounds and Describe: the HD cutout ("bgcut") is an everyday 1-credit tool; the AI scene
-- ("bgscene") and Describe ("custom", also Glow Up's "your words") are 2-credit premium tools,
-- like Fill. Run once in the Supabase SQL editor.

create or replace function public.ai_edit_cost(p_mode text) returns int
language sql immutable set search_path = ''
as $$ select case when p_mode in ('headshot', 'anime', 'watercolor', 'fashion', 'fill', 'expand', 'bgscene', 'custom') then 2 else 1 end $$;

create or replace function public.ai_mode_premium(p_mode text) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p_mode, '') not in ('erase', 'enhance', 'upscale', 'faces', 'colorize', 'retouch', 'toon3d', 'clay', 'older', 'younger', 'bgcut') $$;
