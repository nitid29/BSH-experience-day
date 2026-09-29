-- Change a participant's registration in one atomic step (PRD 8.11 "edit my registration").
-- The participant sends the complete list of sessions they want. In a single transaction:
--   * bookings that stay selected are kept untouched (they keep their status and queue position),
--   * bookings that are no longer selected are cancelled,
--   * newly selected sessions are booked (status assigned at commit, as in book_sessions).
-- If anything is invalid or full, nothing changes. p_based_on is the list of booking ids the person saw;
-- if their bookings changed meanwhile (e.g. an organiser moved them), the call returns 'stale' and
-- changes nothing, so a stale screen can never undo someone else's change. Safe to re-run.

create or replace function update_registration(p_name text, p_email text, p_session_ids text[], p_based_on uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e          text := reu_norm_email(p_email);
  n          text := btrim(coalesce(p_name, ''));
  ids        text[];
  held_ids   text[];
  sid        text;
  s          sessions%rowtype;
  r          registrations%rowtype;
  reason     text;
  held       int;
  rejected   boolean := false;
  outcomes   jsonb := '[]'::jsonb;
  removed    jsonb := '[]'::jsonb;
  seen_topics text[] := '{}';
  seen_times  text[] := '{}';
  fresh      uuid[] := '{}';
  touched    text[] := '{}';
  new_id     uuid;
  now_ts     timestamptz := clock_timestamp();
begin
  if char_length(n) < 2 or char_length(n) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if not reu_email_allowed(e) then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into ids from unnest(coalesce(p_session_ids, '{}')) x where x is not null;
  if array_length(ids, 1) > 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_sessions');
  end if;

  perform pg_advisory_xact_lock(hashtext('reu-email:' || e));

  -- The screen must reflect the current bookings, otherwise nothing is changed.
  if p_based_on is not null and
     (select coalesce(array_agg(id order by id), '{}') from registrations where email = e)
     <> (select coalesce(array_agg(x order by x), '{}') from unnest(p_based_on) x) then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  select coalesce(array_agg(session_id), '{}') into held_ids from registrations where email = e;
  perform reu_lock_sessions(ids || held_ids);

  -- Validate the complete wished-for set.
  foreach sid in array ids loop
    select * into s from sessions where id = sid;
    reason := null;
    if not found then
      reason := 'unknown_session';
    elsif s.topic = any(seen_topics) then
      reason := format('rule:choosing two sessions of %s', reu_topic_label(s.topic));
    elsif s.time_slot = any(seen_times) then
      reason := format('rule:choosing two sessions at %s', s.time_slot);
    elsif not (sid = any(held_ids)) then
      if not s.active then
        reason := 'unknown_session';
      else
        select count(*) into held from registrations where session_id = sid and not forced;
        if held >= s.confirmed_cap + s.waitlist_cap then
          reason := 'full';
        end if;
      end if;
    end if;
    seen_topics := seen_topics || s.topic;
    seen_times := seen_times || s.time_slot;
    if reason is not null then
      rejected := true;
    end if;
    outcomes := outcomes || jsonb_build_object('sessionId', sid, 'topic', s.topic, 'timeSlot', s.time_slot,
      'result', case when reason is null then 'ok' else 'rejected' end, 'reason', reason);
  end loop;

  if rejected then
    return jsonb_build_object('ok', false, 'error', 'rejected', 'outcomes', outcomes);
  end if;

  -- Cancel bookings that are no longer wanted.
  for r in select * from registrations where email = e and not (session_id = any(ids)) loop
    delete from registrations where id = r.id;
    insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
      values ('cancel', 'self', r.id, r.email, r.name, r.session_id, jsonb_build_object('status', r.status, 'via', 'change'));
    removed := removed || jsonb_build_object('id', r.id, 'topic', r.topic, 'timeSlot', r.time_slot, 'status', r.status);
    touched := touched || r.session_id;
  end loop;

  -- Book the newly selected sessions.
  foreach sid in array ids loop
    if sid = any(held_ids) then
      continue;
    end if;
    select * into s from sessions where id = sid;
    insert into registrations (name, email, topic, session_id, time_slot, status, queued_at, forced, source, created_at)
      values (n, e, s.topic, sid, s.time_slot, 'waitlist', now_ts, false, 'self', now_ts)
      returning id into new_id;
    fresh := fresh || new_id;
    touched := touched || sid;
  end loop;

  -- Re-derive every affected session (frees seats for the waitlist, assigns the new bookings).
  foreach sid in array coalesce((select array_agg(distinct t) from unnest(touched) t), '{}') loop
    perform reu_derive_session(sid, 'self', fresh);
  end loop;

  outcomes := '[]'::jsonb;
  foreach sid in array ids loop
    select * into r from registrations where email = e and session_id = sid;
    if r.id = any(fresh) then
      insert into audit_log (action, actor, registration_id, email, name, session_id, detail)
        values ('create', 'self', r.id, e, r.name, sid, jsonb_build_object('status', r.status, 'via', 'change'));
    end if;
    outcomes := outcomes || jsonb_build_object('sessionId', sid, 'topic', r.topic, 'timeSlot', r.time_slot,
      'result', r.status, 'id', r.id, 'kept', not (r.id = any(fresh)),
      'waitlistPosition', case when r.status = 'waitlist' then reu_waitlist_position(r.id) else null end);
  end loop;

  return jsonb_build_object('ok', true, 'outcomes', outcomes, 'removed', removed);
exception
  when unique_violation or check_violation then
    return jsonb_build_object('ok', false, 'error', 'conflict');
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function update_registration(text, text, text[], uuid[]) from public;
    grant execute on function update_registration(text, text, text[], uuid[]) to anon, authenticated;
  end if;
end $$;
