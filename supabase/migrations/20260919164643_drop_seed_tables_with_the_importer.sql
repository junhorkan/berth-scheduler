-- These held the imported legacy workbook so it could be restored. The importer and
-- the sample data are gone: the app ships with an empty schedule, and the berths are
-- defined in their own migration rather than as a side effect of an import.
drop table if exists public.review_items_seed;
drop table if exists public.bookings_seed;
drop table if exists public.vessels_seed;
drop table if exists public.berths_seed;
