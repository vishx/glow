-- 018: screenshots in support messages, and replies emailed automatically.
--   * A customer can add up to 3 screenshots to a support message or a reply in the app. They're kept in a
--     private storage bucket (support-files) that only the account and admin functions can read; the admin
--     page shows them through links that expire after an hour. Deleting the account deletes them.
--   * When the admin page emails a reply (through Resend, once its key is set), the result is recorded.
-- Run once in the Supabase SQL editor (the whole file), before deploying the account and admin functions.

alter table public.support_requests add column if not exists attachments text[] not null default '{}' check (cardinality(attachments) <= 3);
alter table public.support_messages add column if not exists attachments text[] not null default '{}' check (cardinality(attachments) <= 3);
alter table public.support_messages add column if not exists email_status text check (email_status is null or email_status in ('sent', 'failed'));

-- Private bucket: no policies, so only the service role (the functions) can read or write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-files', 'support-files', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
