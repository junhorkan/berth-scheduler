# Dock Scheduling System

Berth reservations for a marine research facility.
Live at https://berth-scheduler.vercel.app

**Read this file. Everything else is linked from here and only needed for its own area.**

| Doc | When you need it |
|---|---|
| [README.md](README.md) | Setup, what the app does, how to run it |
| [DECISIONS.md](DECISIONS.md) | Why something is the way it is — **read before changing a design choice** |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | What was assumed where the brief was silent |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, keep-warm, DB access posture — **read before deploying or touching the database** |
| [docs/DESIGN.md](docs/DESIGN.md) | The presentation invariants in full — **read before changing anything visual** |
| [docs/DATA-NOTES.md](docs/DATA-NOTES.md) | Workbook quirks and verified counts — **only for `src/import/` work** |
| [WALKTHROUGH.md](WALKTHROUGH.md) | Plain-language explanation for the project owner |

---

## The one idea to not break

The brief names two failures. **They are different shapes and the design rests on
keeping them apart.**

- **Double-booking** is decidable — the dates are always known. A Postgres `EXCLUDE`
  constraint makes it **unstorable**. Red in the UI. Blocks saving.
- **Vessel too long for its berth** is *not* — a length is known only once somebody
  records it, and most never will. Advisory. Amber in the UI. **Never blocks.**

Unifying them into one "validation" forces either blocking on unknowns (the tool becomes
unusable) or softening the overlap guarantee (the strongest claim here).

## Invariants

Breaking any of these looks like an improvement and is not. Each line is the whole rule;
the arrow leads to the reasoning and, for the visual ones, to the detail that makes it
obeyable.

1. **`src/domain` and `src/lib` import nothing from `db` or `app`.** Pure, and unit-tested
   without infrastructure.
2. **Never invent a vessel length, and never gate a booking on picking a known vessel.**
   Booking registers the vessel. The berth suggester **proposes and explains, never
   assigns**. → [DECISIONS 22](DECISIONS.md#22-the-system-suggests-a-berth-it-never-assigns-one)
3. **Nothing vanishes silently, but repetition is not information.** What the importer
   cannot place becomes a review item carrying its sheet/row/column; missing lengths are
   derived, not stored; identical problems fold with a count (`lib/review.ts`), and
   conflicts never fold. **A queue holds work**: an item whose booking has ended moves to
   the archive card and leaves the badge, and nothing is ever deleted to get it there.
   → [DECISIONS 17, 23 and 26](DECISIONS.md#17-repetition-is-not-information)
4. **`Small craft slips` is pooled** and exempt from conflict detection. Every other berth
   is exclusive.
5. **The berths live in a migration**, not in application code. They are the facility.
6. **Bar height is `vessel length ÷ berth length`**, stated in words at any width, with an
   instant `data-tip` and never the native `title`.
   → [DESIGN](docs/DESIGN.md#6-bar-height-is-the-fit-check)
7. **Every date bound comes from `lib/nav`; none is hard-coded.** The floor stretches to
   the earliest booking; the form refuses a start before today, in the save path as well,
   since `min` only guards the picker. A fixed bound has hidden real bookings three times.
8. **Empty is supported, and never silent.** The full grid still draws, and one line says
   where the bookings are. Every booking in the sample is before 2020, so the front door
   is one of those months, and **no booking is ever invented to fill it** — that was tried
   and removed. → [DESIGN](docs/DESIGN.md#8-empty-is-supported-and-never-silent) ·
   [DECISIONS 29](DECISIONS.md#29-nothing-on-the-board-is-invented)
9. **Explain the tool, never the project.** Three tabs; no About page; `/search` is a
   destination, **not a fourth tab**. Each page's masthead is its own name and one line;
   orientation only on the empty board.
   → [DESIGN](docs/DESIGN.md#9-explain-the-tool-never-the-project)
10. **Light only; one filled button per page; no control that only confirms another.**
    → [DESIGN](docs/DESIGN.md#10-light-only-and-one-obvious-action)
11. **Nothing outside the grid below 13px.** When something will not fit, change its shape,
    not its point size. → [DESIGN](docs/DESIGN.md#11-nothing-outside-the-grid-below-13px)
12. **Nothing destructive is irreversible.** No accounts, so reversibility is the answer
    rather than a gate. Cancelling is a soft delete restored from Review, and restoring
    re-runs the constraint, so it can be refused. **Clear and Load** each snapshot into the
    `*_undo` tables inside the transaction that replaces the schedule, so the replacement
    and its undo cannot come apart. **An upload is never a write path** — see 29.
    → [DECISIONS 20, 28 and 29](DECISIONS.md#20-cancelling-is-reversible-not-restricted)
13. **Never use WHOI's name or marks.** A real institution, a public site, synthetic data.
    → [DECISIONS 21](DECISIONS.md#21-the-facility-is-not-whoi)

## Structure

```
src/domain/   pure rules: conflicts, fit, classification. No DB, no React.
src/lib/      pure view helpers: nav, bar geometry, search, grouping, berth suggestion.
supabase/     every migration in order. The EXCLUDE constraint is in the first one.
src/import/   spreadsheet → domain objects. Depends on domain, never on UI.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

No ORM: `EXCLUDE` cannot be expressed in one and a second schema would drift. No
scheduler library: none can draw a bar that overhangs its lane.

## Commands

```bash
npm run dev         # local dev server
npm test            # 223 without the workbook (30 skip by name); 253 with it in data/
npm run e2e         # 50 specs. HITS THE LIVE DB: swaps in a fixture, restores after
npm run import      # reload the workbook (needs data/*.xlsx, gitignored)
npm run sample:load # reset the live site to the sample, leaving no undo pending
npm run db:check    # verify the connection and that the constraint exists
npm run build       # production build
```

Node 24. `DATABASE_URL` in `.env.local` — see [docs/OPERATIONS.md](docs/OPERATIONS.md).
**Never `npm run build` while `npm run dev` runs** — they contend over `.next` and hang.

## Gotchas that cost time before

- **Every URL parameter is data from outside; check it before it reaches SQL.** `y` and
  `m` go through `clampMonth`, and `sel` goes through `isBookingId` — without that guard
  a non-uuid reached `where b.id = $1` and the board answered **500**, live.
- **A test that reads `data/` must skip without it.** The workbook is gitignored and was
  scrubbed from history, so on a fresh clone it does not exist. Two test files once parsed
  it inside `describe()` and crashed collection, so `npm test` was red for anyone who
  cloned the public repo. Use `describe.skipIf(!existsSync(WORKBOOK))`, and remember the
  skipped block's body still runs: give it an empty array, not nothing.
- **Never rename or drop something the deployed build reads, in the same step as the code
  that stops reading it.** Migrations apply to the live database at once; the code takes a
  deploy. Add a compatibility view, ship, then remove it.
- `bookings.during` is a **generated** column. `insert ... select *` into `bookings`
  fails; list columns explicitly.
- **Resolve every date in `America/New_York`, never the server's UTC**, the way
  `todayISO()` does. After 8pm Eastern the UTC date has already rolled over, so the board
  jumps a month early, and `Date.now() - 86_400_000` in a spec is the facility's *today* —
  which makes the spec silently stop testing anything.
- **Server Actions inherit their route's `maxDuration`.** The 10s default killed the ~12s
  workbook restore mid-transaction, and the button discarded its `{ok, error}`, so it
  failed in total silence. Never throw a mutation's result away.
- Deployments that come back `BLOCKED`, the pool-sizing trap, the keep-warm ping, and why
  `git ls-files data` must print nothing: [docs/OPERATIONS.md](docs/OPERATIONS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
