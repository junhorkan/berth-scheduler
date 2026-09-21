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

Breaking any of these looks like an improvement and is not. Why, for each:
[DECISIONS.md](DECISIONS.md). **6 and 8–11 are stated in full in
[docs/DESIGN.md](docs/DESIGN.md)** — the line here is the whole rule, not a summary of
one, but the detail that makes it obeyable is there.

1. **`src/domain` and `src/lib` import nothing from `db` or `app`.** Pure, and unit-tested
   without infrastructure.
2. **Never invent a vessel length, and never gate a booking on picking a known vessel.**
   Booking registers the vessel; a gate once made vessel bookings impossible entirely.
   The berth suggester **proposes and explains, never assigns**: with no length it ranks
   on availability and says the fit was not checked.
3. **Nothing vanishes silently, but repetition is not information.** What the importer
   cannot place becomes a review item with its sheet/row/column; missing lengths are
   derived, not stored; identical problems fold with a count (`lib/review.ts`) and
   conflicts never fold.
4. **`Small craft slips` is pooled** and exempt from conflict detection. Every other berth
   is exclusive.
5. **The berths live in a migration**, not in application code. They are the facility.
6. **Bar height is `vessel length ÷ berth length`**, stated in words at any width, with
   an instant `data-tip` and never the native `title`. → [DESIGN](docs/DESIGN.md#6-bar-height-is-the-fit-check)
7. **Every date bound comes from `lib/nav`; none is hard-coded.** The floor stretches to
   the earliest booking so imported history stays reachable; the form refuses a start
   before today, in the save path as well, since `min` only guards the picker. A fixed
   bound has hidden real bookings three times.
8. **Empty is supported, and never silent.** The full grid still draws, and one line
   says where the bookings are. The sample reaches into the coming weeks precisely so
   the front door is not empty; `lib/sample` is unit-tested against the overlap rule,
   because an overlap there refuses the whole reload.
   → [DESIGN](docs/DESIGN.md#8-empty-is-supported-and-never-silent)
9. **Explain the tool, never the project.** Three tabs; no About page; `/search` is a
   destination, **not a fourth tab**. Each page's masthead is its own name and one line;
   orientation only on the empty board.
   → [DESIGN](docs/DESIGN.md#9-explain-the-tool-never-the-project)
10. **Light only; one filled button per page; no control that only confirms another.**
    → [DESIGN](docs/DESIGN.md#10-light-only-and-one-obvious-action)
11. **Nothing outside the grid below 13px.** When something will not fit, change its
    shape, not its point size. → [DESIGN](docs/DESIGN.md#11-nothing-outside-the-grid-below-13px)
12. **Nothing destructive is irreversible, except the one thing that says so.** No
    accounts, so reversibility is the answer rather than a gate: cancelling is a soft
    delete restored from Review, and restoring re-runs the constraint, so it can be
    refused. **Clear the schedule** is the exception: a hard delete, and its dialog says
    that bookings made here are not recoverable. **Never use WHOI's name or marks** —
    synthetic data, public site.

## Structure

```
src/domain/   pure rules: conflicts, fit, classification. No DB, no React.
src/lib/      pure view helpers: nav, bar geometry, search, grouping, berth suggestion,
              and the sample's forward bookings.
src/import/   spreadsheet → domain objects. Depends on domain, never on UI.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

No ORM: `EXCLUDE` cannot be expressed in one and a second schema would drift. No
scheduler library: none can draw a bar that overhangs its lane.

## Commands

```bash
npm run dev       # local dev server
npm test          # 252 unit tests, no database needed
npm run e2e       # 48 specs. HITS THE LIVE DB: swaps in a fixture, restores after
npm run import    # reload the workbook (needs data/*.xlsx, gitignored)
npm run sample:load # the Load button, from the terminal: seed snapshot + forward bookings
npm run db:check  # verify the connection and that the constraint exists
npm run build     # production build
```

Node 24. `DATABASE_URL` in `.env.local` — see [docs/OPERATIONS.md](docs/OPERATIONS.md).
**Never `npm run build` while `npm run dev` runs** — they contend over `.next` and hang.

## Gotchas that cost time before

- `bookings.during` is a **generated** column. `insert ... select *` into `bookings`
  fails; list columns explicitly.
- `todayISO()` resolves in `America/New_York`, not the server's UTC. Using UTC rolls the
  board to the next month at 8pm on the last day of a month.
- Pushing to `main` deploys, **but Vercel blocks a build whose commit author it does not
  recognise** — check `git config user.email` if a deployment comes back `BLOCKED`.
- **Server Actions inherit their route's `maxDuration`**; the 10s default killed the
  ~12s workbook restore mid-transaction, and the button discarded its `{ok, error}`, so
  it failed in total silence. Never throw a mutation's result away.
- **Compute test dates in `America/New_York`, not UTC.** `Date.now() - 86_400_000` is the
  facility's *today* after 8pm Eastern, so a spec silently stops testing anything.
- **An ignore rule never untracks a file already committed.** The sample workbook sat in
  the repo for 16 commits after `data/*.xlsx` was ignored; history was rewritten on
  2026-09-19 to remove it. `git ls-files data` must print nothing.
- The pool-sizing trap and the keep-warm ping: [docs/OPERATIONS.md](docs/OPERATIONS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
