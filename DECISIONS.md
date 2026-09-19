# Decisions

One entry per choice, **including the ones rejected**. Knowing why something was not
built is usually more informative than the thing that was.

---

## 1. The database prevents double-booking, not the application

**Decision.** A Postgres exclusion constraint:

```sql
EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active')
```

**Why.** The obvious approach is to query for overlaps, then insert if none are found.
That has a window between the check and the insert: two requests can both check, both
find nothing, and both insert. A constraint has no such window — the overlap is
unstorable, not merely discouraged.

It also means the guarantee survives things I did not write. Someone hitting the database
directly, a future API, a bulk import, a bug in my own code: none of them can produce a
double-booking.

**Rejected:** application-level check-then-insert. Simpler to read, but the guarantee is
only as good as every code path that ever touches the table.

**Verified.** Eleven tests run as raw SQL, not through the app: overlapping inserts
rejected, adjacent bookings accepted, pooled berths exempt, closures blocking vessels,
reassignment onto an occupied berth refused.

---

## 2. Fit warns; it never blocks

**Decision.** A vessel too long for its berth produces a visible warning. Saving is still
allowed. Only a conflict disables Save.

**Why.** A vessel's length is only known once somebody records it, and in practice most
never will — the coordinator booking a visiting vessel by email does not have its LOA to
hand. A system that refused to save anything it could not verify would refuse almost
everything and be abandoned in a week.

The deeper point: **the two problems in the brief are different shapes.** Overlap is
decidable from data we always have. Fit depends on data that mostly does not exist.
Treating both as "validation" would force one of two bad outcomes — blocking on unknowns,
or softening the overlap guarantee. Keeping them distinct lets each be as strict as it
can honestly be.

**Rejected:** requiring a length before a vessel can be booked. Clean in principle, but
it makes the common case — a vessel nobody has measured yet — unbookable, and invites
someone to type a plausible number to get past the form. A guess recorded as fact is
worse than an honest blank.

**Rejected:** a conflict override with a written reason. Tempting for realism, but it
turns "this system cannot double-book" into "this system usually does not double-book",
which is a far weaker claim and a far weaker guarantee.

---

## 3. A conflict is always refused; there is no override

**Decision.** Overlapping bookings on an exclusive berth cannot be saved. No reason
field, no supervisor confirmation, no escape hatch.

**Why.** An override turns "this system cannot double-book" into "this system usually
does not double-book", which is a far weaker claim and a far weaker guarantee. The
honest response to a genuine need for two vessels on one berth is rafting — modelled
properly as berth capacity in feet — not a checkbox that disables the rule.

**Consequence worth stating:** `bookings.status` still carries a `conflict_unresolved`
value, and the exclusion constraint applies `WHERE status = 'active'`. Nothing in the
app creates that status now. It is the seam an import path would need, and it costs
nothing to leave in place.

---

## 4. The bar's height is the fit check

**Decision.** `height = vessel length ÷ berth length`. A 120′ vessel in a 75′ berth is
drawn 1.6 lanes tall and visibly breaks its row.

**Why.** The alternative is an icon or a colour that means "too long" — a symbol you must
learn. Proportional height is not a symbol; it is the measurement. The misfit appears as
a consequence of arithmetic, and you see *how badly* it does not fit, not merely that it
does not.

This is the standard **space-time representation of the berth allocation problem** (time
on one axis, quay space on the other, rectangle height = vessel length), adapted to fixed
discrete berths. The interaction model — resources down the rail, dates across, one bar
per booking — is the hotel PMS **tape chart**.

**Adjusted after seeing it render:** a floor of 9px, because a 40′ vessel in the 410′
berth is proportionally a 3px hairline that reads as an empty berth. Proportionality
still governs everything above the floor, including every overflow.

**Borrowed as an anti-pattern:** tape-chart documentation warns the chart must never be
used to judge availability, because reservations without an assigned room are omitted
from it. A view that silently omits records is dangerous, which is why a booking the
board cannot draw is treated as a bug rather than a display detail — and why a fixed
date window that hid future bookings was one.

---

## 5. No scheduler library; the timeline is hand-rolled CSS Grid

**Decision.** `grid-template-columns: repeat(31, 1fr)` and positioned bars.

**Why.** `vis-timeline`, `frappe-gantt` and FullCalendar all assume a booking fills its
lane. **None can draw a bar that overhangs its row** — the single most important thing
this view does. Bending one into it costs more than writing the grid.

**Rejected:** FullCalendar's Resource Timeline, which is also a $480 commercial add-on.

---

## 6. No ORM; SQL is the single source of truth

**Decision.** Plain SQL, typed at the `src/db` boundary. Drizzle was installed and then
removed.

**Why.** The `EXCLUDE` constraint cannot be expressed in any ORM schema DSL. Using one
would mean the schema lived in two places — SQL for the constraint, TypeScript for the
ORM — which can silently drift. Given the constraint *is* the design, SQL wins and the
TypeScript types are declared where queries are written.

---

## 7. Colours were validated, not chosen by eye

**Decision.** vessel = blue, event = yellow `#c98500`, does-not-fit = status red.

**Why.** Two earlier palettes were rejected by running a contrast/colour-vision
validator rather than looking at them:

- **orange for events** sat only 10.8 normal-vision ΔE from the critical red — below the
  15 floor, so an event bar could be mistaken for a violation.
- **violet for events** passed in light mode but collapsed into blue in dark mode
  (1.9 ΔE under protanopia).

Yellow passes both. It is below 3:1 against the light surface, so the relief rule
applies: event bars always carry a visible label, and identity never rests on colour
alone — unknown-length bars also carry a texture, and a misfit breaks its lane
geometrically.

**The dark theme was later removed** and the app is light only. It is read in a daylit
setting, one theme is one thing to keep correct, and the three mark hues were validated
against the light surface. (The violet rejection above is kept because it is why the
palette is what it is, not because the mode still exists.)

---

## 7a. One obvious action, and no control that only confirms another

**Decision.** `+ New booking` is the only filled button on the board. Choosing a month
from the pickers navigates immediately.

**Why.** The month jump used to be a label, two dropdowns and a **Go** button — four
things to express one intent. Choosing the month *is* the instruction; the button existed
only because the form was plain HTML, not because anyone needed to confirm. Removing it
also removed the question of what happens if you change a dropdown and forget to press it.

The same reasoning trimmed the masthead: the title said *Harborview Marine Research
Center* and a label beside it said *Dock Schedule*, which is the same sentence twice.

---

## 8. The board opens on today; you can look back, but not book back

**Decision.** The board opens on the current month. Every bound is computed at request
time: the form refuses a start date earlier than today, while the board itself reaches
one year back and three years forward.

**Why.** This is a scheduling tool for a facility that exists now, so next month has to
be reachable. An earlier version opened on a month from the attached sample and bounded
the range to that sample's own extent, ending in 2019.

**That bound was a bug, not a preference.** Nothing limited the dates on save, so a
booking could be created for 2026, stored correctly, and then be permanently invisible
because the board could not navigate to the month it landed in. It violated the project's
own rule that nothing vanishes silently. "Where the board opens" is a presentation
choice; "how far the board can go" is a capability, and conflating them cost a feature.

**The thing that made today look broken has been fixed separately.** An empty month used
to replace the grid with a line of text, which reads as a failure. It now renders the
full grid — seven labelled berth lanes across the month, ready to be booked into. An
empty schedule looks like an empty schedule.

**Why viewing reaches further back than booking.** A berth cannot be reserved for a day
that has passed, so the form refuses it. But a window that began at today would make a
booking recorded last month unreachable the instant the year turned — the same failure
as the fixed upper bound, in the other direction. Looking back is a record; booking back
is a mistake.

**The floor is derived from the data, not fixed.** `firstYear()` takes the earliest
booking on the schedule, so importing the workbook widens the window to 1997 on its own.
A fixed floor would have left every imported booking stored, searchable and impossible to
open — which is the third time this project would have shipped a booking nobody could
navigate to. Deriving the bound ends the class of bug rather than the instance.

**Detail:** "today" is resolved in `America/New_York`, the facility's timezone. The
server runs in UTC, where 10pm on the 30th is already the 1st — the board would have
rolled a month ahead of the one on the coordinator's wall.

**Detail:** a date input's `min` constrains the picker, not a save that happens through a
click handler, so the past-date check lives in the save path as well as the markup.

---

## 9. The Vessels list is ordered by bookings blocked

**Decision.** Vessels with no recorded length first, ranked by how many bookings they
make unverifiable.

**Why.** "Most vessels are missing a length" sounds hopeless, and alphabetical ordering
keeps it that way. Bookings concentrate heavily on a few regular vessels, so recording a
handful of lengths makes a large share of the schedule verifiable. This ordering surfaces
the highest-leverage gaps first, and the page states how many bookings the next entries
would unlock — so the work looks finite instead of endless.

---

## 10. Month at a time, and no drag-and-drop

**Decision.** One month per view, bookings created and moved through a form.

**Why.** The month grid is what staff have used for 23 years, so there is nothing to
relearn. Drag-and-drop is the most bug-prone UI work available — touch targets,
scroll-while-dragging, snap-to-day, cancel-on-escape — and everything the brief asks for
works without it. The cost is that a stay crossing a month boundary is clipped, so
clipped ends are marked with an arrow and never read as a stay that ended there.

**Rejected:** a continuous scrolling timeline. Truer to month-crossing stays, but
virtualising 23 years is a large amount of work for a small gain.

---

## 11. Public, unauthenticated, with a reset

**Decision.** No login. Anyone can add, edit and cancel. A visible **Clear the schedule**
restores the state the app ships in: an empty schedule with the berths intact.

**Why.** The most important thing to demonstrate is the conflict check refusing a
booking, and a login wall prevents anyone from trying it. Clearing makes that safe:
experimenting cannot cause lasting damage, because the shipped state is reachable in one
action. Auth was out of scope for the brief anyway.

The berths survive a clear deliberately — they are the facility, defined in a migration,
not schedule data.

---

## 12. No in-app page explaining the project

**Decision.** Three tabs — Board, Vessels, Review. No "About" or "Notes" page. Search is
a destination reached from the masthead box, not a fourth tab.

**Why.** This is a tool for a dock coordinator, not a portfolio piece that argues for
itself. A coordinator does not want a migration report; they want a to-do list, which is
what Review is. All rationale lives in these repo files.

---

## 13. Search groups by identity, and is a page rather than a dropdown

**Decision.** A box in the masthead submits to a server-rendered `/search` page. Results
are grouped by vessel or event label — name, total bookings, year range — with six
bookings shown per group and the rest behind *Show all*.

**Why grouped.** `R/V Long Ketch` has 267 bookings. A flat list of matches would bury
every other result under one vessel, and answer "does this vessel exist?" and "when was
it here?" equally badly. Grouping answers both at once, and makes the concentration in
the data visible rather than annoying.

**Why a page, not a live dropdown.** Every other interaction in the app is a plain form
or link rendered on the server. A typeahead would have been the only client-side
component in the project, needing debouncing and an extra endpoint, on the last day —
and it buys nothing a results page does not already give. The whole feature is one
query, one pure grouping function, and a page.

**Why it is not a fourth tab.** Decision 12 stands: three tabs. A results page you reach
by searching is a destination, not a section of the app, and the nav does not grow.

**One detail worth stating.** A typed `%` or `_` is escaped before it reaches SQL.
Unescaped, searching `100%` matches every booking in the schedule — the user typed text,
not a pattern. There is a unit test and an end-to-end test for exactly that.

---

## 14. The legacy schedule is imported, and removable

**Decision.** The app ships with the 23-year workbook imported. **Clear the schedule**
empties it; **Load the sample schedule** puts it back. Both live on the Review tab, and
the empty board offers the load directly.

**Why import it at all.** The brief attached a schedule and described problems that exist
*inside* it — double-bookings caught by eye, vessels that do not fit. Those are the two
things this system is for, and without the data neither can be shown: an evaluator would
have to construct a conflict and an oversized vessel by hand before seeing either check
do anything. The facility is also explicitly replacing a spreadsheet, and any replacement
has to answer what happens to what is already in it.

**Why it is removable rather than baked in.** A reservation system's normal state is the
schedule its users made, not 23 years of someone else's records. Making the import an
action rather than a fixture means the empty case is a real, supported state instead of
a theoretical one.

**This was argued both ways.** An earlier version removed the workbook entirely, on the
grounds that the brief never asked for it to be installed — the other two project options
attached nothing and a blank form respectively, and nobody would preload an app with the
contents of a form. That reasoning still holds for the *default*, which is why loading is
explicit. What it got wrong was the cost: a scheduling tool with nothing in it shows a
reviewer nothing, and the strongest evidence in the project is the data itself.

**What the empty path exposed while it was the default**, and what is now fixed:

- The booking form refused to save a vessel it did not already know, advising the user to
  "add it on the Vessels tab first" — which that tab cannot do. From an empty register,
  **no vessel booking could be created at all.**
- `createBooking` stored `vessel_id = null` for an unknown name, so even past that gate
  the register could never have filled and no length could ever have been recorded.

Both were invisible while hundreds of vessels sat in the database. Keeping the empty case
working is why they stay fixed.

---

## 15. Missing lengths are derived, not queued

**Decision.** The Review queue no longer stores one item per vessel with no length. A
single derived row states the count and points at the Vessels tab.

**Why.** There were 398 of them — 93% of a 427-item queue — all saying the same thing and
burying the 29 items that need a decision. The stored form was also wrong twice over:
cancelling a vessel's last booking left an item insisting its bookings could not be
checked, and clearing a length produced no item at all, because nothing outside the
else ever created one. A derived count cannot go stale.

**What it costs.** Per-vessel dismissal is gone — there is no row to mark done. That is
the right trade: the fix for a missing length is recording it, not dismissing it.

