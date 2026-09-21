# Operating this thing

How the deployed system is built, kept alive and kept shut. **Needed when deploying or
touching the database — not when writing application code.**

Live at https://berth-scheduler.vercel.app · Vercel project `berth-scheduler` ·
Supabase project `rtovlwkwakiqrconbacm`.

---

## Deploying

**Pushing to `main` deploys.** The Vercel project is connected to
`junhorkan/berth-scheduler`, so a push fires a webhook and production rebuilds on its own.

### The commit author has to be someone Vercel recognises

Vercel **blocks** a git deployment whose commit author matches no account with access to
the project. It fires the webhook, creates the deployment, and stops it at `BLOCKED` —
so the repo looks current, a deployment exists, and the site is still serving old code.

This happened here. Git had no `user.email` configured, so commits were authored as
`junhorkan@Juns-MacBook-Pro-4.local`, a placeholder derived from the hostname. The fix
was to set the repo's identity to the email on the Vercel account:

```bash
git config user.email "junhorkan@gmail.com"
```

If deployments start coming back `BLOCKED`, check the commit author before anything else.

### Verifying a deploy actually landed

The deployment list is not proof, and neither is the Git settings page — "connected" was
true here while nothing was building. Check a *behaviour* that changed:

```bash
curl -s https://berth-scheduler.vercel.app/ | grep -c 'class="find"'      # search box
curl -s -o /dev/null -w '%{http_code}' https://berth-scheduler.vercel.app/search
```

A `READY` deployment in the list is not proof the alias moved.

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

Four `*_seed` tables hold the imported workbook exactly as `npm run import` loaded it;
**Load the sample schedule** and the test suite's teardown both copy from them, then add
the forward bookings from `src/lib/sample.ts`, dated from the day of the reload. They have
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

There is no DDL file in the repo; the schema lives in Supabase and is changed through
migrations. Two are worth knowing about:

- **The berths are defined in a migration**, idempotently, so a database built from
  nothing has the facility in it. The importer and the sample reload also write them —
  from the workbook and from `berths_seed` respectively, with the same ids — so the three
  never disagree.
- **`review_items.type` is constrained** to the kinds the app can actually produce.
  Missing lengths are derived at read time, not stored, so that value is not accepted.

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
  exactly what the button would, forward bookings included.
- The proper fix is a second database — a Supabase branch, or a local Postgres for the
  suite — pointed at by `DATABASE_URL` in a test env file. It was not worth the setup
  inside this project's time budget, and this note is the mitigation.
