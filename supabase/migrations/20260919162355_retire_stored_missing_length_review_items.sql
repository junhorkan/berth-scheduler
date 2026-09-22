-- missing_length is now derived at read time by getMissingLengthSummary(), because a
-- stored count went stale: cancelling a vessel's last booking left an item insisting
-- its bookings could not be checked, and clearing a length created no item at all.
-- 398 of 427 queue items were this one type.
delete from public.review_items      where type = 'missing_length';
delete from public.review_items_seed where type = 'missing_length';

-- Stop the type being writable at all, so a half-migrated importer fails loudly
-- instead of quietly repopulating the queue.
alter table public.review_items drop constraint if exists review_items_type_check;
alter table public.review_items add constraint review_items_type_check
  check (type = any (array['conflict','too_long','unclassified']));
