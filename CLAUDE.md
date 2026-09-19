# Dock Scheduling System

Berth reservation management for a marine research facility.

**Deliverable: a live public URL only.** Submitted via Google Form, due Sun 2026-09-20 23:59.
No repository is handed over. Target URL: `berth-scheduler.vercel.app`.

Full plan: `~/.claude/plans/users-junhorkan-downloads-drive-downloa-spicy-moler.md`

## What this is, and what it is not

This is a **working tool for a dock coordinator.** It is not a portfolio piece that explains
itself. There is **no Notes/About page**, no in-app design essay, and no importer log presented as
a technical report. All rationale lives in repo files (`DECISIONS.md`, `ASSUMPTIONS.md`,
`WALKTHROUGH.md`) which reviewers will not see unless they ask.

If you are tempted to add a page that argues for the design, don't. Add it to `DECISIONS.md`.

## The problem, precisely

Two failures motivate this, and they are **different shapes**. Keep them separate in code:

1. **Double-booking** — two things on one berth at once. Prevented today by a human scanning a
   grid. → Make **structurally impossible** (Postgres `EXCLUDE` constraint).
2. **Vessel/berth size mismatch** — a vessel longer than the berth it's assigned to. **Not
   checked at all today**, because 97.5% of bookings reference a vessel with no recorded length.
   → **Cannot** be made impossible. Make it **visible**, and make the missing data collectable
   as a side effect of normal work (advisory warning, never a block).

This hard/soft asymmetry is the core design argument. Do not collapse it into one "validation"
concept. Red blocks; amber advises. Never the reverse.

## Confirmed decisions (do not relitigate)

| Decision | Value |
|---|---|
| Unknown vessel length | Warn, never block. Badge + review item. |
| History scope | Import all 23 years. |
| Auth | None. Public read **and** write. |
| Historical rows violating the constraint | Load as `status='conflict_unresolved'`; constraint is `WHERE status='active'`. |
| Conflict override | **None.** A conflict is always refused. |
| Board time window | One month at a time. `→` marker on clipped month-crossing stays. |
| Interaction | Form only. Drag-to-create/move deferred. |
| Landing view | **July 2010** (29 bookings; only dense month with all 4 bar states). |
| Branding | "Harborview Marine Research Center" — **not** WHOI. |
| Data safety | Writes allowed + visible `↺ Reset to imported state`. |
| Navigation | **Three tabs: Board · Vessels · Review.** |
| Deploy timing | Skeleton to prod at step 2; iterate on the same URL. |
| Runtime | Node 24.21.0, user-space at `~/.local/node`, symlinked into `~/.local/bin`. |

## Source data facts (verified against `data/`)

Sample workbook: `data/Dock Schedule - Synthetic Sample.xlsx` — 28 sheets.

- 23 year grids, 1997–2019 (**1997 starts in August**), plus `8YR Dock Summary`, `Science`,
  `Yachts`, `Tours`.
- Grid: month header in col A, a weekday-letter strip, a day-number strip, then one row per
  berth. **A booking is a merged cell range**; the merge *is* the span.
- **Day columns are a CALENDAR, not a fixed offset.** Day 1 sits under its real weekday, so it
  begins at a different column every month (Aug 1997 → col 1, Jan 2010 → col 4, Jan 2017 →
  col 2). Assuming a fixed "day 1 = column C" misdates the entire file silently. The importer
  infers the offset from every available anchor and then verifies it against the real calendar.
- **Two grid families:** 1997–2001 map columns straight onto days and print only a lone `1` on
  the day-number row; 2002+ use the true calendar offset.
- **The 2002, 2003 and 2004 sheets each OPEN with the previous December** carried over
  (`DECEMBER 2001` at the top of the 2002 sheet). The year must come from the header, not the
  sheet name — but their bookings merge with the original December rather than duplicating.
- **The 2010 sheet labels its last two blocks `NOVEMBER 2018` / `DECEMBER 2018`** — a typo.
  The 2018 sheet already owns those months. A stated year is trusted only when credible:
  same year, or the previous December. Otherwise the sheet name wins and it is reported.
- **Verified counts (from the real file, locked into tests):**
  - 272/272 month blocks resolved (22 full years + Aug–Dec 1997 + 3 carry-overs)
  - 2,212 raw cells → **2,031 stays**; 145 cells merged, **49 across a month boundary**
  - by kind: 2,119 vessel · 38 event · 19 closure · 29 annotation · 7 unclassified
  - **418 distinct vessels**, 7 berths
  - 4 blocks could not be calendar-verified; 12 cells orphaned on damaged grid rows
- **Four entry kinds share one cell space.** Classify, don't assume:
  - vessel — `R/V Long Ketch`, `OSV AMBER REEF`
  - non-vessel event **that occupies a berth** — `Community sail day`, `Student tour`
  - berth closure — `Dock maintenance - restricted access`, `Float rebuild - no usage permitted`
  - annotation **occupying nothing** — `ETA 1200`, `Departs 0600`, bare `1400`
  - anything else → `unclassified`, which becomes a Review item rather than a guess
- Name variants are one vessel: `Barge SALT DORY` / `Barge Salt Dory`; `OSV` / `OS/V`.
- Registry sheets are **self-inconsistent**: some vessels state a length in the name AND a
  different `LOA:` in the notes. Store both; never silently reconcile.
- Duplicate berth rows within one month (`South Float East - 90'` at rows 49 **and** 52 in
  April 2017) are the **manual workaround for a double-booking**. Evidence, not noise.
- **Only 19 of 418 grid vessels have a known length.** Seed exactly those 19 — never invent a
  length to make the board look better.
- Length data is extremely concentrated: entering **10** lengths makes ~52% of bookings
  verifiable. Hence the Vessels tab sorts by booking count among unknown-length vessels.

## Non-obvious modeling rules

- `North Finger Piers:` is a **section label, not a bookable berth**.
- `Small craft slips (institution boats)` is **pooled** — several boats at once. Must be exempt
  from the exclusion constraint or it throws false conflicts forever.
- `Marsh Landing` appears in `8YR Dock Summary` but never in a grid.
- Bookings are **whole-day, inclusive** both ends; stored as half-open `daterange [start, end+1)`
  so a Mon–Wed and a Wed–Fri stay conflict on Wednesday.
- **Draft/depth is not checkable.** `Yachts` records `Draft: 12'` but no berth has a recorded
  depth anywhere in the file. Document the gap; never invent depths.
- `Tours` sheet is already a separate system by its own admission. Out of scope.

## Architecture rule (non-negotiable)

```
src/domain/     PURE. No DB, no React. Unit tested.
                conflicts.ts · fit.ts · normalize.ts
src/import/     spreadsheet -> domain objects. Depends on domain, never on UI.
src/db/         Drizzle schema + queries only.
src/app/        Next.js routes/components. NO business rules.
```

**`src/domain` imports nothing from `db` or `app`.** Conflict and fit logic must be provably
correct without a database.

## Stack

Next.js (App Router) + TypeScript · Postgres on Supabase · Drizzle · Vercel · Playwright ·
SheetJS for import (needs merged-range support via `!merges`).

Timeline is **hand-rolled in CSS Grid**. Every scheduler library assumes a booking fills its lane;
none can draw a bar that **overhangs** its row, which is the most important thing the view does.
Bar geometry: `height = (vessel_length / berth_length) × lane_height`, so overflow is a
consequence of the math, not a special case.

Four bar states only: solid (fit confirmed) · hatched (length unknown) · red + broken lane (too
long) · amber (non-vessel event). Closures get a struck-through lane, not a bar.

Load the `dataviz` skill before writing any chart/board colors.

## Conventions

- Never silently drop an imported row. Unclassifiable entries become **Review items**, not log lines.
- Preserve provenance: every imported booking keeps its year/sheet/row/col.
- Prefer stating an assumption in `ASSUMPTIONS.md` over guessing quietly in code.
- Supabase free tier pauses after ~7 days idle — a keep-warm ping is scheduled; note it in README.

## Commands

```bash
npm run dev            # local dev server
npm test               # domain unit tests (vitest)
npm run import         # load the workbook into the DB
npx playwright test    # E2E
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
