-- Profile writes now go exclusively through the server (service_role key), so
-- clients no longer need write access. Removing these policies makes currency
-- tamper-proof from the client. Reads stay open to the owner (harmless).

drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
