-- 021: the 2026-11-02 ideas (trends, headshot pack, hairstyle grid, old photos, group fix, photo to motion)
-- and the "Face changed? Try again free" retry. Safe to run more than once.

-- One free retry per finished edit (the enhance function marks the retry's row and returns its credit).
alter table public.ai_usage add column if not exists retry_of bigint;
create index if not exists ai_usage_retry_of on public.ai_usage (retry_of) where retry_of is not null;

-- Credits per tool. Image-model looks (trends, headshots, old photo, group fix) cost 2 like other
-- portrait styles; hairstyles 1; a 5-second video 4.
create or replace function public.ai_edit_cost(p_mode text)
returns integer language sql immutable set search_path to '' as $$
  select case
    when p_mode = 'motion' then 4
    when p_mode in ('headshot', 'anime', 'watercolor', 'fashion', 'fill', 'expand', 'bgscene', 'custom', 'pro', 'oldphoto', 'groupfix')
      or p_mode like 'trend\_%' or p_mode like 'hs\_%' then 2
    else 1 end
$$;

-- What each run costs Glow Studio (for the admin page's margin figures).
delete from public.ai_mode_costs where mode like 'trend\_%' or mode like 'hs\_%' or mode like 'hair\_%' or mode in ('oldphoto', 'groupfix', 'motion');
insert into public.ai_mode_costs (mode, usd) values
  ('trend_figurine', 0.039), ('trend_yearbook', 0.039), ('trend_poster', 0.039), ('trend_snow', 0.039), ('trend_holiday', 0.039),
  ('trend_polaroid', 0.039), ('trend_thennow', 0.039), ('hs_office', 0.039), ('hs_creative', 0.039), ('hs_dating', 0.039),
  ('hs_passport', 0.039), ('hair_buzz', 0.039), ('hair_fade', 0.039), ('hair_slick', 0.039), ('hair_beard', 0.039),
  ('hair_shag', 0.039), ('hair_lob', 0.039), ('hair_afro', 0.039), ('hair_silver', 0.039), ('hair_waves', 0.039),
  ('hair_bob', 0.039), ('hair_pixie', 0.039), ('hair_bangs', 0.039), ('hair_curls', 0.039), ('hair_bun', 0.039),
  ('hair_braids', 0.039), ('hair_butterfly', 0.039), ('oldphoto', 0.039), ('groupfix', 0.039), ('motion', 0.25);
