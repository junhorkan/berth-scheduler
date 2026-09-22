# Assumptions

The brief is deliberately open-ended. These are the places it was silent and a choice had
to be made. Each one has a visible consequence in the product, so none of them is hidden.

---

## Who is using this

**The brief does not say whether waterfront staff manage bookings or visitors request
them.** This assumes **staff-managed**: one dock coordinator, or a few, entering and
changing bookings directly. Nothing is requested, queued, or approved.

That assumption shapes more of the interface than any other choice here:

- **No accounts, and no per-user anything.** Everyone who opens it has the same powers.
  A real deployment would sit behind the institution's own sign-on; that is assumed, not
  built. Instead of a gate, **cancelling is reversible** — a cancelled booking is
  restored from Review, so the worst an anonymous visitor can do is undone in one click.
  A typed "booked by" name was rejected: it is spoofable, so it would charge every
  booking friction for a guarantee it cannot make.
- **A booking is committed the moment it is saved.** There is no pending state, because
  there is nobody to approve it.
- **The Review tab exists at all.** It is a coordinator's work queue; a visitor-facing
  system would never show it.
- **The board is the landing page.** A self-service system would open on "find me a free
  berth", not on a grid of everything.

If visitors booked directly, the conflict and fit rules would survive intact — they are
properties of the berth, not of who is asking — but the surrounding interface would be a
different product: a request flow, an approval queue, and accounts.

## The facility is not WHOI

**The brief says "a WHOI marine research facility".** The facility here is
`Harborview Marine Research Center`, the name carried in the sample workbook; the app is
titled `Harborview Dock Schedule`, the tool's name rather than the institution's.
WHOI is a real institution; this deployment is public; and every row in it is synthetic —
facility name, the seven berth labels and all 418 vessel names come from the supplied
sample. Using a real organisation's name or logo would state a relationship that does not
exist, so it is not used.

Woods Hole survives in one place, because there it is a fact rather than a claim:
`FACILITY_TIME_ZONE` is `America/New_York`, since that is where the brief's facility is
and resolving "today" in the server's UTC would roll the board a month early.

## The berths

**The seven berths are taken from the sample schedule's row labels**, which embed their
lengths: `North Pier West - 410'`, `Inner Channel - 55'`, and so on. They are also defined
in a migration, so a database built from scratch has them without importing anything —
they are the facility, not schedule data.

- **`Small craft slips` is pooled.** It held several institution boats at once in the
  source, so it is exempt from conflict detection. Treating it as exclusive would report
  a false conflict almost constantly.
- **`North Finger Piers:` is a section header, not a berth.** It ends in a colon, holds
  no bookings and has no length.
- **A berth with no stated length cannot fail a fit check.** Small craft slips has none,
  so bookings there are never flagged as too long.

## Dates and occupancy

- **Bookings are whole-day and inclusive at both ends.** The source grid had no times, and
  a berth is not released mid-afternoon in any useful sense.
- **A same-day handover counts as a conflict.** Stored as a half-open Postgres
  `daterange [start, end+1)`, so a Mon–Wed and a Wed–Fri stay overlap on the Wednesday.
  One vessel leaving as another arrives is real, but treating it as clear would let the
  system approve a double-booking. Refusing is the safe default, and it is stated here
  rather than hidden.
- **A booking cannot start in the past.** A berth is not reserved for a day that has
  already gone; the form refuses it.
- **The board reaches back to the earliest booking on the schedule**, so everything
  recorded stays visible — with the workbook loaded, that is August 1997. Viewing history
  and creating history are different operations. Forward, the window runs three years,
  and every bound is computed per request — a fixed window once made future bookings
  saveable but unreachable.

## Vessels

- **Case and punctuation variants are one vessel.** `Barge SALT DORY` and
  `Barge Salt Dory` are the same hull; `OS/V` folds to `OSV`. Without this the register
  fragments as people type.
- **A vessel's length is never invented.** It is null until somebody records it, and the
  board draws that vessel hatched rather than assuming it fits.
- **Booking a vessel registers it.** A name matching nothing on the register is a new
  vessel, not an error — that is how the register fills from an empty schedule.

## Non-vessel occupancy

- **Events and closures occupy a berth exactly like a vessel**, and participate in the
  same exclusion constraint. The brief calls out community sail days specifically; a
  booking system that let a vessel be booked into a berth closed for repair would be
  failing at its one job.
- **Only vessels are fit-checked.** An event has no length, so "does it fit" is not a
  question that applies.

## Reading the workbook

The sample is a 23-year spreadsheet, and turning it into records meant deciding what its
cells mean. Each rule below has a visible consequence, and each is locked into a test that
runs once the workbook is in `data/`. The mechanics are in `docs/DATA-NOTES.md`.

- **A merged cell is one booking, and its width is the dates.** The spreadsheet has no
  start or end columns; a vessel held a berth for as many days as its cell spans. Losing
  the merges — which is what exporting to CSV does — turns most multi-day stays into
  single days and erases the only double-booking in the file.
- **Day 1 is found, not assumed.** It sits under its real weekday, so it is a different
  column every month. The offset is inferred from every anchor available and checked
  against the real calendar; assuming a fixed one would misdate the whole file.
- **A stated year is trusted only when it is credible.** The 2010 sheet labels two months
  `2018`. The header wins only when it names the sheet's own year or the previous
  December; otherwise the sheet's year does, and the anomaly is reported, not buried.
- **A carried-over December is the same December.** The 2002–2004 sheets each open with
  the previous December. Those bookings merge with the original rather than doubling it.
- **A stay that crosses a month end is one stay.** The grid drew it as two bars; 49 of
  them are stitched back together.
- **A cell that belongs to no berth is not guessed at.** Twelve names typed over a
  day-number row become review items with their sheet, row and column.
- **Four kinds of thing share one cell space.** A vessel, an event and a closure all
  occupy a berth; a timing note like `ETA 1200` does not, and never becomes a booking.
  A cell matching none of these is an unreadable cell for a person to decide.
- **Spelling variants are one vessel.** `Barge SALT DORY` and `Barge Salt Dory` are one
  hull, and `OS/V` is `OSV`: 446 spellings are 418 vessels.
- **When the source contradicts itself, both answers are kept.** Three registry entries
  state one length in the name and another in the notes. Neither is silently chosen.

## Deliberately not modelled

- **Draft and depth are not checked.** Vessel draft is a real constraint, but no berth
  depth exists anywhere in the material provided, so the check is impossible rather than
  merely missing. Inventing depths would produce confident wrong answers.
- **Rafting is not supported.** Two vessels legitimately sharing one berth does happen.
  Modelling it properly means berth capacity in feet rather than a yes/no, which is a
  larger change than this needed, and half-building it would weaken the overlap guarantee.
- **No recurring bookings, no notifications, no audit log, no payments.** None is implied
  by the brief.
