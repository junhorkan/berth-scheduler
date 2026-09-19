# Source data notes

Reference for anyone touching `src/import/`. **Not needed for UI or database work** —
this is deliberately out of `CLAUDE.md` so it is not loaded into every session.

Source: `data/Dock Schedule - Synthetic Sample.xlsx`, 28 sheets.

## Sheets

- 23 year grids, **1997–2019**. 1997 is partial: it starts in August.
- `8YR Dock Summary`, `Science`, `Yachts` — the last two are the vessel registry.
- `Tours` — already a separate system by its own admission. Out of scope.

## Grid shape

Month header in column A, a weekday-letter strip, a day-number strip, then one row per
berth. **A booking is a merged cell range**; the merge *is* the date span.

### The day columns are a calendar, not a fixed offset

Day 1 sits under its real weekday, so it begins at a **different column every month**:

| Month | Day 1 column |
|---|---|
| August 1997 | 1 |
| January 2006 | 1 |
| January 2010 | 4 |
| January 2017 | 2 |

Assuming a constant offset silently misdates the entire file. `findDayColumns()` infers
the offset from every available anchor and then verifies it against the real calendar for
that month.

### Two grid families

- **1997–2001** — columns map straight onto days. The weekday letters run the full width
  but only a lone `1` is printed on the day-number row.
- **2002+** — true calendar offset.

## Three source defects, and how each is handled

1. **The 2002, 2003 and 2004 sheets each open with the previous December.** Sheet "2002"
   row 1 reads `DECEMBER 2001`. The year must come from the header text, not the sheet
   name — but those bookings then merge with the original December rather than
   duplicating it.

2. **The 2010 sheet labels its last two blocks `NOVEMBER 2018` / `DECEMBER 2018`.** A
   typo: the 2018 sheet already owns those months. A stated year is trusted only when
   credible — the same year as the sheet, or the previous December. Otherwise the sheet
   name wins and the anomaly is reported.

3. **2010 rows 117 and 128 have vessel names typed over the day-number row.** Those 12
   cells belong to no berth and cannot be attributed, so they become review items.

## Four entry kinds share one cell space

Classify; never assume.

| Kind | Examples | Occupies a berth? |
|---|---|---|
| `vessel` | `R/V Long Ketch`, `OSV AMBER REEF`, `Barge SALT DORY` | yes |
| `event` | `Community sail day`, `Student tour`, `Bunkering 1000` | **yes** |
| `closure` | `Dock maintenance - restricted access`, `Pier repair - no docking` | yes (blocks) |
| `annotation` | `ETA 1200`, `Departs 0600`, bare `1400` | **no** |
| `unclassified` | `Concrete work near test wells` | becomes a review item |

An operational event carrying a time is still an event: `Bunkering 1000` occupies the
berth, `ETA 1200` does not.

## Name variants

`Barge SALT DORY` and `Barge Salt Dory` are one barge. `OS/V` folds into `OSV`.
Case-folding collapses 484 distinct strings into **418 vessels**.

The registry sheets are self-inconsistent: three vessels state a length in the name and a
**different** `LOA:` in the notes. Both are stored; neither is silently chosen.

## Verified counts (locked into tests)

```
272 / 272   month blocks resolved  (22 full years + Aug–Dec 1997 + 3 carry-overs)
    2,212   source cells read
    2,031   real stays after stitching
      145   cells merged into an existing stay  (49 across a month boundary)
        7   berths          418 vessels        427 review items
       20   vessels with a recorded length  ← the whole problem, in one number
        9   physically impossible assignments (6 of them single-day)
        4   blocks that could not be calendar-verified
       12   cells orphaned on damaged grid rows
```

Change any of these and `src/import/*.test.ts` will fail. That is intentional: the counts
are the contract with the source file.

## Things that look like bugs and are not

- **A 92-day stay.** `M/Y BLUE TIDE`, North Pier West, Jul–Sep 2013. Three full-month
  cells stitched into one occupancy. Correct.
- **`North Finger Piers:`** is a section header, not a berth. It ends in a colon.
- **`Marsh Landing`** appears in `8YR Dock Summary` and never in a grid, so it is not
  modelled.
- **`Small craft slips`** holds several boats at once and is exempt from conflict
  detection. Without that it reports a false conflict almost daily.
