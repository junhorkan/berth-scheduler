# Harborview Dock Schedule

Berth reservation management for a marine research facility. It replaces a spreadsheet in
which double-bookings were caught by eye and vessel/berth size was not checked at all.

**Live, no login: https://berth-scheduler.vercel.app**

![July 2010 from the imported workbook: berths down, days across, and R/V CLEAR TERN, 120ft, drawn breaking out of the 75ft North Pier Face](public/board.png)

## Try it in two minutes

Everything on the board is from the workbook you sent. Nothing is invented.

1. **Open [July 2010](https://berth-scheduler.vercel.app/?y=2010&m=7).** The red bar
   breaking out of North Pier Face, labelled `120ft in 75ft berth`, is R/V CLEAR TERN in a
   75ft berth — one of nine physically impossible assignments in your 23 years. A bar's
   height is vessel length ÷ berth length, so a misfit is geometry, not a badge you have to
   learn.
2. **Book something, then book it again.** Press **Today**, then **+ New booking**, type any
   vessel name and save. Press **+ New booking** again: it opens on the same berth and day,
   so the verdict is red, Save is off, and it names the booking in the way. The database
   refuses the write, and there is no override. **Find me a berth** proposes a free one and
   says why. Cancel your booking when you are done; Review can restore it.
3. **Open [Review](https://berth-scheduler.vercel.app/review) → History → Unresolved
   conflict.** The archive starts closed, one button per kind of problem. The one
   double-booking in all 23 years — South Float East, 11 July 2017 — is kept, not deleted,
   and **Could not be read** holds the cells the importer would not guess at, each with its
   sheet, row and column. **Show on board** opens a booking where it sits on the board.
4. **Open [Vessels](https://berth-scheduler.vercel.app/vessels) and press `last 2019` on the
   first row.** The register is ordered by how many bookings each missing length blocks, so
   the top of it is where recording one length is worth the most — R/V Long Ketch, 267
   bookings, no length on record. The year links straight to that hull's last booking on the
   board. Type a length into the box beside any row and the fit check starts working on
   every booking that vessel has.

The board opens on the facility's own month, which is empty: every booking in the workbook
ended in 2019, and no booking is invented to fill the front door. It says so, and links to
the nearest month that is not empty.

---

## The problem, and why the two halves are handled differently

The brief names two failures. They look similar and are not:

**1. Double-booking.** Two things on one berth at once. Caught today by a human scanning a
grid — mostly working, but expensive and fragile.
→ Made **structurally impossible**. Postgres enforces it:

```sql
EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active' AND exclusive)
```

No application code path, race condition or concurrent request can store an overlap. This
is not a check that runs before an insert; it is a property of the table.

**2. Vessel too long for its berth.** Not checked today, and *not always checkable*: a
vessel's length is only known once somebody records it, and the coordinator booking a
visiting vessel by email rarely has its LOA to hand.
→ Cannot be made impossible. Made **visible**, with the missing data collected as a side
effect of normal work: booking a vessel registers it, and the booking form asks for a
length — optionally, never as a gate — at the one moment somebody has it in front of them.
The check warns and never blocks, because blocking on data that often does not exist would
make the tool unusable.

**3. The same hull at two berths at once.** Not checked today either, and present twelve
times in your own workbook — four of them over two whole days.
→ Decidable, and *still* only a warning, because a constraint would refuse to load those
twelve rows and the history would be lost with them. The dividing line is **preventable
versus already present**, not decidable versus not.

That asymmetry — a hard database constraint for one, advisory warnings for the others — is
the central design decision. Fourteen entries of reasoning are in
[DECISIONS.md](DECISIONS.md).

## What it does

- **Board** — berths down, days across, one month at a time, **opening on today**. It runs
  three years forward and back far enough to cover whatever is on the schedule, so the 1997
  imports are reachable; you can review what was booked, but not book a date that has passed.
  A bar's **height is `vessel length ÷ berth length`**, so a vessel that does not fit visibly
  breaks out of its lane. Create, cancel and correct bookings — berth, dates, name, kind and
  a free-text note — for vessels, non-vessel events and berth closures alike.
- **Vessels** — the register as a queue, ordered by *bookings blocked* rather than
  alphabetically, so the highest-leverage gaps come first: ten to a page, its two halves on
  two buttons, a filter that searches all 418, and each row linking from its last booked year
  straight to that booking on the board. It fills and empties itself — booking a vessel adds
  it, cancelling its last booking takes it off, and the row is kept so a restore brings the
  hull back with whatever length was recorded on it.
- **Review** — problems with the schedule, and what to do about them. One row per job with
  its count and its verb, drawn at zero rather than deleted: what needs a decision, what has
  no length recorded, what has been cancelled and can be put back. Only the first reaches the
  nav badge; what the import found in bookings that have already ended sits below as history.
- **Find** — one box, searching every vessel name, event label and closure note across all
  23 years at once. Results group by identity, so a vessel with 267 bookings is one block
  and not 267 rows, and each result jumps straight to its own month on the board.
- **The legacy schedule is imported, and restorable.** 23 years of bookings are loaded so the
  conflict and size checks can be tried against real, messy data. Whatever a visitor cancels or
  edits, **Restore the original schedule** on Review brings the facility's own record back.
  **It can be undone**: it snapshots what it replaces in the same transaction that replaces it,
  and **Put back the previous schedule** returns that. Nothing empties the schedule — a 23-year
  record is not something a coordinator deletes, and the board's own opening month already
  shows that an empty schedule is supported.

## Importing the legacy workbook

`npm run import` parses all 23 year sheets and reconciles exactly:

```
2,212 source cells = 2,176 occupying a berth + 29 timing notes + 7 unreadable
2,176 occupying    → 2,031 stays   (145 merged into the stay before, 49 across a month end)
        7 berths · 418 vessels · 46 review items
   272 / 272 month blocks resolved
  373 entries on rows that name no berth — reported, never attributed
```

`npm run import:check` prints the same reconciliation without touching the database, so the
parse can be checked against any copy of the workbook before anything is written.

Only **20 of 418 vessels** have a length recorded anywhere in the source, which is the
evidence behind warning rather than blocking on fit. Among the bookings that *can* be
checked, **9 are physically impossible** — the worst a 170′ vessel in a 90′ berth.

The workbook itself is not in this repo — it is your material, and it was scrubbed from
history before the repository went public. **Place your copy at
`data/Dock Schedule - Synthetic Sample.xlsx` and `npm test` verifies the parse against it**,
with no database: the counts above, and each of the source defects below. Without the file
those 40 tests skip by name rather than failing.

Four source defects had to be handled:

- **The 2002, 2003 and 2004 sheets each open with the previous December.** The year comes
  from the header, and those bookings merge with the original December rather than
  duplicating it.
- **The 2010 sheet labels its last two months `NOVEMBER 2018` and `DECEMBER 2018`.** A stated
  year is trusted only when credible, so these stay in 2010 and the anomaly is reported.
- **Two rows on the 2010 sheet have vessel names typed over the day-number row.** Those 12
  cells belong to no berth, so they are review items with their sheet, row and column, not
  guesses.
- **373 entries sit on rows that name no berth at all** — a blank label, or the section
  header `North Finger Piers:` — across 17 of the 23 sheets. Attributing them to the berth
  above would invent the one thing the file does not say, so they are reported per sheet, in
  the queue and in the reconciliation, and none of them becomes a booking.

The reasoning behind each is in [ASSUMPTIONS.md](ASSUMPTIONS.md) → *Reading the workbook*;
the grid mechanics are in [docs/DATA-NOTES.md](docs/DATA-NOTES.md).

## Running it locally

```bash
npm install
echo 'DATABASE_URL="postgresql://..."' > .env.local   # Supabase transaction pooler, port 6543
npm run dev
```

```bash
npm test          # 352 unit tests, no database. Without data/*.xlsx, 312 run and 40 skip
npm run test:db   # 15 raw-SQL tests of the EXCLUDE constraint itself. Every case rolls back
npm run e2e       # 69 Playwright specs. Writes to the live database — see docs/OPERATIONS.md
npm run lint      # clean
npm run typecheck # clean
npm run import    # replace the schedule with the workbook (needs data/*.xlsx, gitignored)
npm run import:check # the same parse and reconciliation, printed, touching nothing
npm run put:back    # undo the last schedule replacement (operator only)
npm run sample:load # reset the live site to the sample, with no undo left pending
npm run db:check  # verify connection and that the constraint exists
```

Requires Node 24.

## Structure

```
src/domain/     PURE business rules. No database, no React. Unit tested.
src/lib/        pure view helpers: navigation, bar geometry, search, grouping, undo policy.
src/import/     workbook bytes → an import plan. Depends on domain, never on UI.
src/db/         SQL queries and mutations, typed at the boundary.
src/app/        Next.js routes and server actions. No business rules.
src/components/ every component, and every client boundary. No business rules.
```

`src/domain` and `src/lib` import nothing from `db` or `app`, so the conflict, fit, navigation
and search rules are tested without a database — the whole suite runs in well under a second
with no infrastructure at all. The importer and the UI call the same functions, so the rule
the board shows you is the rule the import applied.

The look is borrowed, not invented: the scale, the centred title and the one filled button
come from a site the project owner finds easy to use. Entries 19 and 24 of the build log,
linked from the foot of [DECISIONS.md](DECISIONS.md), record what was taken, what was
measured, and what was left.

## Stack

Next.js (App Router) · TypeScript · Postgres on Supabase · Vercel · Vitest · SheetJS.

**The schema is in [`supabase/migrations/`](supabase/migrations/)**, all thirteen in the
order they were applied. The constraint the whole design rests on is at
[line 114 of the first one](supabase/migrations/20260919004821_create_berth_scheduler_schema.sql#L114).

No ORM: the schema's single source of truth is SQL, because the `EXCLUDE` constraint at the
heart of this design cannot be expressed in any ORM schema DSL, and maintaining the schema
twice invites drift. No scheduler/Gantt library: every one of them assumes a booking fills
its lane, and none can draw a bar that **overhangs** its row.

## Operational notes

- **The Supabase free tier pauses a project after ~7 days of inactivity.** A scheduled ping
  keeps it awake. If the site ever errors after a long quiet period, opening the Supabase
  dashboard restores it.
- **The app is public and unauthenticated by design**, so a reviewer can exercise the
  conflict check without credentials. Nothing it offers is destructive for long: a cancelled
  booking is restored from Review, and **Restore the original schedule** keeps what it
  replaced, so **Put back the previous schedule** undoes it. No page can empty the schedule at
  all. The one exception, stated rather than implied: **editing** a booking overwrites its
  berth, dates, name, kind and note in place, and has no undo.

## The rest of the documentation

| File | What is in it |
|---|---|
| [DECISIONS.md](DECISIONS.md) | The fourteen choices worth arguing about, with the rejected options |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Where the brief was silent and a choice had to be made |
| [CLAUDE.md](CLAUDE.md) | The invariants: what must not be broken, and why |
| [docs/DESIGN.md](docs/DESIGN.md) | The presentation rules in full |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, keep-warm, database posture |
| [docs/DATA-NOTES.md](docs/DATA-NOTES.md) | Workbook quirks and the counts locked into tests |
