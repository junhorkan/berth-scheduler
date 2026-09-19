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
- **A booking is committed the moment it is saved.** There is no pending state, because
  there is nobody to approve it.
- **The Review tab exists at all.** It is a coordinator's work queue; a visitor-facing
  system would never show it.
- **The board is the landing page.** A self-service system would open on "find me a free
  berth", not on a grid of everything.

If visitors booked directly, the conflict and fit rules would survive intact — they are
properties of the berth, not of who is asking — but the surrounding interface would be a
different product: a request flow, an approval queue, and accounts.

## The berths

**The seven berths are taken from the sample schedule's row labels**, which embed their
lengths: `North Pier West - 410'`, `Inner Channel - 55'`, and so on. That is the only
place the attached sample influenced the running system, and the berths are defined in a
migration rather than imported, so they are configuration a real facility would edit.

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
- **The board still reaches a year back**, so bookings already recorded stay visible.
  Viewing history and creating history are different operations. Forward, the window runs
  three years, and every bound is computed per request — a fixed window once made future
  bookings saveable but unreachable.

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

## Deliberately not modelled

- **Draft and depth are not checked.** Vessel draft is a real constraint, but no berth
  depth exists anywhere in the material provided, so the check is impossible rather than
  merely missing. Inventing depths would produce confident wrong answers.
- **Rafting is not supported.** Two vessels legitimately sharing one berth does happen.
  Modelling it properly means berth capacity in feet rather than a yes/no, which is a
  larger change than this needed, and half-building it would weaken the overlap guarantee.
- **No recurring bookings, no notifications, no audit log, no payments.** None is implied
  by the brief.
