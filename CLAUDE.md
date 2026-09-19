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

Breaking any of these looks like an improvement and is not. Full argument for each:
[DECISIONS.md](DECISIONS.md).

1. **`src/domain` and `src/lib` import nothing from `db` or `app`.** Pure, and unit-tested
   without infrastructure.
2. **Never invent a vessel length, and never gate a booking on picking a known vessel.**
   Booking registers the vessel; a gate once made vessel bookings impossible entirely.
   The berth suggester **proposes and explains, never assigns**: with no length it ranks
   on availability and says the fit was not checked.
3. **Nothing vanishes silently, but repetition is not information.** Whatever the
   importer cannot place becomes a review item with its sheet/row/column. Missing
   lengths are derived, not stored. Identical problems fold into one row with a count
   (`lib/review.ts`); conflicts never fold.
4. **`Small craft slips` is pooled** and exempt from conflict detection. Every other berth
   is exclusive.
5. **The berths live in a migration**, not in application code. They are the facility.
6. **Bar height is `vessel length ÷ berth length`**, stated at any width including a
   single day. Say it in words — `170ft in 90ft berth`, never `170′ > 90′`. Every bar
   carries a plain-language `data-tip` shown instantly; **never the native `title`**,
   which took a second and left the board looking unexplained. Tip and badge hang off
   the side the bar sits on, or the card clips the one thing that must not be clipped.
7. **Every date bound comes from `lib/nav`; none is hard-coded.** The floor stretches to
   the earliest booking so imported history stays reachable; the form refuses a start
   before today, in the save path as well, since `min` only guards the picker. A fixed
   bound has hidden real bookings three times.
8. **Empty is a supported state, not a degraded one — and never a silent one.** An
   empty month still draws the full grid, and says in one line where the bookings
   actually are: a blank grid cannot be told apart from a broken page. Building the
   empty path is what exposed the two bugs in invariant 2.
9. **Explain the tool, never the project.** Three tabs: Board, Vessels, Review — no
   About page, no architecture in the product. Orientation is allowed in one place, the
   empty board, because every other explanation hangs off something on screen and none
   render there; it must vanish once a bar exists. Facts stay visible, rules collapse
   behind a summary that **names them** — never `Info`, which gives nobody a reason to
   open it. `/search` is a destination, **not a fourth tab**.
10. **Light only, and one obvious action.** Do not reinstate a dark theme — the mark hues
    are validated against the light surface, and the custom 404 exists because Next's
    default carries its own. `+ New booking` is the only filled button, and **no control
    may exist only to confirm another**.
11. **Body text outside the grid never drops below 13px** (uppercase micro-labels may be
    11). When something will not fit, change its shape, not its point size — shrinking
    is how a readable page becomes an unreadable one, one commit at a time.
12. **Nothing destructive is irreversible.** There are no accounts, and reversibility is
    the answer to that rather than a gate. Cancelling is a soft delete restored from
    Review; restoring re-runs the constraint, so it can be refused, and must be.
    **Never use WHOI's name or marks** — the data is synthetic and the site is public.

## Structure

```
src/domain/   pure rules: conflicts, fit, classification. No DB, no React.
src/lib/      pure view helpers: nav, bar geometry, search, grouping, berth suggestion.
src/import/   spreadsheet → domain objects. Depends on domain, never on UI.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

No ORM — the `EXCLUDE` constraint cannot be expressed in one, and a second schema would
drift. No scheduler library — none can draw a bar that overhangs its lane.

## Commands

```bash
npm run dev       # local dev server
npm test          # 246 unit tests, no database needed
npm run e2e       # 44 specs. HITS THE LIVE DB: swaps in a fixture, restores after
npm run import    # reload the workbook (needs data/*.xlsx, gitignored)
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
  recognise** — check `git config user.email` first if a deployment comes back `BLOCKED`.
  That and the connection-pool sizing trap are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
