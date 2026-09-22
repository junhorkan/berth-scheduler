-- Temporary. The deployed build still reads clear_undo_meta; this keeps it working until
-- the code that reads undo_meta is live, after which this view is dropped.
create or replace view clear_undo_meta as select id, taken_at, bookings, vessels from undo_meta;
