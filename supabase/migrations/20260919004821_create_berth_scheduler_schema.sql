-- Berth scheduling schema.
-- Centrepiece: an EXCLUDE constraint that makes a double-booking physically
-- unstorable, rather than merely checked by application code.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- berths
create table berths (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  -- Null only when the source label carried no length
  -- (e.g. "Small craft slips (institution boats)").
  length_ft     integer check (length_ft is null or length_ft > 0),
  -- 'pooled' berths hold several boats at once and are exempt from conflict
  -- detection; without this, Small craft slips reports a false conflict
  -- every time two institution boats are in at once.
  capacity_mode text not null default 'exclusive'
                check (capacity_mode in ('exclusive', 'pooled')),
  display_order integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- --------------------------------------------------------------- vessels
create table vessels (
  id              uuid primary key default gen_random_uuid(),
  canonical_name  text not null,
  -- Upper-cased join key: folds 'Barge SALT DORY' and 'Barge Salt Dory'
  -- into one hull, and OS/V into OSV.
  normalized_name text not null unique,
  -- Null for ~97.5% of vessels in the source data. This emptiness is the
  -- actual problem the system exists to surface.
  length_ft       integer check (length_ft is null or length_ft > 0),
  -- Some registry rows state a length in the name AND a different LOA in the
  -- notes. Both are kept; they are never silently reconciled.
  loa_ft          integer check (loa_ft is null or loa_ft > 0),
  length_source   text check (length_source in ('registry_name', 'loa_note', 'manual')),
  operator        text,
  notes           text,
  created_at      timestamptz not null default now()
);

-- -------------------------------------------------------------- bookings
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  berth_id    uuid not null references berths(id) on delete restrict,
  -- Null for events and closures, which have no vessel.
  vessel_id   uuid references vessels(id) on delete restrict,
  kind        text not null check (kind in ('vessel', 'event', 'closure')),

  -- 'active'              normal; subject to the exclusion constraint below.
  -- 'conflict_unresolved' an imported historical row that overlaps another.
  --                       Loaded rather than discarded, and deliberately OUTSIDE
  --                       the constraint so real history survives. Nothing
  --                       created through the UI is ever given this status.
  -- 'cancelled'           withdrawn; frees the berth.
  status      text not null default 'active'
              check (status in ('active', 'conflict_unresolved', 'cancelled')),

  label       text not null,

  -- Whole-day, inclusive on both ends: this is the source-of-truth pair.
  start_date  date not null,
  end_date    date not null,

  -- Derived half-open range so that a Mon-Wed stay and a Wed-Fri stay are
  -- detected as overlapping on Wednesday. Generated, so it can never drift
  -- out of step with start_date/end_date.
  during      daterange generated always as
              (daterange(start_date, end_date + 1, '[)')) stored,

  -- Denormalised from berths.capacity_mode by trigger, because an exclusion
  -- constraint cannot join to another table. Kept truthful by the trigger.
  exclusive   boolean not null default true,

  notes       text,
  source      text not null default 'manual' check (source in ('import', 'manual')),

  -- Provenance back to the spreadsheet cell, so any row can be traced.
  import_year  integer,
  import_sheet text,
  import_row   integer,
  import_col   integer,

  created_at  timestamptz not null default now(),

  constraint end_not_before_start check (end_date >= start_date),
  constraint vessel_required_for_vessel_kind
             check (kind <> 'vessel' or vessel_id is not null)
);

-- Keep bookings.exclusive in step with the berth it points at.
create function set_booking_exclusive() returns trigger
language plpgsql as $$
begin
  select (b.capacity_mode = 'exclusive')
    into new.exclusive
    from berths b
   where b.id = new.berth_id;
  return new;
end;
$$;

create trigger bookings_set_exclusive
  before insert or update of berth_id on bookings
  for each row execute function set_booking_exclusive();

-- THE GUARANTEE.
-- Two active bookings cannot occupy the same exclusive berth on the same day.
-- Enforced by Postgres, so no application code path, race condition or
-- concurrent request can produce a double-booking.
alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (berth_id with =, during with &&)
  where (status = 'active' and exclusive);

create index bookings_berth_dates_idx on bookings (berth_id, start_date, end_date);
create index bookings_start_date_idx  on bookings (start_date);
create index bookings_status_idx      on bookings (status);

-- ---------------------------------------------------------- review_items
-- The coordinator's attention queue. Anything the importer could not confidently
-- handle lands here as actionable work rather than being silently dropped.
create table review_items (
  id           uuid primary key default gen_random_uuid(),
  type         text not null
               check (type in ('conflict', 'too_long', 'missing_length', 'unclassified')),
  booking_id   uuid references bookings(id) on delete cascade,
  vessel_id    uuid references vessels(id) on delete cascade,
  berth_id     uuid references berths(id) on delete cascade,
  raw_text     text,
  detail       text,
  import_year  integer,
  import_sheet text,
  import_row   integer,
  import_col   integer,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index review_items_open_idx on review_items (type) where resolved_at is null;

-- All database access is server-side through the owning role. RLS is enabled with
-- no policies so that the anon/authenticated API roles can reach nothing at all.
alter table berths       enable row level security;
alter table vessels      enable row level security;
alter table bookings     enable row level security;
alter table review_items enable row level security;
