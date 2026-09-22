-- The undo snapshot used to belong to Clear alone. Loading the sample also replaces the
-- whole schedule, and it had no undo at all — it deleted visitor bookings and discarded
-- the Clear snapshot, which contradicted "nothing destructive is irreversible". The
-- snapshot now belongs to whichever action last replaced the schedule, so the table
-- gets a neutral name and records which action that was.
alter table clear_undo_meta rename to undo_meta;
alter table undo_meta rename constraint clear_undo_meta_single_row to undo_meta_single_row;
alter table undo_meta add column if not exists kind text not null default 'clear';
alter table undo_meta add constraint undo_meta_kind check (kind in ('clear', 'load'));
