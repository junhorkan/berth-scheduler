-- The sample reload places a few bookings in the coming weeks, dated from the day it
-- runs. They are neither imported from the workbook nor entered by a person, and the
-- booking sheet says so.
alter table bookings drop constraint bookings_source_check;
alter table bookings add constraint bookings_source_check
  check (source = any (array['import'::text, 'manual'::text, 'sample'::text]));
