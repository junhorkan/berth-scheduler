-- REPLAY GUARD, added 2026-09-22. This migration was applied to the live database
-- without IF EXISTS, when the *_seed tables existed there. No migration creates them —
-- the importer does — so on an empty database the unguarded form failed and the whole
-- chain stopped here. The guard makes it a no-op where they are absent; where they exist
-- its effect is unchanged. The last migration creates them. DECISIONS 30.

-- The *_seed tables are the restore point for "Load the sample schedule".
-- They carry no policies on purpose: the app connects as the owning role over
-- DATABASE_URL and never uses supabase-js, so the anon/authenticated roles have
-- no business reading or writing them. This matches the four live tables.
alter table if exists "public"."berths_seed"       enable row level security;
alter table if exists "public"."vessels_seed"      enable row level security;
alter table if exists "public"."bookings_seed"     enable row level security;
alter table if exists "public"."review_items_seed" enable row level security;
