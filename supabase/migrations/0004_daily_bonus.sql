-- Daily bonus: +250 once per (UTC) calendar day. The server calls claim_daily
-- on connect; the function only credits if the player hasn't already claimed
-- today, and returns the resulting balance either way.

alter table public.profiles add column if not exists last_daily date;

create or replace function public.claim_daily(uid uuid)
returns integer
language plpgsql
as $$
declare
  new_balance integer;
begin
  update public.profiles
     set currency = currency + 250,
         last_daily = current_date
   where id = uid
     and (last_daily is null or last_daily < current_date);

  select currency into new_balance from public.profiles where id = uid;
  return new_balance;
end;
$$;
