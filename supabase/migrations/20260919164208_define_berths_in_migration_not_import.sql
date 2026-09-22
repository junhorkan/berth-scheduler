-- The berths are the facility itself, not schedule data: without them there is
-- nothing to book into. They were previously created as a side effect of importing
-- the legacy workbook, so removing that importer would have left them defined
-- nowhere. Idempotent, so it is safe to re-run.
--
-- "Small craft slips" holds several institution boats at once and is therefore
-- pooled — exempt from the exclusion constraint, or it would report a false
-- conflict constantly. Every other berth is exclusive.
insert into public.berths (name, length_ft, capacity_mode, display_order, active)
values
  ('North Pier West',                       410, 'exclusive', 0, true),
  ('North Pier Face',                        75, 'exclusive', 1, true),
  ('North Pier East',                       240, 'exclusive', 2, true),
  ('Inner Channel',                          55, 'exclusive', 3, true),
  ('South Float West',                       90, 'exclusive', 4, true),
  ('South Float East',                       90, 'exclusive', 5, true),
  ('Small craft slips (institution boats)', null, 'pooled',    6, true)
on conflict (name) do update
   set length_ft     = excluded.length_ft,
       capacity_mode = excluded.capacity_mode,
       display_order = excluded.display_order,
       active        = excluded.active;
