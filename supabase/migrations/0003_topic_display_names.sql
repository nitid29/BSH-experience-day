-- Show full topic names (not internal short keys such as "CI" or "STX") in rule messages. Safe to re-run.

-- Display name for a topic key, taken from the event configuration.
create or replace function reu_topic_label(p_topic text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case
       when p_topic = data -> 'plenary' ->> 'topic' then data -> 'plenary' ->> 'title'
       when p_topic = data -> 'evening' -> 'registration' ->> 'topic' then data -> 'evening' ->> 'title'
       else (select t ->> 'title' from jsonb_array_elements(data -> 'workshops' -> 'topics') t where t ->> 'key' = p_topic)
     end
     from event_config where id = 1),
    p_topic)
$$;

create or replace function reu_rule_check(p_email text, p_session_id text, p_exclude uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s     sessions%rowtype;
  other registrations%rowtype;
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
      return format('already booked for the %s session at %s (only one of the two is allowed)', reu_topic_label(s.topic), other.time_slot);
    end if;
    return format('already booked for %s at %s', reu_topic_label(s.topic), other.time_slot);
  end if;
  select * into other from registrations
    where email = p_email and time_slot = s.time_slot and (p_exclude is null or id <> p_exclude) limit 1;
  if found then
    return format('already booked for %s at %s', reu_topic_label(other.topic), s.time_slot);
  end if;
  return null;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function reu_topic_label(text) from public, anon, authenticated;
    revoke all on function reu_rule_check(text, text, uuid) from public, anon, authenticated;
  end if;
end $$;
