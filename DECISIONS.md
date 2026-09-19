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

**Why.** This is a direct consequence of the data. Only 20 of 418 vessels have a recorded
length, so ~97% of bookings cannot be fit-checked at all. A system that refused to save
anything it could not verify would refuse almost everything and be abandoned in a week.

The deeper point: **the two problems in the brief are different shapes.** Overlap is
decidable from data we always have. Fit depends on data that mostly does not exist.
Treating both as "validation" would force one of two bad outcomes — blocking on unknowns,
or softening the overlap guarantee. Keeping them distinct lets each be as strict as it
can honestly be.

**Rejected:** requiring a length before a vessel can be booked. Clean in principle; it
would have made importing 23 years of history impossible without inventing data.

**Rejected:** a conflict override with a written reason. Tempting for realism, but it
turns "this system cannot double-book" into "this system usually does not double-book",
which is a far weaker claim and a far weaker guarantee.

---

## 3. History that violates the rule is kept, not discarded

**Decision.** Imported bookings that overlap load with `status = 'conflict_unresolved'`,
and the constraint applies `WHERE status = 'active'`.

**Why.** The source contains a real overlap: utility work booked on South Float East
during `OSV AMBER REEF`'s stay of 2017-07-09 to 18. Three options existed — drop the row,
relax the constraint, or represent the state honestly. Dropping it would make the system
disagree with reality; relaxing the constraint would sacrifice the guarantee for one
1997–2019 artefact.

The status column resolves the tension: history loads intact and appears on the board
flagged for resolution, while everything created through the app is `active` and
therefore still cannot overlap. **The claim "this system cannot create a double-booking"
remains literally true.**

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
from it. A view that silently omits records is dangerous, which is why everything the
importer could not place surfaces in Review rather than vanishing.

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

Yellow passes both modes. It is below 3:1 against the light surface, so the relief rule
applies: event bars always carry a visible label, and identity never rests on colour
alone — unknown-length bars also carry a texture, and a misfit breaks its lane
geometrically.

---

## 8. The board opens on July 2010

**Decision.** Not today's date.

**Why.** Today is outside the imported range, so a date-based default greets everyone
with an empty grid that reads as broken. July 2010 is the densest month containing all
four bar states at once — a confirmed fit, a vessel too long for its berth, a non-vessel
event, and many unrecorded lengths. The board explains itself on arrival.

---

## 9. The Vessels list is ordered by bookings blocked

**Decision.** Vessels with no recorded length first, ranked by how many bookings they
make unverifiable.

**Why.** "398 vessels are missing a length" sounds hopeless. But bookings are extremely
concentrated: recording the top ten makes **1,002 of 1,974 bookings — 51% — verifiable**.
Alphabetical ordering hides that; this ordering is the argument, and the page states the
number.

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

**Decision.** No login. Anyone can add, edit and cancel. A visible **Reset to imported
state** restores all 2,031 bookings from a snapshot taken at import time.

**Why.** The most important thing to demonstrate is the conflict check refusing a
booking, and a login wall prevents anyone from trying it. The reset makes that safe:
experimenting cannot cause lasting damage. Auth was out of scope for the brief anyway.

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
Unescaped, searching `100%` matches all 2,031 bookings — the user typed text, not a
pattern. There is a unit test and an end-to-end test for exactly that.
