-- Step 4: server-authoritative profile fields.
--   username : unique handle, case-insensitive, 3-20 chars of [A-Za-z0-9_].
--   currency : persistent (gamble) balance; written only by the server.

alter table public.profiles
  add column if not exists username text,
  add column if not exists currency integer not null default 1000;

-- Case-insensitive uniqueness on the username.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- Format guard.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
