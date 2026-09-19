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

The brief names two failures. **They are different shapes, and the whole design rests on
keeping them apart.**

- **Double-booking** is decidable — the dates are always known.
  → A Postgres `EXCLUDE` constraint makes it **unstorable**. Red in the UI. Blocks saving.
- **Vessel too long for its berth** is *not* decidable — a vessel's length is only known
  once somebody records it, and most never will.
  → An advisory warning. Amber in the UI. **Never blocks.**

If you find yourself unifying these into one "validation" concept, stop. It forces either
blocking on unknowns (the tool becomes unusable) or softening the overlap guarantee (the
strongest claim in the project is lost).

## Invariants

Breaking any of these looks like an improvement and is not. The full argument for each is
in [DECISIONS.md](DECISIONS.md); this is the short form.

1. **`src/domain` and `src/lib` import nothing from `db` or `app`.** Pure, and unit-tested
   without infrastructure.
2. **Never invent a vessel length, and never gate a booking on picking a known vessel.**
   Booking registers the vessel; a gate once made vessel bookings impossible entirely.
3. **Nothing vanishes silently, but repetition is not information.** What the importer
   cannot place becomes a review item with its sheet/row/column. Missing lengths are
   derived, not stored. Identical problems **fold into one row with a count**
   (`lib/review.ts`) — one vessel too long for one berth across four bookings is one
   decision, and listing it four times buried everything else. Conflicts never fold.
4. **`Small craft slips` is pooled** and exempt from conflict detection. Every other berth
   is exclusive.
5. **The berths live in a migration**, not in application code. They are the facility.
6. **Bar height is `vessel length ÷ berth length`.** The misfit is geometry, not a badge,
   and it states its measurement at any width including a single day. Say it in words —
   `170ft in 90ft berth`, never `170′ > 90′`. Every bar carries a plain-language
   `data-tip` shown instantly on hover; **do not go back to the native `title`**, which
   took a second to appear and left the board looking unexplained.
7. **Every date bound comes from `lib/nav`, and none is hard-coded.** The floor stretches
   to the earliest booking so imported history stays reachable; the form refuses a start
   date before today. A fixed bound has hidden real bookings three times. A date input's
   `min` guards only the picker, so the save path checks too.
8. **An empty schedule is a supported state, not a degraded one.** It still renders the
   full grid. Building it is what exposed the two bugs in invariant 2.
9. **No in-app page explaining the project.** Three tabs: Board, Vessels, Review.
   `/search` is a destination, **not a fourth tab** — do not add it to the nav, and do not
   delete it for breaking the rule.
10. **Light only, and one obvious action.** Do not reinstate a dark theme: the mark hues
    are validated against the light surface, and the custom 404 exists because Next's
    default carries its own dark rule. `+ New booking` is the only filled button, and
    **no control may exist only to confirm another**.

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
npm test          # 228 unit tests, no database needed
npm run e2e       # 38 Playwright specs; builds a fixture, then restores the sample
npm run import    # reload the workbook (needs data/*.xlsx, gitignored)
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
- Pushing to `main` deploys, **but Vercel blocks a build whose commit author it does not
  recognise** — check `git config user.email` first if a deployment comes back `BLOCKED`.
  That and the connection-pool sizing trap are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
