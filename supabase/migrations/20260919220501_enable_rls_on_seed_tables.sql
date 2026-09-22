-- The *_seed tables are the restore point for "Load the sample schedule".
-- They carry no policies on purpose: the app connects as the owning role over
-- DATABASE_URL and never uses supabase-js, so the anon/authenticated roles have
-- no business reading or writing them. This matches the four live tables.
alter table "public"."berths_seed"       enable row level security;
alter table "public"."vessels_seed"      enable row level security;
alter table "public"."bookings_seed"     enable row level security;
alter table "public"."review_items_seed" enable row level security;
