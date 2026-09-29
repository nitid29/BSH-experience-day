-- Allow a bookable evening gathering ("social" session kind). Safe to re-run.
alter table sessions drop constraint if exists sessions_kind_check;
alter table sessions add constraint sessions_kind_check check (kind in ('plenary', 'workshop', 'social'));
