-- The snapshot tables, made into ordinary tables with keys, and created on an empty
-- database too. DECISIONS 30.

-- 1. Create the *_seed tables where they do not exist yet.
--
-- They are the restore point for "Load the sample schedule". No migration ever created
-- them: `npm run import` did, with `create table ... as select`, so a database built from
-- migrations alone had nothing for Load to read, and the chain did not even replay. Here
-- they are created empty, shaped as the importer leaves them. On the live database they
-- already exist and hold the sample, and these statements do nothing.
create table if not exists public.berths_seed       as select * from public.berths       with no data;
create table if not exists public.vessels_seed      as select * from public.vessels      with no data;
create table if not exists public.bookings_seed     as select * from public.bookings     with no data;
create table if not exists public.review_items_seed as select * from public.review_items with no data;

-- 2. Primary keys on every snapshot table.
--
-- `create table as` copies columns and nothing else, so none of the eight had one. That
-- is not only a linter finding: with no key on the undo tables, two replace actions that
-- overlapped each copied the live rows in, the snapshot held every row twice, and
-- putting it back then failed on the live tables' own primary keys, every time. The
-- replace actions now also take a lock, so this is the second line, not the only one.
do $$
declare t text;
begin
  foreach t in array array['berths_seed', 'vessels_seed', 'bookings_seed', 'review_items_seed',
                            'vessels_undo', 'bookings_undo', 'review_items_undo']
  loop
    if not exists (
      select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
       where r.relname = t and r.relnamespace = 'public'::regnamespace and c.contype = 'p'
    ) then
      execute format('alter table public.%I add primary key (id)', t);
    end if;
  end loop;
end $$;

-- 3. Same posture as every other table: row-level security on, no policies. The app
-- reaches the database as the owning role, which RLS does not apply to.
alter table public.berths_seed       enable row level security;
alter table public.vessels_seed      enable row level security;
alter table public.bookings_seed     enable row level security;
alter table public.review_items_seed enable row level security;

-- 4. Putting a schedule back is now itself undoable: it is a swap, and what it replaces
-- is kept like anything Clear or Load replaces. The snapshot records which action made it.
alter table public.undo_meta drop constraint if exists undo_meta_kind;
alter table public.undo_meta add constraint undo_meta_kind
  check (kind in ('clear', 'load', 'restore'));
