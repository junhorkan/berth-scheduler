# Decisions

One entry per choice, **including the ones rejected**. Knowing why something was not
built is usually more informative than the thing that was.

---

| # | Decision |
|---|---|
| 1 | [The database prevents double-booking, not the application](#1-the-database-prevents-double-booking-not-the-application) |
| 2 | [Fit warns; it never blocks](#2-fit-warns-it-never-blocks) |
| 3 | [A conflict is always refused; there is no override](#3-a-conflict-is-always-refused-there-is-no-override) |
| 4 | [The bar's height is the fit check](#4-the-bars-height-is-the-fit-check) |
| 5 | [No scheduler library; the timeline is hand-rolled CSS Grid](#5-no-scheduler-library-the-timeline-is-hand-rolled-css-grid) |
| 6 | [No ORM; SQL is the single source of truth](#6-no-orm-sql-is-the-single-source-of-truth) |
| 7 | [Colours were validated, not chosen by eye](#7-colours-were-validated-not-chosen-by-eye) |
| 8 | [The board opens on today; you can look back, but not book back](#8-the-board-opens-on-today-you-can-look-back-but-not-book-back) |
| 9 | [The Vessels list is ordered by bookings blocked](#9-the-vessels-list-is-ordered-by-bookings-blocked) |
| 10 | [Month at a time, and no drag-and-drop](#10-month-at-a-time-and-no-drag-and-drop) |
| 11 | [Public, unauthenticated, with a reset](#11-public-unauthenticated-with-a-reset) |
| 12 | [No in-app page explaining the project](#12-no-in-app-page-explaining-the-project) |
| 13 | [Search groups by identity, and is a page rather than a dropdown](#13-search-groups-by-identity-and-is-a-page-rather-than-a-dropdown) |
| 14 | [The legacy schedule is imported, and removable](#14-the-legacy-schedule-is-imported-and-removable) |
| 15 | [Missing lengths are derived, not queued](#15-missing-lengths-are-derived-not-queued) |
| 16 | [Light only, one obvious action, no control that only confirms another](#16-light-only-one-obvious-action-no-control-that-only-confirms-another) |
| 17 | [Repetition is not information](#17-repetition-is-not-information) |
| 18 | [An empty month is not an empty page](#18-an-empty-month-is-not-an-empty-page) |
| 19 | [The type scale was borrowed, not invented](#19-the-type-scale-was-borrowed-not-invented) |
| 20 | [Cancelling is reversible, not restricted](#20-cancelling-is-reversible-not-restricted) |
| 21 | [The facility is not WHOI](#21-the-facility-is-not-whoi) |
| 22 | [The system suggests a berth; it never assigns one](#22-the-system-suggests-a-berth-it-never-assigns-one) |

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

**Amended.** Open access left one real hole: anyone could cancel anyone's booking. The
answer is [20](#20-cancelling-is-reversible-not-restricted) — make it undoable rather
than gated.

---

## 12. No in-app page explaining the project

**Decision.** Three tabs — Board, Vessels, Review. No "About" or "Notes" page. Search is
a destination reached from the masthead box, not a fourth tab.

**Why.** This is a tool for a dock coordinator, not a portfolio piece that argues for
itself. A coordinator does not want a migration report; they want a to-do list, which is
what Review is. All rationale lives in these repo files.

**Amended.** The rule was too broad. It forbade explaining the *project*, which is right,
but it also forbade explaining the *tool*, which left the one screen that renders no
explanation at all with none — see [18](#18-an-empty-month-is-not-an-empty-page). An empty
board now carries three lines of orientation. The line that matters is which of the two it
describes: how to read a bar, never how the bar is implemented. There is still no About
page, no architecture in the product, and no fourth tab.

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

---

## 16. Light only, one obvious action, no control that only confirms another

**Decision.** The app is light only. `+ New booking` is the only filled button on the
board. Choosing a month from the pickers navigates immediately.

**Why.** The month jump used to be a label, two dropdowns and a **Go** button — four
things to express one intent. Choosing the month *is* the instruction; the button existed
only because the form was plain HTML, not because anyone needed to confirm. Removing it
also removed the question of what happens if you change a dropdown and forget to press it.

The same reasoning trimmed the masthead: the title said *Harborview Marine Research
Center* and a label beside it said *Dock Schedule*, which is the same sentence twice.

**Light only** for the same reason — one theme is one thing to keep correct, and it is
read in a daylit setting. Next's default 404 carries its own `prefers-color-scheme` rule,
so it is replaced; that page is also deliberately database-free, because the screen shown
when something is already wrong should not depend on the database being awake.

---

## 17. Repetition is not information

**Decision.** Identical problems fold into one row with a count. A column that is almost
always blank is removed rather than reserved. A statement the interface already makes is
not made again in prose.

**Why.** Three places were measured, not guessed at:

- **The review queue showed one row per affected booking.** `M/V Iron Heron` appeared
  four times consecutively, each reading *"Vessel is 100' but the berth is 55'"* — one
  vessel, one problem, four dates. Across the queue that was **28 rows for 15 actual
  problems**, and the repetition buried the items that differed. Folding took it to 17
  rows and halved the buttons.
- **The Vessels table reserved a column for Operator**, which **6 of 419 vessels** have.
  It was blank on 413 rows, widening the table to display nothing. The six now show it
  under the name.
- **The board announced "Nothing booked in September 2026"** in a bordered band directly
  above a visibly empty grid, while the toolbar already read `0 in September`. Three
  statements of one fact. The legend went too: five colour swatches explaining bars that
  were not there.

**What does not fold.** Conflicts. Each is a distinct pair of bookings needing its own
resolution, so collapsing them would hide real work rather than noise. The grouping key
is deliberately narrow: a vessel too long for a berth is keyed on *that pairing*, because
the same hull can fit one berth and not another.

**A consequence worth stating.** Marking a folded group done resolves every occurrence in
one statement. Closing them individually would leave the group half-present on the next
render, which is the kind of bug that only appears once real data has repeats in it.

**Related:** the same instinct as [16](#16-light-only-one-obvious-action-no-control-that-only-confirms-another) —
a control that only confirms another is repetition too.

---

## 18. An empty month is not an empty page

**Decision.** A month with nothing booked still draws all seven berth lanes, and adds one
line inside the board card naming the nearest month that *does* have bookings, as a link.

**Why.** The live URL's front door was a blank grid. Every imported booking sits in
1997–2019, the board opens on today, and today is September 2026 — so the first thing a
visitor saw was seven empty lanes and no indication that 1,977 bookings existed one click
away. A blank grid cannot be distinguished from a page that failed to load, and the
visitor who assumes the latter never finds out otherwise.

The pointer is computed, never hard-coded: `getNearestBookedMonth()` looks forward from
the month on screen first and falls back to the most recent booking behind it. Forward
first because a schedule in use runs ahead of its reader; the fallback is what reaches
imported history, which is entirely in the past. It runs only when the month on screen is
empty, so the common path does not pay for it.

**Not a contradiction of [17](#17-repetition-is-not-information).** What was removed there
was a bordered band announcing *"Nothing booked in September 2026"* while the toolbar
already read `0 in September` — a third statement of a fact the screen gave twice. What
is here states something nothing else on the page knows: **where the bookings are.** The
empty-month clause is the sentence's setup; the month name is the payload, and it is a
link. Repetition is still not information. A pointer is.

**Rejected: landing on the last month with data.** It would have filled the front door
immediately, and it would have made a live scheduler open in 2019. The board opens on
today because the facility is in today ([8](#8-the-board-opens-on-today-you-can-look-back-but-not-book-back));
an empty today is a true statement about the schedule and must be allowed to be one.

**Rejected: hiding the grid behind the message.** Tried earlier and reverted: replacing
the board with a line of text made an empty month look like a failure, where seven
labelled lanes look like a schedule waiting for a booking. The grid stays; the sentence
sits above it.

**Extended: the empty board is where the tool introduces itself.** Every explanation in
this app hangs off something on screen — the legend off a bar, the verdict strip off a
save, the queue off a problem. On an empty month none of them render, including
`<Legend />`, which is gated on `bookings.length > 0`. So the screen that needs
orientation most had the least, and the best idea in the project — that a bar's height
*is* the fit check — was invisible until you navigated away.

Two facts stay visible — the month is empty, and where the nearest bookings are — and
three rules sit one click behind a `<details>` labelled **How to read this board**. They
are **operating instructions, not a description of the build**, and the whole block is
drawn only while the month holds nothing, so somebody using the tool for real sees it
once and never again. Specs assert all of it: the rules are hidden until the summary is
clicked, and the block is gone the moment the board has a bar.

**Why the label, and not "Info".** The first version put all of it on screen: 59 words,
which made the landing page 82 words before the grid started, 43% of the first screen.
A plain `Info` button would have fixed the count and broken the purpose — the person who
needs these rules is the one who does not know there is anything to learn, and would
never press it. A summary that says what is inside is a reason to click; `Info` is not.
Visible text went 59 words → 13, and the grid moved up to 32% of the screen, without
hiding either fact. No JavaScript: `<details>` is native, so the page stays a server
component.

Rejected alongside it: a `/how-it-works` page in the manner of a consumer marketplace.
That shape earns its place where the process happens off the website — you find a
listing, then meet a stranger and pay them — which no page in the product could show.
This process happens entirely on screen, so a permanent page would be a second copy of
the UI's own labels, drifting out of date.

---

## 19. The type scale was borrowed, not invented

**Decision.** Chrome type, padding and corner radii were raised across the app — body
14→15px, table cells 13→14, buttons 12→13 with real padding, card radii 8→12 — and the
masthead gained a one-line tagline. The board grid was left alone.

**Why.** The reference was [Swipe Market](https://swipemarketcu.com), a Columbia student
marketplace the project owner uses and finds obvious to operate. Studying it, the thing
that makes it easy is not styling: it is that nothing is small, the primary action is
unmissable, and a first-time visitor is told in one line what the site is for. This app
had the opposite settings — 10–13px throughout, the primary action last in a dense
toolbar, and no sentence anywhere saying what it does.

Three things were taken and one was left:

- **Scale.** Nothing in the chrome is below 13px now, and buttons have 6–8px of padding
  instead of 3. This is invariant 11.
- **A sentence under the title.** *"Book a berth, check any date, and never double-book
  one."* It is a tagline, not the explainer page that [12](#12-no-in-app-page-explaining-the-project)
  rules out — and it happens to state the one guarantee the database actually enforces.
- **Room in a row.** Queue rows went from 9px of vertical padding to 13, table cells from
  5 to 9. Density was never the constraint; there was space to spare.
- **Not taken: the centred, playful masthead.** Swipe Market is a consumer marketplace and
  can open with a large centred title and an emoji. This is a tool someone has open all
  day beside other work, and a full-width hero would cost a lane of the board on every
  load.

**The grid keeps its own scale.** Day numbers stay at 10px and bar labels at 10px, because
they are data, not chrome: 31 columns and seven lanes have to fit a screen at once, and
that is a shape constraint, not a reading one. The tooltip carries the full sentence.

**The trap this closes.** Swipe Market's own mobile stylesheet reads
`font-size: 10px; /* Reduced from 12px */` — a table that would not fit was shrunk until
it did, twice. That is the failure invariant 11 exists to prevent here: when something
does not fit, change its shape, not its point size.

---

## 20. Cancelling is reversible, not restricted

**Decision.** No sign-in. A cancelled booking can be restored from Review, and the
confirmation dialog says so **before** you click, not after.

**Why not authentication.** Three reasons, in order of how much they settle it:

- **It does not solve the problem.** Signing in with Google proves *who you are*; it does
  not stop you cancelling somebody else's booking. That needs ownership recorded per
  booking and checked on cancel. Auth is only the identity source — and the expensive
  half of the work.
- **It gates the one thing the URL has to prove.** The brief names *"whether it works"*
  first, and it is the only criterion a reviewer can judge from a link. A login wall in
  front of a public demo — or a mismatched OAuth redirect URI, which is the usual way
  this breaks — turns a working app into a broken sign-in screen.
- **The harm was already small, and undo takes it to zero.** `cancelBooking` was always a
  soft delete: `status = 'cancelled'`, the row untouched. The undo data existed and was
  simply not on screen.

**What it cost.** One nullable column, `bookings.cancelled_at`. It earns its place twice:
it orders the *Recently cancelled* list, and it picks out exactly which review items to
re-open. Cancel stamps the column and resolves that booking's open items in one
transaction, so `resolved_at >= cancelled_at` finds the ones cancelling closed and leaves
anything a coordinator had resolved by hand alone.

Imported rows have `cancelled_at = null`, so the list only ever holds something a person
undid here — a freshly loaded sample shows no cancellation history rather than 2,031 rows
of it.

**Restore goes to `active`, never back to `conflict_unresolved`.** If the berth was taken
meanwhile, the `EXCLUDE` constraint refuses the update and the refusal is shown. That is
the correct outcome: restoring outside the constraint would put back a double-booking,
which is the one thing this system claims cannot happen
([1](#1-the-database-prevents-double-booking-not-the-application)). The guarantee is
enforced on this path by the same three lines of SQL as everywhere else, and a spec
exercises exactly that case.

**Rejected: a "booked by" name field.** Attribution without accounts is spoofable by
typing a different name, so it would have added friction to every booking in exchange for
a guarantee it cannot make. The honest version of that idea is in `ASSUMPTIONS.md`: this
is a staff tool that would sit behind institutional SSO in a real deployment.

---

## 21. The facility is not WHOI

**Decision.** The app is branded `Harborview Marine Research Center`, the name carried in
the sample workbook. WHOI's name, logo and marks appear nowhere.

**Why.** The brief opens *"A WHOI marine research facility needs to manage berths of
varying lengths."* WHOI — the Woods Hole Oceanographic Institution — is a real, operating
institution. This deployment is public and unauthenticated, and every row in it is
synthetic: the facility name, the seven berth labels and all 418 vessel names come from
the supplied workbook, not from WHOI's real waterfront. Putting a real organisation's
marks on a public page states a relationship that does not exist.

Nothing is lost by declining. The reviewers wrote the prompt, the submission form records
which option was chosen, and the app is transparently a berth scheduler loaded with their
own sample data. There was no ambiguity for a logo to resolve.

**Where Woods Hole does survive: where it is factual.** `FACILITY_TIME_ZONE` is
`America/New_York` because the brief's facility is in Woods Hole, Massachusetts, and
resolving "today" in the server's UTC would roll the board a month early at 8pm on the
last day of a month (`src/lib/nav.ts`). That is a statement about a timezone, not a claim
of affiliation.

---

## 22. The system suggests a berth; it never assigns one

**Decision.** The berth dropdown states what each berth is doing on the chosen dates —
`North Pier East — 240ft · free, fits`, `Inner Channel — 55ft · free, 115ft too short`,
`North Pier Face — 75ft · taken Jul 14 – 17` — and a **Find me a berth** button proposes
one and says why. The person still picks and still saves.

**Why this and not auto-assignment.** The brief's second failure is *"verifying that a
vessel actually fits the berth it has been assigned to"* — assigned, by a person. Having
the system choose attacks that one level up: there is less left to verify. But choosing
outright fails on two things:

- **97.5% of vessels have no recorded length**, so for almost every booking the system
  cannot know what fits. Assigning anyway would mean guessing, and
  [invariant 2](../CLAUDE.md) is that a length is never invented. With no length the
  suggester ranks on availability alone and says `fit is not checked` in as many words.
- **The coordinator knows things the database does not**: shore power, crane reach, which
  float is nearest the lab, who is arriving at 0600. A silent assignment ignoring all of
  that is confidently wrong, and confidently wrong twice is how a tool stops being used.

So it does the work and shows its reasoning, and a person confirms. That is also the
honest division of labour: the system owns what it can check — overlap and length —
and nothing else.

**Best-fit, because it is one sentence.** The proposal is the **smallest free berth the
vessel fits in**, so a 40ft launch does not consume the 410ft pier. That is standard
bin-packing, and it matters less for being optimal than for being explainable: *"smallest
free berth that fits 120ft, so the longer ones stay open."*

**When nothing fits it says so, with the number.** `No free berth is long enough for
300ft — the longest free one is 240ft.` A refusal carrying the measurement is more useful
than a proposal that does not fit, and it is the same instinct as
[4](#4-the-bars-height-is-the-fit-check): state the quantity, not the verdict alone.

**The pooled berth is never suggested.** Small craft slips accepts another boat
regardless, so it would win every time and the suggestion would carry no information. It
stays selectable and labelled `shared, no fit check`.

**Where the logic lives.** `src/lib/suggest.ts`, pure and unit-tested against a fixture
of berths — no database, no React ([invariant 1](../CLAUDE.md)). The server returns raw
occupancy; the ranking and every word of the wording happen in that module, on the client
that already holds the berth list and the vessel's length.

**Rejected: two modes, "book a specific berth" or "book any berth".** A fork in the form
costs a second path to build and test, and the "any" branch would hide the one thing
worth showing — *why* that berth. One dropdown that explains itself does the same job.
