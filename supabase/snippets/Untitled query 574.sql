begin;

-- fixture: właściciel + zagroda (limit 30) + turnus + dwa zapytania pending (20 i 15 osób)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'smoke-owner@test.local', '', now(), now(), now());

insert into public.zagrody (id, owner_id, name, daily_limit)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', 'Smoke Zagroda', 30);

insert into public.turnusy (id, zagroda_id, label, start_time, end_time)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Rano', '09:00', '12:00');

insert into public.booking_requests (id, zagroda_id, turnus_id, trip_date, participants_count, guest_name, guest_email, guest_phone)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-07-01', 20, 'Teacher A', 'a@school.pl', '111111111'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-07-01', 15, 'Teacher B', 'b@school.pl', '222222222');

-- podszycie się pod właściciela (auth.uid() w SECURITY DEFINER czyta ten claim)
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);

-- 1) akceptacja w limicie
select * from public.accept_booking_request('11111111-1111-1111-1111-111111111111');

-- 2) blokada ponad limit (20+15 > 30)
select * from public.accept_booking_request('22222222-2222-2222-2222-222222222222');

-- 3) zapytanie B nadal pending
select id, status from public.booking_requests where id = '22222222-2222-2222-2222-222222222222';

rollback;