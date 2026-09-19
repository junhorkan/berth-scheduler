# Harborview Dock Schedule

Berth reservation management for a marine research facility.

**Live:** https://berth-scheduler.vercel.app

Replaces a 28-sheet Excel workbook holding 23 years of bookings (1997–2019), in which
double-bookings were caught by eye and vessel/berth size was not checked at all.

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

**2. Vessel too long for its berth.** Not checked today — and, it turns out, *not
checkable*: of 418 vessels in the schedule, only **20** have a recorded length anywhere
in the source. **97% of bookings cannot be verified**, and among the 54 that can, **9 are
physically impossible** (the worst a 170′ vessel in a 90′ berth).
→ Cannot be made impossible. Made **visible**, with the missing data collectable as a
side effect of normal work. The check warns and never blocks, because blocking on data
that mostly does not exist would make the tool unusable.

That asymmetry — a hard database constraint for one, an advisory warning for the other —
is the central design decision. See `DECISIONS.md`.

## What it does

- **Board** — berths down, days across, one month at a time, **opening on today and
  navigable three years ahead**. A bar's **height is `vessel length ÷ berth length`**, so
  a vessel that does not fit visibly breaks out of its lane. Create, cancel and reassign
  bookings, for vessels, non-vessel events and berth closures alike. The imported sample
  covers 1997–2019; the schedule itself runs forward from today.
- **Vessels** — the registry, ordered by *bookings blocked* rather than alphabetically.
  Recording just ten lengths makes ~51% of the schedule verifiable; the page says so.
- **Review** — the coordinator's queue: unresolved conflicts, size violations, missing
  lengths, and cells the importer would not guess at. Every row traces back to its
  original spreadsheet cell.
- **Find** — one box, searching every vessel name, event label and closure note across
  all 276 months at once. Results group by identity, so a vessel with 267 bookings is one
  block and not 267 rows, and each result jumps straight to its own month on the board.

## Importing the legacy workbook

`npm run import` parses all 23 sheets and reconciles exactly:

```
2,212 source cells → 2,031 stays     (145 cells merged, 49 across a month boundary)
        7 berths · 418 vessels · 427 review items
   272 / 272 month blocks resolved
```

Three source defects had to be handled, each documented in `ASSUMPTIONS.md`:

- **Day columns are a calendar, not a fixed offset.** Day 1 sits under its real weekday,
  so it begins at a different column every month. Assuming a constant offset silently
  misdates the entire file.
- **The 2002, 2003 and 2004 sheets each open with the previous December**, so the year
  must come from the header text, not the sheet name.
- **The 2010 sheet labels two blocks `NOVEMBER 2018` / `DECEMBER 2018`** — a typo, since
  the 2018 sheet already owns those months.

Nothing is dropped. Annotations, unclassifiable cells and 12 cells orphaned on damaged
rows are all counted and surfaced.

## Running it locally

```bash
npm install
echo 'DATABASE_URL="postgresql://..."' > .env.local   # Supabase transaction pooler, port 6543
npm run dev
```

```bash
npm test          # 186 unit tests, no database required
npm run import    # load the workbook into the database
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

`src/domain` imports nothing from `db` or `app`, so the conflict and fit rules are
provably correct without a database. The importer and the UI call the same functions, so
the rule the board shows you is the rule the import applied.

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
  conflict check without credentials. `↺ Reset to imported state` on the Review tab
  restores all 2,031 imported bookings, so experimenting is safe.
