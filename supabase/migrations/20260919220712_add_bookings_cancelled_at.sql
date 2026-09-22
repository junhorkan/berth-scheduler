-- When a booking was cancelled through the app. Null for everything else, including
-- every imported row, so the "recently cancelled" list only ever holds work somebody
-- actually undid here rather than 2,031 rows of history.
--
-- It earns its place twice: it orders that list, and on restore it identifies exactly
-- which review items to re-open — cancelBooking stamps this column and resolves the
-- booking's open items inside one transaction, so `resolved_at >= cancelled_at` picks
-- out the ones cancelling closed and leaves anything resolved by hand beforehand alone.
alter table "public"."bookings"
  add column if not exists "cancelled_at" timestamptz;

create index if not exists bookings_cancelled_at_idx
  on "public"."bookings" ("cancelled_at" desc)
  where "cancelled_at" is not null;
