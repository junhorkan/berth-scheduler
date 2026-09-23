# Operating this thing

How the deployed system is built, kept alive and kept shut. **Needed when deploying or
touching the database — not when writing application code.**

Live at https://berth-scheduler.vercel.app · Vercel project `berth-scheduler` ·
Supabase project `rtovlwkwakiqrconbacm`.

---

## Deploying

**Pushing to `main` deploys.** The Vercel project is connected to the repository, so a push
fires a webhook and production rebuilds on its own. A deployment appearing in the list is
not proof that the site changed — check a behaviour that changed before believing it.

## Staying awake

Supabase free tier **pauses a project after ~7 days idle**, and a paused database makes
the site look broken to anyone opening the link. `vercel.json` declares a daily cron at
07:00 UTC hitting `/api/keep-warm`, which runs a trivial query.

Vercel Hobby crons run **once a day at most**. Confirm the cron has actually fired at
least once after any deploy that changes `vercel.json`.

## Database access posture

**Every table has RLS enabled with no policies.** That denies every PostgREST role; the
application reaches the database as the owning role, which RLS does not apply to. This is
deliberate — there is no client-side database access anywhere in the app, so a policy
would open a door nothing needs.

Three `*_undo` tables plus `undo_meta` hold whatever the last **Clear** or **Load**
replaced. They are written inside the same transaction that replaces the live tables,
and emptied when the undo is used. An action over an already-empty schedule leaves them
alone, so Clear followed by an accidental Load can still put back what was there before
the Clear. `npm run sample:load` and the test suite's teardown discard them, so a reset
leaves no "put back" offer pointing at test data. They are snapshots, never a source of
truth.

Four `*_seed` tables hold the imported workbook exactly as `npm run import` loaded it;
**Load the sample schedule** and the test suite's teardown both copy from them. They have
RLS enabled like everything else — it was found disabled on them twice and re-enabled by
migration, most recently on 2026-09-19 — so check them first if `get_advisors` ever
reports a table open. It is clean of ERROR-level findings.

One WARN is accepted and not fixed: **`btree_gist` lives in the `public` schema.** Moving
it risks the operator-class resolution that the `EXCLUDE` constraint depends on, which is
the single most important guarantee in the project. Not worth the trade.

## Connections

- The pool must be **larger than the number of parallel queries per render** or requests
  deadlock for minutes. Created lazily, never at module scope — one pool per hot reload
  leaks until the database refuses connections.
- A dev server killed mid-query leaves a backend waiting on a dead socket. `npm run
  db:check` shows it; connections recycle and carry a statement timeout to survive it.
- Supabase transaction pooler, port 6543, **requires `prepare: false`**.

## Schema

**Every migration is in [`supabase/migrations/`](../supabase/migrations/)**, in the order
it was applied, exported from the database's own migration log, and **they replay onto an
empty database**: all thirteen were run in order against an in-process Postgres (PGlite,
with `btree_gist`) on 2026-09-22. Three of them had assumed tables that only an import had
created, and now guard for that; each carries a note saying so. The exclusion constraint
is at line 114 of the first one.

**A file in that directory applies nothing.** There is no migrate command and no local
database: a migration is applied to the live database out of band — Supabase's SQL editor,
or the Supabase MCP's `apply_migration`, which assigns its own version timestamp — and the
directory is the log exported afterwards. So write the SQL, apply it, export it under the
version the database gave it, and run `npm run db:check`. Remember that it lands on the
live database at once while the code that needs it takes a deploy.

Three things worth knowing:

- **The berths are defined in a migration**, idempotently, so a database built from
  nothing has the facility in it. Nothing else writes them: Clear, Load, Put back and the
  importer all leave the seven rows alone, so their ids never change — which is what lets
  an undo put back bookings that reference them.
- **`review_items.type` is constrained** to the kinds the app can actually produce.
  Missing lengths are derived at read time, not stored, so that value is not accepted.
- **The `*_seed` tables are created empty.** The newest migration makes them, and the
  `*_undo` tables, real tables with primary keys and row-level security. `npm run import`
  fills them, in the same transaction that writes the live schedule. So a database built
  from migrations alone has the schema and the berths but nothing for **Load the sample**
  to load until the importer has run once against the workbook. Stated rather than
  hidden: moving the seed rows into a migration would put the club's data in the repo.

## Environment

`DATABASE_URL` in `.env.local` (gitignored) and as a `sensitive` Vercel env var. The
password contains characters that **must be percent-encoded** in the URI.

## The workbook is not in the repository, and once was

`data/*.xlsx` is ignored because the sample is the client's material. It was nonetheless
committed in the very first commit, 23 commits before the ignore rule existed — **an
ignore rule never untracks a file that is already tracked.** History was rewritten on
2026-09-19 with `git filter-branch` to remove it from every commit and force-pushed, before
the repository was made public. A stray test-output file, `.vitest/json/output.json`, went
the same way and `/.vitest/` is now ignored.

`git ls-files data` must print nothing. If it ever does, that is the bug.

## Advisory findings deliberately not acted on

`get_advisors` is clean of ERROR and WARN findings except the `btree_gist` one above.
The remaining INFO-level performance advice was measured and rejected:

- **Unindexed foreign keys** on `bookings.vessel_id` and the three `review_items` keys.
  The queries that touch them aggregate every row, so the planner correctly chooses a
  sequential scan and would not use an index. `getVessels()` — the heaviest query in the
  app — plans as a hash right join; measured against a few thousand rows it ran in
  **2.6 ms**, while the page took ~220 ms end to end. That time is network and rendering,
  not database.

  The other usual reason to index a foreign key is cascading deletes, and
  `clearSchedule` already deletes children before parents, so `delete from vessels`
  checks an empty `bookings` table.

Adding four indexes to silence a linter that measurement says is wrong would be worse
than the finding.

## The test suite writes to the live database

There is one database. `npm run e2e` deletes every booking and vessel, seeds its own
fixture three months ahead of today, and restores the sample in `global-teardown`.

**While it runs, the public URL serves the fixture.** Someone loading
berth-scheduler.vercel.app mid-run sees seven test vessels in a month three ahead, and
the empty-month pointer truthfully names that month — which reads as a bug and is not
one. This has actually happened, and it is the reason to know about it:

- **Do not run the suite when anyone might be looking**, and especially not once a link
  has been handed to somebody.
- If a run is interrupted before teardown, put the data back with the **Load the sample
  schedule** button on Review, or `npm run sample:load`, which is the same function
  from the terminal. The teardown calls that function too, so the suite leaves behind
  exactly what the button would.
- The proper fix is a second database — a Supabase branch, or a local Postgres for the
  suite — pointed at by `DATABASE_URL` in a test env file. It was not worth the setup
  inside this project's time budget, and this note is the mitigation.
