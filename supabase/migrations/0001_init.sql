-- REU Experience Day — registration schema
-- Target: Supabase Postgres (also runs unchanged on the embedded PGlite used for local development).
--
-- Design notes
-- * The browser never touches tables directly. RLS is enabled with no policies for anon/authenticated,
--   so all participant access goes through the SECURITY DEFINER functions below (PRD 8.19).
-- * Seat allocation locks the affected session rows (SELECT ... FOR UPDATE, always in id order to avoid
--   deadlocks) and serialises per-email work with an advisory lock, so concurrent submissions cannot
--   exceed capacity or bypass the clash rules (PRD 8.1–8.5).
-- * Status is derived from queue order: forced (admin-guaranteed) first, then queued_at, then id.
--   The first confirmed_cap rows are confirmed; the rest are waitlisted. Derivation runs in the same
--   transaction as every insert, delete and move (PRD 5, 8.2, 8.9).
-- * Unique constraints on (email, topic) and (email, time_slot) make double-booking and clashes
--   impossible even for a crafted request.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists event_config (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists sessions (
  id             text primary key,
  topic          text not null,
  kind           text not null check (kind in ('plenary', 'workshop')),
  time_slot      text not null,
  label          text,
  room           int,
  sort_order     int not null default 0,
  confirmed_cap  int not null check (confirmed_cap >= 0),
  waitlist_cap   int not null check (waitlist_cap >= 0),
  active         boolean not null default true
);

create table if not exists registrations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  email        text not null check (email = lower(btrim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  topic        text not null,
  session_id   text not null references sessions(id) on update cascade,
  time_slot    text not null,
  status       text not null default 'waitlist' check (status in ('confirmed', 'waitlist')),
  queued_at    timestamptz not null default now(),
  forced       boolean not null default false,
  source       text not null default 'self' check (source in ('self', 'admin')),
  promoted_at  timestamptz,
  moved_at     timestamptz,
  created_at   timestamptz not null default now(),
  constraint registrations_email_session_key unique (email, session_id),
  constraint registrations_email_topic_key   unique (email, topic),
  constraint registrations_email_time_key    unique (email, time_slot)
);

create index if not exists registrations_session_queue_idx on registrations (session_id, forced desc, queued_at, id);
create index if not exists registrations_email_idx on registrations (email);

-- Immutable audit trail (PRD 8.18)
create table if not exists audit_log (
  id               bigserial primary key,
  at               timestamptz not null default now(),
  action           text not null check (action in ('create', 'cancel', 'remove', 'move', 'promote', 'demote', 'import', 'config')),
  actor            text not null check (actor in ('self', 'admin', 'system')),
  registration_id  uuid,
  email            text,
  name             text,
  session_id       text,
  detail           jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- Simple fixed-window rate limiter used by the server routes (PRD 8.10, 8.17)
create table if not exists rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          int not null
);

-- A single-row "something changed" counter. It holds no personal data, so anon may read it and
-- subscribe to it with Supabase Realtime to know when to re-fetch availability (PRD 8.15).
create table if not exists availability_version (
  id          int primary key default 1 check (id = 1),
  version     bigint not null default 0,
  changed_at  timestamptz not null default now()
);
insert into availability_version (id, version) values (1, 0) on conflict (id) do nothing;

create or replace function bump_availability_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update availability_version set version = version + 1, changed_at = now() where id = 1;
  return null;
end $$;

drop trigger if exists registrations_bump_version on registrations;
create trigger registrations_bump_version after insert or update or delete on registrations
  for each statement execute function bump_availability_version();

drop trigger if exists sessions_bump_version on sessions;
create trigger sessions_bump_version after insert or update or delete on sessions
  for each statement execute function bump_availability_version();

-- ---------------------------------------------------------------------------
-- Defence in depth: capacity is enforced by a trigger as well as by the booking functions.
-- A non-forced booking can never be written into a session whose confirmed + waitlist
-- capacity is already used up, whatever code path issues the write.
-- ---------------------------------------------------------------------------

create or replace function enforce_session_capacity() returns trigger
language plpgsql as $$
declare
  s     sessions%rowtype;
  held  int;
begin
  if tg_op = 'UPDATE' and new.session_id = old.session_id then
    return new;
  end if;
  if coalesce(current_setting('reu.bypass_capacity', true), '') = 'on' then
    return new;
  end if;
  select * into s from sessions where id = new.session_id for update;
  if not found then
    raise exception 'unknown session %', new.session_id using errcode = 'foreign_key_violation';
  end if;
  if new.topic <> s.topic or new.time_slot <> s.time_slot then
    raise exception 'topic/time_slot do not match session %', new.session_id using errcode = 'check_violation';
  end if;
  if new.forced then
    return new;
  end if;
  select count(*) into held from registrations where session_id = new.session_id and not forced;
  if held >= s.confirmed_cap + s.waitlist_cap then
    raise exception 'session % is full', new.session_id using errcode = 'check_violation', hint = 'session_full';
  end if;
  return new;
end $$;

drop trigger if exists registrations_capacity on registrations;
create trigger registrations_capacity before insert or update of session_id on registrations
  for each row execute function enforce_session_capacity();

-- ---------------------------------------------------------------------------
-- Row-level security: nothing is readable or writable directly by anon/authenticated,
-- except the availability_version counter (for Realtime) which holds no personal data.
-- ---------------------------------------------------------------------------

alter table event_config          enable row level security;
alter table sessions              enable row level security;
alter table registrations         enable row level security;
alter table audit_log             enable row level security;
alter table rate_limits           enable row level security;
alter table availability_version  enable row level security;

drop policy if exists availability_version_read on availability_version;
create policy availability_version_read on availability_version for select using (true);

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by anon)
-- ---------------------------------------------------------------------------

create or replace function reu_norm_email(p_email text) returns text
language sql immutable as $$ select lower(btrim(coalesce(p_email, ''))) $$;

create or replace function reu_email_allowed(p_email text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  domains jsonb;
begin
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return false;
  end if;
  select data -> 'registration' -> 'allowedEmailDomains' into domains from event_config where id = 1;
  if domains is null or jsonb_typeof(domains) <> 'array' or jsonb_array_length(domains) = 0 then
    return true;
  end if;
  return exists (
    select 1 from jsonb_array_elements_text(domains) d
    where split_part(p_email, '@', 2) = lower(btrim(d, ' @'))
  );
end $$;

-- Re-derive confirmed/waitlist for one session. Caller must hold the session row lock.
-- Admin-guaranteed (forced) seats are always confirmed and are *additional* to confirmed_cap, so
-- guaranteeing someone a seat never pushes an already-confirmed participant back onto the waitlist.
-- Returns the registrations promoted from waitlist to confirmed.
-- p_fresh: rows that were just inserted or moved in this transaction. Their first status is an
-- assignment, not a promotion/demotion, so it is not flagged or logged as one.
drop function if exists reu_derive_session(text, text);
create or replace function reu_derive_session(p_session_id text, p_actor text default 'system', p_fresh uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s         sessions%rowtype;
  r         record;
  confirmed int := 0;
  new_status text;
  promos    jsonb := '[]'::jsonb;
begin
  select * into s from sessions where id = p_session_id;
  if not found then
    return promos;
  end if;
  for r in
    select * from registrations where session_id = p_session_id
    order by forced desc, queued_at, id
  loop
    if r.forced then
      new_status := 'confirmed';          -- guaranteed seats sit on top of capacity
    elsif confirmed < s.confirmed_cap then
      new_status := 'confirmed';
      confirmed := confirmed + 1;
    else
      new_status := 'waitlist';
    end if;
    if new_status <> r.status and r.id = any(p_fresh) then
      update registrations set status = new_status where id = r.id;
    elsif new_status <> r.status then
      if r.status = 'waitlist' and new_status = 'confirmed' then
        update registrations set status = new_status, promoted_at = now() where id = r.id;
        insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
          values ('promote', 'system', r.id, r.email, r.name, r.session_id, jsonb_build_object('trigger', p_actor));
        promos := promos || jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email, 'sessionId', r.session_id);
      else
        update registrations set status = new_status where id = r.id;
        insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
          values ('demote', 'system', r.id, r.email, r.name, r.session_id, jsonb_build_object('trigger', p_actor));
      end if;
    end if;
  end loop;
  return promos;
end $$;

-- Rule check shared by self-registration and all admin actions.
-- Returns null when the booking is allowed, otherwise a human-readable reason.
create or replace function reu_rule_check(p_email text, p_session_id text, p_exclude uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s     sessions%rowtype;
  other registrations%rowtype;
  plenary_title text;
begin
  select * into s from sessions where id = p_session_id;
  if not found or not s.active then
    return 'that session doesn''t exist';
  end if;
  select * into other from registrations
    where email = p_email and session_id = p_session_id and (p_exclude is null or id <> p_exclude) limit 1;
  if found then
    return 'already booked for this session';
  end if;
  select * into other from registrations
    where email = p_email and topic = s.topic and (p_exclude is null or id <> p_exclude) limit 1;
  if found then
    if s.kind = 'plenary' then
      return format('already booked for the %s session at %s (only one of the two is allowed)', s.topic, other.time_slot);
    end if;
    return format('already booked for %s at %s', s.topic, other.time_slot);
  end if;
  select * into other from registrations
    where email = p_email and time_slot = s.time_slot and (p_exclude is null or id <> p_exclude) limit 1;
  if found then
    select coalesce(data -> 'plenary' ->> 'title', other.topic) into plenary_title from event_config where id = 1;
    return format('already booked for %s at %s',
      case when (select kind from sessions where id = other.session_id) = 'plenary' then plenary_title else other.topic end,
      s.time_slot);
  end if;
  return null;
end $$;

create or replace function reu_waitlist_position(p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select pos::int from (
    select id, row_number() over (order by queued_at, id) as pos
    from registrations
    where status = 'waitlist'
      and session_id = (select session_id from registrations where id = p_id)
  ) q where id = p_id
$$;

create or replace function reu_booking_json(r registrations) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'email', r.email,
    'topic', r.topic,
    'sessionId', r.session_id,
    'timeSlot', r.time_slot,
    'status', r.status,
    'waitlistPosition', case when r.status = 'waitlist' then reu_waitlist_position(r.id) else null end,
    'queuedAt', r.queued_at,
    'forced', r.forced,
    'source', r.source,
    'promotedAt', r.promoted_at,
    'movedAt', r.moved_at,
    'createdAt', r.created_at
  )
$$;

-- Lock a set of sessions in a deterministic order (prevents deadlocks between concurrent bookings).
create or replace function reu_lock_sessions(p_ids text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from sessions where id = any(p_ids) order by id for update;
end $$;

-- ---------------------------------------------------------------------------
-- Public (participant) API — counts only, or data for the caller's own email
-- ---------------------------------------------------------------------------

create or replace function get_event_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select data from event_config where id = 1
$$;

create or replace function get_availability() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from availability_version where id = 1),
    'participants', (select count(distinct email) from registrations),
    'sessions', coalesce(jsonb_agg(row_to_json(a)::jsonb order by a."sortOrder"), '[]'::jsonb)
  )
  from (
    select s.id,
           s.topic,
           s.kind,
           s.time_slot as "timeSlot",
           s.label,
           s.room,
           s.sort_order as "sortOrder",
           s.confirmed_cap as "confirmedCap",
           s.waitlist_cap as "waitlistCap",
           coalesce(c.confirmed, 0) as "confirmedCount",
           coalesce(c.waitlist, 0) as "waitlistCount",
           coalesce(c.forced, 0) as "forcedCount",
           greatest(0, s.confirmed_cap - coalesce(c.regular_confirmed, 0)) as "seatsLeft",
           greatest(0, s.waitlist_cap - coalesce(c.waitlist, 0)) as "waitlistLeft",
           case
             when coalesce(c.regular_confirmed, 0) < s.confirmed_cap then 'open'
             when coalesce(c.regular, 0) < s.confirmed_cap + s.waitlist_cap then 'waitlist'
             else 'full'
           end as state
    from sessions s
    left join (
      select session_id,
             count(*) filter (where status = 'confirmed') as confirmed,
             count(*) filter (where status = 'waitlist') as waitlist,
             count(*) filter (where forced) as forced,
             count(*) filter (where status = 'confirmed' and not forced) as regular_confirmed,
             count(*) filter (where not forced) as regular
      from registrations group by session_id
    ) c on c.session_id = s.id
    where s.active
  ) a
$$;

create or replace function get_my_bookings(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e text := reu_norm_email(p_email);
begin
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('name', null, 'bookings', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'name', (select name from registrations where email = e order by created_at desc limit 1),
    'bookings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'topic', r.topic,
          'sessionId', r.session_id,
          'timeSlot', r.time_slot,
          'status', r.status,
          'waitlistPosition', case when r.status = 'waitlist' then reu_waitlist_position(r.id) else null end
        ) order by s.sort_order)
      from registrations r join sessions s on s.id = r.session_id
      where r.email = e
    ), '[]'::jsonb)
  );
end $$;

-- Book several sessions at once. All-or-nothing: every session is re-validated (rules + capacity)
-- under lock; if any is rejected nothing is written and the per-session reasons are returned.
-- On success the returned outcome per session is the status assigned at commit time.
create or replace function book_sessions(p_name text, p_email text, p_session_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e        text := reu_norm_email(p_email);
  n        text := btrim(coalesce(p_name, ''));
  ids      text[];
  sid      text;
  s        sessions%rowtype;
  reason   text;
  held     int;
  outcomes jsonb := '[]'::jsonb;
  rejected boolean := false;
  new_id   uuid;
  now_ts   timestamptz := clock_timestamp();
  seen_topics text[] := '{}';
  seen_times  text[] := '{}';
  r        registrations%rowtype;
begin
  if char_length(n) < 2 or char_length(n) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if not reu_email_allowed(e) then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_session_ids) x where x is not null;
  if ids is null or array_length(ids, 1) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_sessions');
  end if;
  if array_length(ids, 1) > 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_sessions');
  end if;

  -- Serialise all work for this email, then lock the sessions in id order.
  perform pg_advisory_xact_lock(hashtext('reu-email:' || e));
  perform reu_lock_sessions(ids);

  foreach sid in array ids loop
    select * into s from sessions where id = sid;
    reason := null;
    if not found or not s.active then
      reason := 'unknown_session';
    else
      reason := reu_rule_check(e, sid);
      if reason is null and (s.topic = any(seen_topics)) then
        reason := format('choosing two sessions of %s', s.topic);
      elsif reason is null and (s.time_slot = any(seen_times)) then
        reason := format('choosing two sessions at %s', s.time_slot);
      end if;
      if reason is not null then
        reason := 'rule:' || reason;
      else
        select count(*) into held from registrations where session_id = sid and not forced;
        if held >= s.confirmed_cap + s.waitlist_cap then
          reason := 'full';
        end if;
      end if;
      seen_topics := seen_topics || s.topic;
      seen_times := seen_times || s.time_slot;
    end if;
    if reason is not null then
      rejected := true;
    end if;
    outcomes := outcomes || jsonb_build_object('sessionId', sid, 'topic', s.topic, 'timeSlot', s.time_slot,
                                               'result', case when reason is null then 'ok' else 'rejected' end,
                                               'reason', reason);
  end loop;

  if rejected then
    return jsonb_build_object('ok', false, 'error', 'rejected', 'outcomes', outcomes);
  end if;

  outcomes := '[]'::jsonb;
  foreach sid in array ids loop
    select * into s from sessions where id = sid;
    insert into registrations (name, email, topic, session_id, time_slot, status, queued_at, forced, source, created_at)
      values (n, e, s.topic, sid, s.time_slot, 'waitlist', now_ts, false, 'self', now_ts)
      returning id into new_id;
    -- derive before logging so the audit entry records the committed status
    perform reu_derive_session(sid, 'self', array[new_id]);
    select * into r from registrations where id = new_id;
    insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
      values ('create', 'self', new_id, e, n, sid, jsonb_build_object('status', r.status));
    outcomes := outcomes || jsonb_build_object('sessionId', sid, 'topic', s.topic, 'timeSlot', s.time_slot,
                                               'result', r.status, 'id', new_id,
                                               'waitlistPosition', case when r.status = 'waitlist' then reu_waitlist_position(new_id) else null end);
  end loop;

  return jsonb_build_object('ok', true, 'outcomes', outcomes);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  when check_violation then
    return jsonb_build_object('ok', false, 'error', 'conflict');
end $$;

-- Participant cancels one of their own bookings. Only works if the booking belongs to that email.
create or replace function cancel_booking(p_email text, p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e text := reu_norm_email(p_email);
  r registrations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('reu-email:' || e));
  select * into r from registrations where id = p_booking_id and email = e;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform reu_lock_sessions(array[r.session_id]);
  delete from registrations where id = r.id;
  insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
    values ('cancel', 'self', r.id, r.email, r.name, r.session_id, jsonb_build_object('status', r.status));
  perform reu_derive_session(r.session_id, 'self');
  return jsonb_build_object('ok', true, 'topic', r.topic, 'timeSlot', r.time_slot);
end $$;

-- ---------------------------------------------------------------------------
-- Admin API (service role only)
-- ---------------------------------------------------------------------------

create or replace function admin_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'availability', get_availability(),
    'registrations', coalesce((select jsonb_agg(reu_booking_json(r) order by r.created_at desc) from registrations r), '[]'::jsonb)
  )
$$;

create or replace function admin_add(p_name text, p_email text, p_session_id text, p_forced boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e      text := reu_norm_email(p_email);
  n      text := btrim(coalesce(p_name, ''));
  s      sessions%rowtype;
  reason text;
  held   int;
  new_id uuid;
  promos jsonb;
  r      registrations%rowtype;
begin
  if char_length(n) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please enter the person''s full name.');
  end if;
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.');
  end if;
  perform pg_advisory_xact_lock(hashtext('reu-email:' || e));
  perform reu_lock_sessions(array[p_session_id]);
  select * into s from sessions where id = p_session_id;
  reason := reu_rule_check(e, p_session_id);
  if reason is not null then
    return jsonb_build_object('ok', false, 'error', format('This person is %s.', reason));
  end if;
  select count(*) into held from registrations where session_id = p_session_id and not forced;
  if not coalesce(p_forced, false) and held >= s.confirmed_cap + s.waitlist_cap then
    return jsonb_build_object('ok', false, 'error', 'This session is full, including the waitlist. Tick the box above to add them anyway.');
  end if;
  insert into registrations (name, email, topic, session_id, time_slot, status, queued_at, forced, source, created_at)
    values (n, e, s.topic, s.id, s.time_slot, 'waitlist', clock_timestamp(), coalesce(p_forced, false), 'admin', clock_timestamp())
    returning id into new_id;
  promos := reu_derive_session(s.id, 'admin', array[new_id]);
  select * into r from registrations where id = new_id;
  insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
    values ('create', 'admin', new_id, e, n, s.id, jsonb_build_object('status', r.status, 'forced', r.forced));
  return jsonb_build_object('ok', true, 'booking', reu_booking_json(r),
    'promoted', (select coalesce(jsonb_agg(p), '[]'::jsonb) from jsonb_array_elements(promos) p where p ->> 'id' <> new_id::text));
end $$;

create or replace function admin_move(p_id uuid, p_session_id text, p_forced boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      registrations%rowtype;
  s      sessions%rowtype;
  old_sid text;
  reason text;
  held   int;
  promos jsonb := '[]'::jsonb;
begin
  select * into r from registrations where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That booking no longer exists — it may have been cancelled.', 'gone', true);
  end if;
  perform pg_advisory_xact_lock(hashtext('reu-email:' || r.email));
  old_sid := r.session_id;
  perform reu_lock_sessions(array[old_sid, p_session_id]);
  select * into r from registrations where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That booking no longer exists — it may have been cancelled.', 'gone', true);
  end if;
  select * into s from sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That session doesn''t exist.');
  end if;
  if p_session_id = old_sid and coalesce(p_forced, false) = r.forced then
    return jsonb_build_object('ok', true, 'unchanged', true, 'booking', reu_booking_json(r), 'promoted', '[]'::jsonb);
  end if;
  if p_session_id <> old_sid then
    reason := reu_rule_check(r.email, p_session_id, r.id);
    if reason is not null then
      return jsonb_build_object('ok', false, 'error', format('Can''t move: this person is %s.', reason));
    end if;
    select count(*) into held from registrations where session_id = p_session_id and not forced;
    if not coalesce(p_forced, false) and held >= s.confirmed_cap + s.waitlist_cap then
      return jsonb_build_object('ok', false, 'error', 'That session is full, including the waitlist. Tick the box above to move them anyway.');
    end if;
    update registrations
      set session_id = s.id, topic = s.topic, time_slot = s.time_slot, forced = coalesce(p_forced, false),
          moved_at = clock_timestamp(), queued_at = clock_timestamp(), promoted_at = null
      where id = p_id;
  else
    update registrations set forced = coalesce(p_forced, false), moved_at = clock_timestamp() where id = p_id;
  end if;
  promos := promos || reu_derive_session(old_sid, 'admin');
  if p_session_id <> old_sid then
    promos := promos || reu_derive_session(p_session_id, 'admin', array[p_id]);
  end if;
  select * into r from registrations where id = p_id;
  insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
    values ('move', 'admin', r.id, r.email, r.name, r.session_id,
            jsonb_build_object('from', old_sid, 'to', p_session_id, 'forced', r.forced, 'status', r.status));
  return jsonb_build_object('ok', true, 'booking', reu_booking_json(r),
    'promoted', (select coalesce(jsonb_agg(p), '[]'::jsonb) from jsonb_array_elements(promos) p where p ->> 'id' <> p_id::text));
end $$;

create or replace function admin_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      registrations%rowtype;
  promos jsonb;
begin
  select * into r from registrations where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That booking no longer exists — it may have been cancelled.', 'gone', true);
  end if;
  perform reu_lock_sessions(array[r.session_id]);
  delete from registrations where id = p_id returning * into r;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That booking no longer exists — it may have been cancelled.', 'gone', true);
  end if;
  insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
    values ('remove', 'admin', r.id, r.email, r.name, r.session_id, jsonb_build_object('status', r.status));
  promos := reu_derive_session(r.session_id, 'admin');
  return jsonb_build_object('ok', true, 'removed', reu_booking_json(r), 'promoted', promos);
end $$;

-- Restore from a backup JSON array. Idempotent by id; rows that break a rule or reference an
-- unknown session are skipped. Statuses are re-derived afterwards.
create or replace function admin_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x       jsonb;
  s       sessions%rowtype;
  e       text;
  added   int := 0;
  skipped int := 0;
  touched text[] := '{}';
  fresh   uuid[] := '{}';
  sid     text;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Invalid file format.');
  end if;
  perform set_config('reu.bypass_capacity', 'on', true);
  perform 1 from sessions order by id for update;
  for x in select * from jsonb_array_elements(p_rows) loop
    begin
      sid := coalesce(x ->> 'sessionId', x ->> 'slotId');
      e := reu_norm_email(x ->> 'email');
      select * into s from sessions where id = sid;
      if not found or (x ->> 'id') is null or char_length(btrim(coalesce(x ->> 'name', ''))) < 2
         or exists (select 1 from registrations where id = (x ->> 'id')::uuid)
         or reu_rule_check(e, sid) is not null then
        skipped := skipped + 1;
        continue;
      end if;
      insert into registrations (id, name, email, topic, session_id, time_slot, status, queued_at, forced, source,
                                 promoted_at, moved_at, created_at)
      values ((x ->> 'id')::uuid, btrim(x ->> 'name'), e, s.topic, s.id, s.time_slot, coalesce(x ->> 'status', 'waitlist'),
              coalesce((x ->> 'queuedAt')::timestamptz, (x ->> 'createdAt')::timestamptz, (x ->> 'ts')::timestamptz, now()),
              coalesce((x ->> 'forced')::boolean, false),
              case when x ->> 'source' = 'admin' then 'admin' else 'self' end,
              (x ->> 'promotedAt')::timestamptz, (x ->> 'movedAt')::timestamptz,
              coalesce((x ->> 'createdAt')::timestamptz, (x ->> 'ts')::timestamptz, now()));
      insert into audit_log (action, actor, registration_id, email, name, session_id)
        values ('import', 'admin', (x ->> 'id')::uuid, e, btrim(x ->> 'name'), s.id);
      added := added + 1;
      touched := touched || s.id;
      fresh := fresh || (x ->> 'id')::uuid;
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;
  perform set_config('reu.bypass_capacity', 'off', true);
  foreach sid in array coalesce((select array_agg(distinct t) from unnest(touched) t), '{}') loop
    perform reu_derive_session(sid, 'admin', fresh);
  end loop;
  return jsonb_build_object('ok', true, 'added', added, 'skipped', skipped);
end $$;

-- Apply an event configuration. p_sessions is the session list derived from the config by the app
-- (id, topic, kind, timeSlot, label, room, sortOrder, confirmedCap, waitlistCap).
-- Sessions that disappear from the config are deactivated if they still hold bookings (never deleted),
-- so no registration can ever be lost by a config change. Statuses are re-derived for every session.
create or replace function admin_apply_config(p_config jsonb, p_sessions jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x        jsonb;
  ids      text[] := '{}';
  blocked  jsonb := '[]'::jsonb;
  promos   jsonb := '[]'::jsonb;
  sid      text;
begin
  perform pg_advisory_xact_lock(hashtext('reu-config'));
  perform 1 from sessions order by id for update;
  for x in select * from jsonb_array_elements(p_sessions) loop
    ids := ids || (x ->> 'id');
    insert into sessions (id, topic, kind, time_slot, label, room, sort_order, confirmed_cap, waitlist_cap, active)
    values (x ->> 'id', x ->> 'topic', x ->> 'kind', x ->> 'timeSlot', x ->> 'label', (x ->> 'room')::int,
            (x ->> 'sortOrder')::int, (x ->> 'confirmedCap')::int, (x ->> 'waitlistCap')::int, true)
    on conflict (id) do update set
      topic = excluded.topic, kind = excluded.kind, time_slot = excluded.time_slot, label = excluded.label,
      room = excluded.room, sort_order = excluded.sort_order, confirmed_cap = excluded.confirmed_cap,
      waitlist_cap = excluded.waitlist_cap, active = true;
  end loop;

  for sid in select id from sessions where not (id = any(ids)) loop
    if exists (select 1 from registrations where session_id = sid) then
      update sessions set active = false where id = sid;
      blocked := blocked || to_jsonb(sid);
    else
      delete from sessions where id = sid;
    end if;
  end loop;

  insert into event_config (id, data, updated_at) values (1, p_config, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();

  for sid in select id from sessions loop
    promos := promos || reu_derive_session(sid, 'admin');
  end loop;

  insert into audit_log (action, actor, detail)
    values ('config', 'admin', jsonb_build_object('sessions', jsonb_array_length(p_sessions), 'inactiveWithBookings', blocked));
  return jsonb_build_object('ok', true, 'inactiveWithBookings', blocked, 'promoted', promos);
end $$;

create or replace function admin_audit(p_limit int default 500) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.id desc), '[]'::jsonb)
  from (select * from audit_log order by id desc limit greatest(1, least(p_limit, 5000))) a
$$;

-- Fixed-window rate limiter. Returns true when the call is allowed.
create or replace function rate_limit_hit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  rl rate_limits%rowtype;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, now(), 0) on conflict (key) do nothing;
  select * into rl from rate_limits where key = p_key for update;
  if rl.window_start < now() - make_interval(secs => p_window_seconds) then
    update rate_limits set window_start = now(), hits = 1 where key = p_key;
    return true;
  end if;
  if rl.hits >= p_max then
    return false;
  end if;
  update rate_limits set hits = hits + 1 where key = p_key;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Supabase exposes every function in `public` via PostgREST, so be explicit:
-- anon/authenticated may only call the four participant functions plus config/availability.
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    for f in
      select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    loop
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    end loop;
    revoke all on all tables in schema public from anon, authenticated;
    grant select on availability_version to anon, authenticated;
    grant execute on function get_event_config() to anon, authenticated;
    grant execute on function get_availability() to anon, authenticated;
    grant execute on function get_my_bookings(text) to anon, authenticated;
    grant execute on function book_sessions(text, text, text[]) to anon, authenticated;
    grant execute on function cancel_booking(text, uuid) to anon, authenticated;
  end if;
end $$;

-- Realtime: broadcast changes of the (PII-free) version counter.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'availability_version') then
    execute 'alter publication supabase_realtime add table availability_version';
  end if;
end $$;
