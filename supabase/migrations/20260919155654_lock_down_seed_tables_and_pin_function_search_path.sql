-- REPLAY GUARD, added 2026-09-22. This migration was applied to the live database
-- without IF EXISTS, when the *_seed tables existed there. No migration creates them —
-- the importer does — so on an empty database the unguarded form failed and the whole
-- chain stopped here. The guard makes it a no-op where they are absent; where they exist
-- its effect is unchanged. The last migration creates them. DECISIONS 30.

-- The four *_seed tables hold the pristine import that "Reset to imported state"
-- restores from. They had RLS disabled while the four live tables had it enabled,
-- so PostgREST exposed them where it exposes nothing else. Enabling RLS with no
-- policies denies every API role; the app connects as the owning role, which RLS
-- does not apply to, so the reset path is unaffected.
alter table if exists public.berths_seed       enable row level security;
alter table if exists public.vessels_seed      enable row level security;
alter table if exists public.bookings_seed     enable row level security;
alter table if exists public.review_items_seed enable row level security;

-- A mutable search_path lets a caller's schema resolution decide what this function
-- touches. Pin it.
alter function public.set_booking_exclusive() set search_path = public, pg_temp;
