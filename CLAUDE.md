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
- Grid: month header in col A → day numbers (cols C–AG) → day-of-week row → one row per berth.
  **A booking is a merged cell range**; the merge *is* the date span.
- **Layout drifts** — do not assume one parser fits all years:
  - 1997–2005: starts row 1, header `AUGUST 1997`
  - 2006–2016: 3-row title block, header `JANUARY 2006`
  - 2017+: bare `January`
- 2,061 raw cell entries → **~1,977 real stays** (62 runs of adjacent same-name cells are one
  stay each, typed day-by-day instead of merged).
- **277 entries end on day ≥28** — stays crossing a month boundary appear as two cells. Stitch
  them or the data is subtly wrong.
- **Four entry kinds share one cell space.** Classify, don't assume:
  - vessel — `R/V Long Ketch` (312), `OSV AMBER REEF` (109)
  - non-vessel event **that occupies a berth** — `Community sail day`, `Public open house`,
    `Student tour`, `Donor reception`, `Rescue drill`
  - berth closure — `Dock maintenance - restricted access`, `Float rebuild - no usage permitted`
  - annotation **occupying nothing** — `ETA 1200`, `Departs 0600`, `ETD PM`, bare `1400`
- Name variants are one vessel: `Barge SALT DORY` / `Barge Salt Dory`; `OSV` / `OS/V`.
  Case-folding collapses 484 strings → 418.
- Registry sheets are **self-inconsistent**: some vessels have a length in the name and a
  *different* `LOA:` in the notes. Store both separately; never silently reconcile.
- Duplicate berth rows within one month (`South Float East - 90'` at rows 49 **and** 52 in
  April 2017) are the **manual workaround for a double-booking**. Evidence, not noise.
- **Only 19 of 418 grid vessels have a known length.** Seed exactly those 19 — do **not** invent
  lengths to make the board look better.
- Length data is extremely concentrated: entering **10** lengths makes **52%** of all bookings
  verifiable. This is why the Vessels tab sorts by booking count among unknown-length vessels.

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
