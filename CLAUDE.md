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

Breaking any of these looks like an improvement and is not:

1. **`src/domain` and `src/lib` import nothing from `db` or `app`.** They are pure and
   unit-tested without infrastructure.
2. **Never invent a vessel length**, and never gate a booking on picking a known vessel.
   Booking registers the vessel with a null length; that is how the register fills. A
   gate requiring an existing vessel once made vessel bookings impossible entirely.
3. **Unknown is a first-class answer.** A vessel with no recorded length is drawn hatched
   and says so; it is never assumed to fit. Missing lengths are **derived, not queued** —
   one review row per vessel was 93% of the queue and its count went stale.
4. **`Small craft slips` is pooled** (many boats at once) and exempt from conflict
   detection. Every other berth is exclusive.
5. **The berths are defined in a migration**, not created by application code. They are
   the facility; without them there is nothing to book into.
6. **Bar height is `vessel length ÷ berth length`.** The misfit is geometry, not a badge.
   A violation states its measurement at *any* width, including a single day.
7. **The board opens on today**, with every bound computed per request so the window
   slides with the calendar. **Booking and viewing are deliberately different**: the form
   refuses a start date before today, while the board still reaches a year back, or a
   booking made last month becomes unreachable when the year turns. All of it comes from
   `lib/nav`; **never hard-code a second bound** — that is how the form once accepted
   dates the board could not reach, making saved bookings invisible. A date input's `min`
   constrains only the picker, so the save path checks it too.
8. **An empty schedule is the normal case, not a degraded one.** It ships empty. An empty
   month still renders the full grid; replacing it with a line of text made "empty" read
   as "broken".
9. **No in-app page explaining the project.** Three tabs: Board, Vessels, Review — a
   coordinator's tool, not a portfolio piece. Rationale belongs in `DECISIONS.md`.
   `/search` is a destination reached from the masthead, **not a fourth tab**: do not add
   it to the nav, and do not delete it for breaking the three-tab rule.

## Structure

```
src/domain/   pure rules: conflicts, fit, vessel identity. No DB, no React.
src/lib/      pure view helpers: month nav, bar geometry, search grouping.
src/db/       SQL queries and mutations, typed at the boundary.
src/app/      Next.js routes and components. No business rules.
```

No ORM — the `EXCLUDE` constraint cannot be expressed in one, and a second schema would
drift. No scheduler library — none can draw a bar that overhangs its lane.

## Commands

```bash
npm run dev       # local dev server
npm test          # 111 unit tests, no database needed
npm run e2e       # 33 Playwright specs; builds its own fixture, then clears it
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
