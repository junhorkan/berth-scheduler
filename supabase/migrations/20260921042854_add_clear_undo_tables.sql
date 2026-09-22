-- Clear the schedule was the one irreversible action in the app. These hold the state
-- it deleted, so it can be put back.
--
-- Created with `as select ... with no data`, deliberately: that gives plain columns of
-- matching type with no constraints and, crucially, no copy of bookings.during, which
-- is GENERATED and cannot be written to. The same reason resetToImported lists its
-- columns out rather than using select *.
create table if not exists bookings_undo as
  select id, berth_id, vessel_id, kind, status, label, start_date, end_date, exclusive,
         notes, source, import_year, import_sheet, import_row, import_col, created_at,
         cancelled_at
    from bookings with no data;

create table if not exists vessels_undo as
  select id, canonical_name, normalized_name, length_ft, loa_ft, length_source, operator,
         notes, created_at
    from vessels with no data;

create table if not exists review_items_undo as
  select id, type, booking_id, vessel_id, berth_id, raw_text, detail, import_year,
         import_sheet, import_row, import_col, resolved_at, created_at
    from review_items with no data;

-- One row records when the snapshot was taken, so the UI can say "cleared 2 minutes ago"
-- and, more importantly, can tell "nothing was ever cleared" from "a clear removed
-- nothing because the schedule was already empty".
create table if not exists clear_undo_meta (
  id          int primary key default 1,
  taken_at    timestamptz not null default now(),
  bookings    int not null,
  vessels     int not null,
  constraint clear_undo_meta_single_row check (id = 1)
);

-- Same posture as every other table here: RLS on, no policies. The app reaches the
-- database as the owning role, which RLS does not apply to, and nothing client-side
-- ever touches it. See docs/OPERATIONS.md.
alter table bookings_undo     enable row level security;
alter table vessels_undo      enable row level security;
alter table review_items_undo enable row level security;
alter table clear_undo_meta   enable row level security;
