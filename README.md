# Harborview Dock Schedule

Berth reservation management for a marine research facility.

**Live:** https://berth-scheduler.vercel.app

![The board: berths down, days across, and a 120ft vessel drawn breaking out of its 75ft lane](public/board.png)

Replaces a spreadsheet in which double-bookings were caught by eye and vessel/berth size
was not checked at all.

## Try it in sixty seconds

1. **Open the link.** The board opens on today with a live schedule. The red bar
   breaking out of its lane is a vessel too long for its berth — the bar's height is
   vessel length ÷ berth length, so a misfit is geometry, not a badge.
2. **Press + New booking.** The berth it opens onto is already taken today, so the
   verdict is red and Save is off: the database would refuse the write, and there is no
   override. Press **Find me a berth**: it proposes a free berth and says why, and for a
   vessel whose length is on record it picks the smallest one that fits.
3. **Save it, then click it and cancel it.** Review lists it under *Recently cancelled*
   and **Restore** puts it back — unless someone took the berth meanwhile, in which
   case the same constraint refuses the restore and says so.

---

## The problem, and why the two halves are handled differently

The brief names two failures. They look similar and are not:

**1. Double-booking.** Two things on one berth at once. Caught today by a human scanning
a grid — mostly working, but expensive and fragile.
→ Made **structurally impossible**. Postgres enforces it:

```sql
EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active')
```

No application code path, race condition or concurrent request can store an overlap.
This is not a check that runs before an insert; it is a property of the table.

**2. Vessel too long for its berth.** Not checked today, and *not always checkable*: a
vessel's length is only known once somebody records it, and the coordinator booking a
visiting vessel by email rarely has its LOA to hand.
→ Cannot be made impossible. Made **visible**, with the missing data collectable as a
side effect of normal work — booking a vessel registers it, and its length can be filled
in later. The check warns and never blocks, because blocking on data that often does not
exist would make the tool unusable.

That asymmetry — a hard database constraint for one, an advisory warning for the other —
is the central design decision. See `DECISIONS.md`.

## What it does

- **Board** — berths down, days across, one month at a time, **opening on today**. It
  runs three years forward, and back far enough to cover whatever is on the schedule, so
  the 1997 imports are reachable. You can review what was booked, but not book a date
  that has passed. A bar's **height is
  `vessel length ÷ berth length`**, so a vessel that does not fit visibly breaks out of
  its lane. Create, cancel and reassign bookings, for vessels, non-vessel events and
  berth closures alike.
- **Vessels** — the register, ordered by *bookings blocked* rather than alphabetically,
  so the highest-leverage gaps come first. It fills itself: booking a vessel adds it.
- **Review** — the coordinator's queue: size violations, and a single derived row saying
  how much of the schedule cannot be fit-checked yet. Clearing the schedule back to the
  shipped state lives here too.
- **The legacy schedule is imported, and removable.** 23 years of bookings are loaded so
  the conflict and size checks can be tried against real, messy data, and the sample
  reaches into the coming weeks: seventeen bookings dated from the day it was loaded,
  using the register's own vessels, so the board opens on a live month with a misfit
  on it. **Clear the schedule** empties it and **Load the sample schedule** puts it
  back, both on Review — an empty schedule is a supported state, not a broken one, and
  an empty month names the nearest month that is not and links to it.
- **Find** — one box, searching every vessel name, event label and closure note across
  all 276 months at once. Results group by identity, so a vessel with 267 bookings is one
  block and not 267 rows, and each result jumps straight to its own month on the board.

## Importing the legacy workbook

`npm run import` parses all 23 sheets and reconciles exactly:

```
2,212 source cells → 2,031 stays     (145 cells merged, 49 across a month boundary)
        7 berths · 418 vessels · 29 review items
   272 / 272 month blocks resolved
```

Only **20 of 418 vessels** have a length recorded anywhere in the source, which is the
evidence behind warning rather than blocking on fit. Among the bookings that *can* be
checked, **9 are physically impossible** — the worst a 170′ vessel in a 90′ berth.

The workbook itself is not in this repo; place it at `data/` to re-run the import. Three
source defects had to be handled, each documented in `ASSUMPTIONS.md` and
`docs/DATA-NOTES.md`.

## Running it locally

```bash
npm install
echo 'DATABASE_URL="postgresql://..."' > .env.local   # Supabase transaction pooler, port 6543
npm run dev
```

```bash
npm test          # 252 unit tests, no database required
npm run e2e       # 48 Playwright specs. Writes to the live database — see docs/OPERATIONS.md
npm run lint      # clean
npm run typecheck # clean
npm run import    # reload the workbook (needs data/*.xlsx, gitignored)
npm run sample:load # put the sample back from the seed snapshot; same code as the Load button
npm run db:check  # verify connection and that the constraint exists
```

Requires Node 24.

## Structure

```
src/domain/   PURE business rules. No database, no React. Unit tested.
src/import/   spreadsheet → domain objects. Depends on domain, never on UI.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

`src/domain` and `src/lib` import nothing from `db` or `app`, so the conflict, fit,
navigation and search rules are provably correct without a database — 252 unit tests run
in well under a second with no infrastructure at all. The importer and the UI call the
same functions, so the rule the board shows you is the rule the import applied.

The look is borrowed, not invented: the scale, the centred title and the one filled button
come from a site the project owner finds easy to use, and `DECISIONS.md` entries 19 and 24
record what was taken, what was measured, and what was left.

## Stack

Next.js (App Router) · TypeScript · Postgres on Supabase · Vercel · Vitest · SheetJS.

No ORM: the schema's single source of truth is SQL, because the `EXCLUDE` constraint at
the heart of this design cannot be expressed in any ORM schema DSL, and maintaining the
schema twice invites drift. No scheduler/Gantt library: every one of them assumes a
booking fills its lane, and none can draw a bar that **overhangs** its row.

## Operational notes

- **The Supabase free tier pauses a project after ~7 days of inactivity.** A scheduled
  ping keeps it awake. If the site ever errors after a long quiet period, opening the
  Supabase dashboard restores it.
- **The app is public and unauthenticated by design**, so a reviewer can exercise the
  conflict check without credentials. **Load the sample schedule** on the Review tab
  puts back the state the app ships in. **Clear the schedule** is the one action that
  cannot be undone: it removes every booking and vessel, including anything created
  through the app, and leaves the seven berths.
