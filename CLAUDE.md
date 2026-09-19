# Dock Scheduling System

Berth reservations for a marine research facility, replacing a 23-year Excel workbook.
Live at https://berth-scheduler.vercel.app

**Read this file. Everything else is linked from here and only needed for its own area.**

| Doc | When you need it |
|---|---|
| [README.md](README.md) | Setup, what the app does, how to run it |
| [DECISIONS.md](DECISIONS.md) | Why something is the way it is — **read before changing a design choice** |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | How ambiguous source data was interpreted |
| [docs/DATA-NOTES.md](docs/DATA-NOTES.md) | Workbook quirks and verified counts — **only for `src/import/` work** |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, keep-warm, DB access posture — **read before deploying or touching the database** |
| [WALKTHROUGH.md](WALKTHROUGH.md) | Plain-language explanation for the project owner |

---

## The one idea to not break

The brief names two failures. **They are different shapes, and the whole design rests on
keeping them apart.**

- **Double-booking** is decidable — the dates are always known.
  → A Postgres `EXCLUDE` constraint makes it **unstorable**. Red in the UI. Blocks saving.
- **Vessel too long for its berth** is *not* decidable — only 20 of 418 vessels have a
  recorded length, so ~97% of bookings cannot be checked at all.
  → An advisory warning. Amber in the UI. **Never blocks.**

If you find yourself unifying these into one "validation" concept, stop. It forces either
blocking on unknowns (the tool becomes unusable) or softening the overlap guarantee (the
strongest claim in the project is lost).

## Invariants

Breaking any of these looks like an improvement and is not:

1. **`src/domain` imports nothing from `db` or `app`.** It is pure and unit-tested
   without infrastructure. The importer and the UI call the same functions.
2. **Never invent a vessel length**, and never gate a booking on picking a known vessel.
   Booking registers the vessel with a null length; that is how the register fills from
   an empty start. Gating on "pick an existing vessel" once made bookings impossible.
3. **Nothing vanishes silently.** Whatever the importer cannot place becomes a review
   item carrying its sheet/row/column — never a dropped row or a log line. Missing
   lengths are the one exception: **derived, not stored** (one row per vessel was 93% of
   the queue and went stale). The Vessels tab is where that work happens.
4. **`Small craft slips` is pooled** (many boats at once) and exempt from conflict
   detection. Every other berth is exclusive.
5. **Imported rows that violate the constraint load as `conflict_unresolved`**, which the
   constraint excludes via `WHERE status = 'active'`. History stays true; new bookings
   still cannot overlap.
6. **Bar height is `vessel length ÷ berth length`.** The misfit is geometry, not a badge.
   A violation states its measurement at *any* width — six of the nine violations are
   single-day.
7. **The sample workbook is NOT loaded by default.** The app ships with an empty
   schedule and seven berths — the sample is a demonstration, not this facility's
   history. It loads and clears from Review, reversibly, via the `*_seed` tables. An
   empty schedule is the normal case, not a degraded one, and must stay fully usable.
8. **The board opens on today and runs three years ahead.** The sample ending in 2019 is
   a fact about the sample, **never a bound on the app** — pinning the range to it once
   made future bookings saveable but unreachable. An empty month still renders the full
   grid. The navigation ceiling and the form's `max` both come from `lib/nav`; **never
   hard-code a second one**.
9. **No in-app page explaining the project.** Three tabs: Board, Vessels, Review — a
   coordinator's tool, not a portfolio piece. Rationale belongs in `DECISIONS.md`.
   `/search` is a destination reached from the masthead, **not a fourth tab**: do not add
   it to the nav, and do not delete it for breaking the three-tab rule.

## Structure

```
src/domain/   pure rules: conflicts, fit, classification. No DB, no React.
src/lib/      pure view helpers: month nav, bar geometry, search grouping.
src/import/   spreadsheet → domain objects. Depends on domain, never on UI.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

No ORM — the `EXCLUDE` constraint cannot be expressed in one, and a second schema would
drift. No scheduler library — none can draw a bar that overhangs its lane.

## Commands

```bash
npm run dev       # local dev server
npm test          # 214 unit tests, no database needed
npm run e2e       # 34 Playwright specs; loads the sample, then clears it again
npm run import    # reload the workbook into the database
npm run db:check  # verify the connection and that the constraint exists
npm run build     # production build
```

Node 24. `DATABASE_URL` in `.env.local` — see [docs/OPERATIONS.md](docs/OPERATIONS.md).

**Do not run `npm run build` while `npm run dev` is running** — they contend over
`.next` and both hang.

## Gotchas that cost time before

- `bookings.during` is a **generated** column. `insert ... select *` into `bookings`
  fails; list columns explicitly.
- `todayISO()` resolves in `America/New_York`, not the server's UTC. Using UTC rolls the
  board to the next month at 8pm on the last day of a month.
- **Pushing to `main` does not deploy**, and the connection pool has a sizing trap that
  deadlocks renders. Both live in [docs/OPERATIONS.md](docs/OPERATIONS.md).

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
