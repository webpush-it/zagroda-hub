-- Impl-review F3: upper bounds on participant counts.
-- Anon could INSERT a pending request for int4-max participants — junk for the
-- owner to wade through, and (theoretically) the fit check in
-- accept_booking_request (v_occupied + v_participants) could overflow int4 and
-- raise 22003 instead of cleanly returning accepted = false.
-- Caps are domain-scale (school trips): 1000 is far above any real group/day.

alter table public.booking_requests
  add constraint booking_requests_participants_count_upper
  check (participants_count <= 1000);

alter table public.zagrody
  add constraint zagrody_daily_limit_upper
  check (daily_limit <= 1000);
