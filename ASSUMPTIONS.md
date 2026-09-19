# Assumptions

Every interpretation of ambiguous source data, stated rather than buried in code.
Where the source was unclear, the rule was to **record the ambiguity, not resolve it
silently**.

## Dates and occupancy

1. **Bookings are whole-day and inclusive at both ends.** The source grid has no times.
   A booking of Jul 13–16 occupies four days.

2. **A same-day handover counts as a conflict.** Stored as a half-open Postgres
   `daterange [start, end+1)`, so a Mon–Wed stay and a Wed–Fri stay are detected as
   overlapping on Wednesday. In reality one vessel may leave in the morning and another
   arrive that afternoon, but the source records no times, so the system cannot tell the
   difference. Treating it as a conflict is the safe direction to be wrong in: it asks a
   human to look, rather than quietly double-booking a berth.

3. **Contiguous same-name cells on one berth are a single stay.** 145 cells were typed
   day-by-day rather than as a merged range. A vessel that genuinely departed and
   returned the next day is indistinguishable from one that stayed, and the grid reads it
   as one bar, so we match the grid.

4. **Stays spanning a month boundary are one booking, not two.** 49 of them. The
   spreadsheet had to split them because each month is a separate block.

## Berths

5. **`North Finger Piers:` is a section header, not a berth.** It ends in a colon, holds
   no bookings, and has no length.

6. **`Small craft slips (institution boats)` is a pooled berth.** It holds several
   institution boats at once, so it is exempt from conflict detection. Without this it
   would report a false conflict almost every day.

7. **`Marsh Landing` is not modelled.** It appears in the `8YR Dock Summary` sheet but
   never once in an actual schedule grid, so there is nothing to import.

8. **A berth's length comes from its row label** (`South Float East - 90'`). Where a
   label states no length, the berth has none recorded rather than a guessed one.

## Vessels

9. **Case and punctuation variants are one vessel.** `Barge SALT DORY` and
   `Barge Salt Dory` are the same barge; `OS/V` is folded into `OSV`. This collapses 484
   distinct strings into 418 vessels.

10. **A vessel's length is taken from the registry sheets, never invented.** Only 20 of
    the 418 vessels in the schedule appear in `Science`/`Yachts` with a length. The other
    398 are recorded as having no length, and the system says so rather than assuming a
    size.

11. **Where the source states two different lengths, both are kept.** Three vessels have
    a length in their name and a different `LOA:` in the notes. Neither is chosen; the
    Vessels tab shows the disagreement.

## Classification

12. **Four different kinds of thing share one cell space**, and each cell is classified
    as exactly one:
    - **vessel** — carries a type prefix (`R/V`, `M/V`, `OSV`, `Barge`, `Tug`, …)
    - **event** — a non-vessel activity that still occupies a berth
      (`Community sail day`, `Student tour`, `Bunkering`)
    - **closure** — takes the berth out of service (`Float rebuild - no usage permitted`)
    - **annotation** — occupies nothing (`ETA 1200`, `Departs 0600`, a bare `1400`)

13. **Anything that cannot be confidently classified becomes a review item.** Seven cells
    (e.g. `Concrete work near test wells`) plus 12 cells orphaned on damaged rows. They
    are never guessed at and never dropped.

14. **An operational event that carries a time is still an event.** `Bunkering 1000`
    occupies the berth; `ETA 1200` does not.

## Source defects corrected

15. **The 2002, 2003 and 2004 sheets each open with the previous December.** The year is
    taken from the header text, and those bookings merge with the original December
    rather than duplicating it.

16. **The 2010 sheet labels its last two blocks `NOVEMBER 2018` and `DECEMBER 2018`.**
    This is a typo: the 2018 sheet already owns those months. A stated year is trusted
    only when credible — the same year as the sheet, or the previous December. Otherwise
    the sheet name wins and the anomaly is reported.

17. **Day columns are read, never assumed.** Each month is laid out as a calendar, so day
    1 sits under its real weekday and starts at a different column every month. The
    alignment is inferred from every available anchor and then verified against the real
    calendar. Four blocks of 272 could not be verified and are reported as such.

## Deliberately not modelled

18. **Draft and depth are not checked.** The `Yachts` sheet records `Draft: 12'`, but
    **no berth anywhere in the file has a recorded depth**, so a draft check is
    impossible. Inventing depths would produce confident, wrong answers.

19. **Rafting is not supported.** The `Yachts` sheet says *"Will raft alongside if
    needed"*, so two vessels legitimately sharing one berth does happen. Modelling it
    properly means berth capacity in feet rather than a boolean, which is a larger change
    than this brief needs.

20. **The `Tours` sheet is out of scope.** Its own first row says tours are now tracked
    in a separate system.

---

## Who is using this

**The brief does not say whether waterfront staff manage bookings or visitors request
them.** This assumes **staff-managed**: one dock coordinator, or a few, entering and
changing bookings directly. Nothing is requested, queued, or approved.

That assumption shapes more of the interface than any other choice here:

- **No accounts, and no per-user anything.** Everyone who opens it has the same powers.
- **A booking is committed the moment it is saved.** There is no pending state, because
  there is nobody to approve it.
- **The Review tab exists at all.** It is a coordinator's work queue. A visitor-facing
  system would never show source-data defects.
- **The board is the landing page.** A self-service system would open on "find me a free
  berth", not on a grid of everything.

If it turned out visitors book directly, the conflict and fit rules would survive intact —
they are properties of the berth, not of who is asking — but the interface around them
would be a different product: a request flow, an approval queue, and accounts.

