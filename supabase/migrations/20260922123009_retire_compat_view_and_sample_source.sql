-- Two things that could only go once the build reading undo_meta was live.
--
-- The compatibility view kept the previous deploy working across the rename to
-- undo_meta. Nothing reads it now.
drop view if exists clear_undo_meta;

-- 'sample' was the source of bookings the reload placed around today with invented
-- dates. Those were removed (DECISIONS 29): every row is now imported from the workbook
-- or entered through the app, and the constraint says so again.
alter table bookings drop constraint bookings_source_check;
alter table bookings add constraint bookings_source_check
  check (source = any (array['import'::text, 'manual'::text]));
