-- Friendships: one row per relationship between two accounts. The row's owner
-- (user_id) is whoever sent the request; friend_id is the addressee. Status is
-- 'pending' until the addressee accepts, then 'accepted'. A row exists in only
-- ONE direction; "my friends" is the union of rows where I'm either side.
--
-- All access goes through the server (service_role key), so RLS is enabled with
-- NO client policies — the table is private to the server, like locked profile
-- writes. Guests can't be friends (no stable identity); the server gates that.

create table if not exists public.friendships (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  friend_id  uuid        not null references public.profiles (id) on delete cascade,
  status     text        not null default 'pending'
               check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  -- No self-friendship.
  constraint friendships_distinct check (user_id <> friend_id)
);

-- Look up a user's relationships from either side quickly.
create index if not exists friendships_friend_id_idx
  on public.friendships (friend_id);

-- Prevent the mirror row (B,A) when (A,B) already exists, regardless of who
-- sent which request. Enforced by a unique index on the unordered pair.
create unique index if not exists friendships_pair_uidx
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

alter table public.friendships enable row level security;
-- (No policies: clients have no direct access; the server uses service_role.)

create trigger friendships_touch_updated_at
  before update on public.friendships
  for each row execute function public.touch_updated_at();

-- Send a friend request by username (case-insensitive). Atomic so two people
-- requesting each other at once can't create two rows: if the target already
-- requested the requester, this accepts that instead. Returns a status code:
--   'sent' | 'accepted' | 'already_friends' | 'already_pending'
--   | 'self' | 'not_found'
create or replace function public.friend_request(requester uuid, target_name text)
returns text
language plpgsql
as $$
declare
  target   uuid;
  existing public.friendships%rowtype;
begin
  select id into target
    from public.profiles
   where lower(username) = lower(target_name);
  if target is null then return 'not_found'; end if;
  if target = requester then return 'self'; end if;

  select * into existing
    from public.friendships
   where (user_id = requester and friend_id = target)
      or (user_id = target and friend_id = requester)
   limit 1;

  if found then
    if existing.status = 'accepted' then
      return 'already_friends';
    elsif existing.user_id = requester then
      return 'already_pending';            -- I already asked them
    else
      update public.friendships set status = 'accepted'
       where user_id = target and friend_id = requester;
      return 'accepted';                   -- they asked me first → accept
    end if;
  end if;

  insert into public.friendships (user_id, friend_id, status)
       values (requester, target, 'pending');
  return 'sent';
end;
$$;
