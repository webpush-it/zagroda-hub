-- Impl-review F6: keep booking_requests.updated_at honest regardless of caller.
-- accept_booking_request sets it by hand today; future mutators (S-03 guest
-- cancel, S-05 owner withdrawal) would each have to remember — a trigger makes
-- the column self-maintaining instead.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger booking_requests_set_updated_at
  before update on public.booking_requests
  for each row
  execute function public.set_updated_at();
