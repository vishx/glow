-- AI job recovery (prepared on branch redesign/camera-editor; NOT applied to production).
-- The app sends its own request id with every AI edit. Storing it lets the server:
--   * treat a resent request as the same edit instead of charging again, and
--   * answer "what happened to request X?" when the app never received the job id
--     (timeout, refresh, app backgrounded, connection lost).
alter table public.ai_usage add column if not exists client_request_id uuid;
create unique index if not exists ai_usage_user_request_idx
  on public.ai_usage (user_id, client_request_id) where client_request_id is not null;
