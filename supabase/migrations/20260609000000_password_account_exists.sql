-- FR-018 OAuth merge guardrail: collision detector for the callback's block path.
-- Returns whether an email+password ("email" provider) identity already exists
-- for a given address. Reading auth.identities is only possible with elevated
-- rights, so this is SECURITY DEFINER — but it is locked down to service_role
-- only and returns a bare boolean, so it cannot be used for enumeration from any
-- public route. It is reached solely from the server OAuth callback after a real
-- handshake, on the rare unverified-email path (never for Google).
--
-- search_path = '' with fully-qualified references (auth.identities) keeps the
-- definer-context path safe and matches the sibling functions' linting posture.

create or replace function public.password_account_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities i
    where i.provider = 'email'
      and lower(i.identity_data->>'email') = lower(p_email)
  );
$$;

revoke all on function public.password_account_exists(text) from public, anon, authenticated;
grant execute on function public.password_account_exists(text) to service_role;
