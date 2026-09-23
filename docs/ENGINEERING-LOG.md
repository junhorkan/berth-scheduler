# Engineering log

The build half of [DECISIONS.md](../DECISIONS.md): the entries that record how the thing
was made rather than how the problem was read. Same numbering, same wording, same
"Superseded by" banners — they are moved, not rewritten, so a link or a commit message
naming an entry still lands on it.

Nothing here is required reading. [DECISIONS.md](../DECISIONS.md) holds the fourteen choices
worth arguing about.

---

| # | Entry |
|---|---|
| 5 | [No scheduler library; the timeline is hand-rolled CSS Grid](#5-no-scheduler-library-the-timeline-is-hand-rolled-css-grid) |
| 6 | [No ORM; SQL is the single source of truth](#6-no-orm-sql-is-the-single-source-of-truth) |
| 7 | [Colours were validated, not chosen by eye](#7-colours-were-validated-not-chosen-by-eye) |
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
| 23 | [A long list shows its head, and names its categories once](#23-a-long-list-shows-its-head-and-names-its-categories-once) |
| 24 | [The masthead is the page's name, in the reference site's shape](#24-the-masthead-is-the-pages-name-in-the-reference-sites-shape) |
| 25 | [The sample reaches around today](#25-the-sample-reaches-around-today) |
| 27 | [The vessel register loads when the panel opens](#27-the-vessel-register-loads-when-the-panel-opens) |
| 28 | [Clear is undoable, and the board is not a wall](#28-clear-is-undoable-and-the-board-is-not-a-wall) |
| 30 | [One undo rule, an importer that fails loudly, and a check that writes nothing](#30-one-undo-rule-an-importer-that-fails-loudly-and-a-check-that-writes-nothing) |
| 31 | [373 cells the importer was dropping in silence](#31-373-cells-the-importer-was-dropping-in-silence) |
| 32 | [A move changes a span, not only a berth](#32-a-move-changes-a-span-not-only-a-berth) |
| 33 | [The drawn bar is the data; the target you press is not](#33-the-drawn-bar-is-the-data-the-target-you-press-is-not) |
| 26 *cont.* | [Review's two revisions](#26-continued-reviews-two-revisions) |
| 37 | [The one sentence in the documentation that was not true](#37-the-one-sentence-in-the-documentation-that-was-not-true) |
| 38 | [Clear is gone, and two mastheads stopped reporting state](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state) |

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

> **The buttons named here changed in [38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state).**
> *Clear the schedule* is removed and the load is *Restore the original schedule*. The reset
> this entry argues for is still one press away; it is the only one left.

**Decision.** No login. Anyone can add, edit and cancel. A visible **Load the sample
schedule** puts back the state the app ships in, so nothing a visitor does can spoil the
demonstration for the next one.

**Why.** The most important thing to demonstrate is the conflict check refusing a
booking, and a login wall prevents anyone from trying it. The reload is what makes that
safe: the shipped state is reachable in one action. Auth was out of scope for the brief
anyway.

The berths survive a clear deliberately — they are the facility, defined in a migration,
not schedule data.

**Corrected.** This entry used to say that *Clear the schedule* restored the shipped
state, from the time when the app shipped empty. It ships with the sample loaded
([14](#14-the-legacy-schedule-is-imported-and-removable)), so the reload is the way back,
and for a time Clear was the one irreversible action in the app. It no longer is: Clear
and Load both snapshot what they replace and can be put back
([28](#28-clear-is-undoable-and-the-board-is-not-a-wall),
[29](../DECISIONS.md#29-nothing-on-the-board-is-invented)), and invariant 12 has no exception.

**Amended.** Open access left one real hole: anyone could cancel anyone's booking. The
answer is [20](../DECISIONS.md#20-cancelling-is-reversible-not-restricted) — make it undoable rather
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

> **The second half of the title is superseded by [38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state).**
> The schedule is not removable from the product any more: *Clear the schedule* is gone and
> the load, renamed *Restore the original schedule*, is what remains. Why it is imported at
> all — everything below — stands unchanged.

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
Center* and a label beside it said *Dock Schedule*, which is the same sentence twice. It
now says *Harborview Dock Schedule* once, at a size you can read from across the room
([24](#24-the-masthead-is-the-pages-name-in-the-reference-sites-shape)).

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
today because the facility is in today ([8](../DECISIONS.md#8-the-board-opens-on-today-you-can-look-back-but-not-book-back));
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
- **Not taken at first: the centred masthead.** Swipe Market is a consumer marketplace and
  can open with a large centred title and an emoji; this is a tool someone has open all
  day beside other work, and the worry was that a hero would cost a lane of the board on
  every load. That was measured and overturned in
  [24](#24-the-masthead-is-the-pages-name-in-the-reference-sites-shape): the owner chose
  the hero after seeing both, it costs about a lane and a half, and every lane still fits
  a laptop.

**The grid keeps its own scale.** Day numbers stay at 10px and bar labels at 10px, because
they are data, not chrome: 31 columns and seven lanes have to fit a screen at once, and
that is a shape constraint, not a reading one. The tooltip carries the full sentence.

**The trap this closes.** Swipe Market's own mobile stylesheet reads
`font-size: 10px; /* Reduced from 12px */` — a table that would not fit was shrunk until
it did, twice. That is the failure invariant 11 exists to prevent here: when something
does not fit, change its shape, not its point size.

---

## 23. A long list shows its head, and names its categories once

**Decision.** Vessels renders the first 25 rows with a name filter and a
*Show the remaining 393*; Review groups its queue under one heading per kind of problem
and drops the toolbar pills that said the same thing.

> **The Vessels half is revised at the foot of this entry**: the table is a queue of five
> rows now, with the measured hulls behind a button. The Review half stands as written.

**Why, measured.** Both pages had the fault named in
[17](#17-repetition-is-not-information), one level up from where it was fixed there:

| | Before | After |
|---|---|---|
| Vessels page height | **21,713px** — 24 screens | 1,671px |
| Vessel rows / length inputs | 418 / 418 | 25 / 25 |
| Vessels lede | 61 words | 25 |
| Review category labels drawn | **15**, for 2 categories | 4 headings, one each |
| Review page height | 2,058px | 1,779px |

**Vessels contradicted its own argument.** The page exists to say that bookings are
concentrated — ten lengths cover half the schedule — and then rendered all 418 rows in
booking order, burying that claim under 24 screens of scrolling. Showing the head and
keeping the tail one click away is the page agreeing with itself.

The filter searches the **whole** register, not the visible head: cutting the list must
not cut what you can find. A vessel you have the measurement for is exactly the one you
came to type in, and it is usually in the tail.

### Revised: the register is a queue, and looks like one

**Decision.** The four-column table is gone. A vessel is the row Review uses — its name,
a quiet line saying what a length there would unlock (*267 bookings · last 2019*), and
the length box on the right where a review row puts its one button. The register's two
halves are two buttons side by side, as Review's History states its categories: **No
length on record** and **With a length recorded**, because a hull that has been measured
is not work. Ten rows at a time, and the rest is **a page forward, not a longer page**:
`‹ 1–10 of 398 ›`. The line under the page's name counts exactly the rows on the first
page, from the same constant the list pages with.

**Why.** 25 near-identical rows, each carrying an empty box, is a wall — the fault of
[17](#17-repetition-is-not-information) again, one level up. The page is a queue: work
first, measured hulls out of the way, one category named once above its rows. It is also
the shape the owner asked for, having seen it work on Review.

| | Table of 25 | Paged queue |
|---|---|---|
| Page height | 1,671px | **one screen**, whichever page you are on |
| Empty length boxes on screen | 25 | 10 |
| Column headers, and their alignment on a phone | 4 | none |
| Longest list one click can produce | 418 rows | 10 |

**Why pages rather than a fold.** *Show the remaining 393* has one outcome, and it is the
wall again — the owner's objection, and correct: a control whose only setting is "far too
much" is not a control. A page forward cannot produce a longer page.

**What it costs.** A table lines its numbers up, and this does not: *267 bookings · last
2019* is a sentence, not a column. With five rows it reads at a glance, and it survives a
375px screen, which the four columns did by squeezing a vessel's name to one word a line.

**What was cut from Vessels, and why each.**

- *"That is why this list is ordered by bookings blocked, not alphabetically."* A page
  explaining its own sort order is usually sorted wrong. The `Bookings` column, descending,
  says it without a sentence.
- The `Last booked` column keeps only the **year**. The question it answers is whether a
  hull is still in use or is history that needs no measuring, and `2004` answers that as
  well as `2004-01-03` in a third of the width.

**What was cut from Review.** The pills — each named a category and gave its count, which
is exactly what the section heading below it now does. And **Clear the schedule moved to
the foot of the page**: a destructive action does not belong in a header, one slip from
the button that loads data. *(It left the foot too, in
[38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state) — moving it was the right
answer to the wrong question. The load stayed, renamed.)*

**What survived a cut it nearly did not.** Provenance — `sheet 2008, row 12, col 2` — is
kept, but only on *Could not be read* items, which are the ones you resolve by going and
looking at the cell. On a conflict or a misfit the booking is on the board, where the
sheet coordinates tell you nothing you can act on. It is the evidence that nothing was
silently dropped, so it stays where it is evidence and goes where it was noise.

**Extended to Review's rows.** Measured on the live queue: 17 rows carried 23 bordered
buttons, 16 monospace metadata lines, and three lines of text each. Three changes, none
of which removes a fact or an action: *Show on board* is navigation, so it is a text link
with an arrow, the way the search results already render it, and *Mark done* is the row's
one button; the metadata line is set in the regular face, because monospace made every
row read as a log entry; and a cell nobody could read states what it said and where it was
on one line, with the sheet coordinates folded into it. Each section shows its first five
rows and folds the rest behind *Show the remaining N*, the head-of-list rule above applied
to the queue, using a native `<details>` so the page stays a server component.

### The register lists what is on the schedule; the typeahead remembers everything

Found by the owner, on the live site: *"when I cancel a vessel that I just added, and it's
a new one, it is still listed in the vessels page."* True, and there was a hull named
`Jun Bay` sitting on the live register proving it — booked once, cancelled, and stuck.

**The cause is invariant 2 working, with no matching exit.** Booking a name registers the
vessel, which is how the register fills itself through ordinary use. Nothing unregistered
it. `getVessels` LEFT JOINed the bookings, so the hull came back with `0 bookings` and
`last seen: never` — a row in a queue **ordered by how many bookings each missing length
blocks**, blocking nothing, that no action on the page could remove.

**The fix is one word: the join is INNER.** A vessel with nothing on the schedule is not
on the register.

**Why not delete the row.** A cancel is a soft delete ([20](../DECISIONS.md#20-cancelling-is-reversible-not-restricted)),
so the vessel has to survive to be restored with its booking — including any length
somebody recorded on it in the meantime. The cancelled booking is on Review the whole
time, under *Cancelled bookings*, with a button that brings both back. Nothing vanished;
it moved to the card that holds it.

**And `getVesselOptions` stays unfiltered**, which is the half that makes this safe. The
booking typeahead still completes a cancelled hull's name, so booking it again reuses that
row rather than quietly registering a second vessel with the same name and losing its
length. **The register shows what is on the schedule; the typeahead remembers everything.**

**A count that could not disagree, and now cannot.** Review's *No recorded length* already
INNER JOINed bookings the same way, so the two pages were one orphan away from reporting
different numbers for the same thing. They are the same join now.

---

## 24. The masthead is the page's name, in the reference site's shape

**Decision.** Every page opens with a centred title in the brand blue, one line under it,
and — on the board — the one filled button. The month navigation moved inside the board
card as its header; the count strip beside it is gone; the chrome is set in Poppins,
self-hosted; cards float on a shadow instead of sitting inside a hairline. The board's
title is the tool's name, *Harborview Dock Schedule*, not the institution's.

**Why.** [19](#19-the-type-scale-was-borrowed-not-invented) took the reference site's scale
and declined its centred masthead, on the grounds that a hero costs board space on every
load. The project owner looked at both and chose the hero. This entry records what that
cost and what it bought, measured on the same month at the same width:

| | Before | After |
|---|---|---|
| Title | 21px, top left | 36px, centred, brand blue |
| Words on screen before the grid starts | 35 | 24 |
| Controls in the row above the grid | 9 | 5, with the filled button standing alone |
| Grid begins at | 207px | 310px |
| Seven lanes and the legend end at | ≈700px | 838px |

**What it cost.** About a lane and a half of vertical space. The whole board — all seven
lanes and the legend — still ends inside 840px, so a laptop shows every lane at once,
which was the line [19](#19-the-type-scale-was-borrowed-not-invented) drew.

**What it bought.** A first-time visitor reads three things in order — what this is, what
it does, what to press — before anything competes for the eye. Before, the title was the
smallest text on the page after the day numbers, and the primary action was the last of
nine controls in a toolbar.

**What went.** The count strip: *7 berths · 0 in September · 418 vessels · 29 to review*
said four things, three of which the screen already said — seven lanes are visible, the
empty-month line names the month, and the Review tab carries the badge. That is
[17](#17-repetition-is-not-information) applied to the toolbar. The month navigation kept
every control and lost its box.

**What did not change.** The grid. Day numbers and bar labels keep the system face at
10px, because 31 columns and seven lanes are a shape constraint (invariant 11), and a
display face at that size costs label width for nothing.

**Each page names itself.** Vessels and Review put their own name in the title and their
one-line lede under it, and the site's name becomes a small link back in the top row. The
board, being the site, takes the site's name. That is the reference site's pattern too:
its posting page is titled *Post Listing*, with the site's name as the way back.

**Rejected: the emoji, and the top row's contents.** The reference site opens with a
shopping cart; a dock schedule with a boat in its title would be charming once and
tiresome by Tuesday. Its top row holds sign-in and feedback, which this app has neither
of; ours holds the tabs and the search box, which it does.

---

## 25. The sample reaches around today

> **Superseded by [29](../DECISIONS.md#29-nothing-on-the-board-is-invented).** The bookings described
> here were removed. Kept because the reasoning, and why it was reversed, is the record.

**Decision.** Loading the sample also places 33 bookings around the day it is loaded —
three weeks behind it and six ahead — using real vessels from the register and event and
closure labels the workbook uses. Among them: a vessel too long for its berth on each
side of today, two boats in the pooled slips at once, a stay straddling the load day, and
the first berth in display order taken on the day the booking form opens to. They carry
`source = 'sample'`, and the booking sheet says so.

**Why.** Every booking in the workbook ended on 31 December 2019, and a booking cannot be
made for a day that has passed ([8](../DECISIONS.md#8-the-board-opens-on-today-you-can-look-back-but-not-book-back)).
Put together, that meant the month the board opens to held nothing, and the strongest
claim in the project — that the database refuses an overlap — could only be seen by
making two bookings by hand first. The berth dropdown, built to say what every berth is
doing ([22](../DECISIONS.md#22-the-system-suggests-a-berth-it-never-assigns-one)), had seven free rows
and nothing to say. And the demo script's step *"move the dates clear, Save enables"* was
false on any month of the workbook, because every one of them is in the past.

Now the board opens on a live month with a misfit on it, the form opens onto a taken
berth so the refusal is the first verdict, and *Find me a berth* has a real answer.

**And the dock has a past, not only a future.** The first version placed everything on or
after the load day, which left the month blank up to today and busy after it — a shape no
real schedule has, and one that reads as a system switched on this morning. Bookings now
run three weeks behind as well, which is only possible because the reload writes them
itself: the form refuses a past date ([8](../DECISIONS.md#8-the-board-opens-on-today-you-can-look-back-but-not-book-back)),
and that rule is for people, not for a fixture. One of them is a misfit that has already
sailed, so the board shows red on both sides of today while the queue asks about the live
one only — [26](../DECISIONS.md#26-a-queue-holds-work-history-goes-in-an-archive) made visible on one
screen. Seven lanes, no empty rows, 24 bars on the opening month against 8 before.

**Dated at load, not fixed.** Fixed dates would have been in the past by the time anyone
looked — the same failure as the fixed window in
[8](../DECISIONS.md#8-the-board-opens-on-today-you-can-look-back-but-not-book-back). The offsets are
resolved against the facility's today when the reload runs, so the sample is current for
whoever loads it, and reloading it re-bases it.

**Nothing invented but the dates.** Every name resolves against the register the seed
just restored; a name that does not is an error that fails the reload, not a row that
is skipped. The module is pure, in `src/lib`, and unit-tested against the overlap rule
in `src/domain`, because a single overlap between two forward bookings on an exclusive
berth would make the constraint refuse the entire reload transaction.

**What it costs.** The front door no longer opens on the empty-board introduction
([18](#18-an-empty-month-is-not-an-empty-page)); it appears on any empty month, which
is now the month after next. And the sample is no longer purely the workbook, which is
why these rows are marked as what they are rather than as imported or entered.

**The suite loads it the same way.** The Playwright teardown used to copy the reload's
SQL; it now calls the reload itself, so what it leaves on the live database is exactly
what the button leaves. `npm run sample:load` is the same function from the terminal.

**Rejected: landing on the last month with data.** Already rejected in
[18](#18-an-empty-month-is-not-an-empty-page) — a live scheduler must open on today.
This is the other way round: bring today's month to the data, not the board to 2019.

---

## 27. The vessel register loads when the panel opens

**Decision.** The board no longer receives the 418-vessel register. `BookingPanel` asks
for it with a server action the first time it opens, and the field works before it
arrives.

**Why, measured.** The board page was 91KB, of which 73KB was serialized React payload
and only 18KB was visible markup. About 36KB of that was every vessel's id, name and
length — sent on the first load and again on every month click, to populate an
autocomplete list that most visits never open. The board is the page people navigate
most, and it was the heaviest one for a feature behind a button.

| | Before | After |
|---|---|---|
| Serialized payload | 73 KB | 56 KB |
| …with 16 more bookings on screen | — | yes |
| Register in the HTML | all 418 | none |

**Why it is safe to arrive late.** A name that matches nothing is a new vessel anyway
([invariant 2](../CLAUDE.md#invariants)), and `createBooking` resolves a known name to its row on
the server through `findOrCreateVessel`. So while the register is in flight the field
still accepts anything and a save still lands on the right vessel. What waits is the
autocomplete list and the *"100ft on record"* line, not the ability to book.

**The one thing that had to be guarded.** `vessels` is `null` while loading, which is
not the same as empty, and the *"New vessel — saving adds it to the register"* hint is
suppressed until it resolves. Without that, typing a hull the system knows perfectly
well would flash a claim that it is new — confidently wrong, for about 50ms, on the
screen where trust matters most.

**A failed fetch falls back to empty**, which behaves exactly like a name nobody knows:
a supported path, already tested, rather than a broken panel.

**Rejected: fetching on mount instead of on open.** It would have kept the page small
and still paid for the register on every visit, just over a second connection. The
point is that a list behind a button should cost nothing until the button is pressed.

---

## 28. Clear is undoable, and the board is not a wall

> **The button is gone in [38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state);
> the machinery is not.** `clearSchedule` still snapshots inside the transaction that empties
> the live tables, and the e2e fixture is now its only caller. Every rule here holds for
> *Restore the original schedule*. Kept because one transaction, and why, is the record.

Two corrections from the owner looking at the running app. Different in size, identical
in kind: both were places where a defensible decision had drifted past the point it
served anybody.

### Clear was the last irreversible thing

**Decision.** `clearSchedule` copies every booking, vessel and review item into
`bookings_undo`, `vessels_undo` and `review_items_undo` **inside the same transaction
that empties the live tables**, and records what it took in `clear_undo_meta`. An
**Undo the clear** button then appears on Review and on the empty board.

**Why in one transaction.** If the copy and the delete were separate steps, a failure
between them would either lose the data or leave a snapshot of something that still
exists. In one transaction a failed copy removes nothing and a failed delete rolls its
snapshot back, so the undo can never be out of step with what it is undoing.

**Why the empty board offers it too.** Whoever just pressed Clear is looking at the
board a second later, not at the tab the button lives on. An undo you have to go and
find is one people do not find.

> **The rule below is superseded by [30](#30-one-undo-rule-an-importer-that-fails-loudly-and-a-check-that-writes-nothing)**:
> Put back is now a swap, and Load keeps a snapshot of real work rather than retiring it.

**The snapshot is consumed on use, and retired by loading the sample.** Running undo
twice would wipe whatever was done after the first one, and undoing a clear *after*
deliberately loading something else would silently discard that choice. Same rule both
times: an undo applies to the thing it was taken for.

**What this closes.** [Invariant 12](../CLAUDE.md#invariants) used to read *"nothing destructive is
irreversible, except the one thing that says so"*. Saying so in a dialog is a warning,
not a design. The exception is gone.

### The board had become a wall

> **Superseded by [29](../DECISIONS.md#29-nothing-on-the-board-is-invented)**, which removed the invented
> bookings this section was thinning. The Clear undo above stands, and now covers Load.

**Decision.** The sample's own bookings go from 33 to 23, the stays are shorter, and
exactly one of them is too long for its berth.

**Why.** [25](#25-the-sample-reaches-around-today) fixed a board that was blank until
today, and overshot: sixteen backfilled stays filled every lane edge to edge, and two
misfits meant two bars breaking upward across most of the grid. The month became harder
to read than the empty one it replaced.

| | Empty | Overcorrected | Now |
|---|---|---|---|
| Bars on the opening month | 8 | 24 | 15 |
| Bars breaking out of a lane | 1 | 2 | 1 |
| Lanes with nothing in them | 4 | 0 | 0 |

**What the gaps are for.** A real berth sits idle between visits, and the white space is
what lets the eye find a booking at all. Density was never the goal; legible evidence
that the checks work was, and one misfit demonstrates that better than two, because two
read as a broken board rather than an instructive one. A unit test now fixes that count
at one, so the next person to add a sample booking has to mean it.

---

## 30. One undo rule, an importer that fails loudly, and a check that writes nothing

Everything [29](../DECISIONS.md#29-nothing-on-the-board-is-invented) built was then reviewed
adversarially, by agents told to break it rather than approve it. They broke three
things, and one argument changed a decision.

### The undo had a policy, and the policy was wrong

> **Two buttons reach this rule now, not three
> ([38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state)).** Clear left the UI;
> the rule, the state machine and the 24,576 sequences are untouched, and `clearSchedule` is
> still one of the actions `lib/undo.ts` covers — reached only by the test fixture.

**Decision.** Clear, Load and Put back follow one rule: **an action saves what it
replaces, unless that has nothing to lose.** A schedule has nothing to lose when no
booking on it is active, or when it is the untouched sample, which Load can always make
again. Put back is therefore a swap: press it twice and you are where you started.

**Why one rule.** Every undo bug found was in *which state gets saved when*, not in the
SQL that moves rows:

- **Put back destroyed work.** After a Load, a visitor could make days of bookings on the
  sample; one click of Put back from anyone deleted them, with no way back.
- **Load twice** replaced the snapshot of your work with a snapshot of the sample.
- **The first Load on a fresh site** offered to "put back 2,031 bookings" — the ones
  already on screen.
- **A schedule of only cancelled bookings** counted as content here while the board
  called it empty, so it could overwrite the snapshot the board was offering.
- **Two replaces at once** could both snapshot. Each now takes an exclusive lock on the
  three tables first, with a ten-second timeout.

So the rule lives in `src/lib/undo.ts` as a pure state machine, and
`src/db/mutations.ts` follows it step for step. Its tests run every sequence of up to six
actions — Clear, Load, Put back, or an edit — from six starting states: 24,576 runs,
checking after every step that no replace destroyed a schedule with something to lose,
and that the snapshot is only ever one worth putting back.

**What it cannot do, stated.** There is one slot. Load over work, edit the sample, Load
again: the second Load saves the newer work, and the older is gone. Holding both needs a
history with identity, which a site without accounts does not have. A test pins the
limit so nobody mistakes it for a bug, or a feature.

### The importer failed silently, or halfway

**Before.** `scripts/import.mts` truncated the berths table, which changed the ids every
booking and snapshot referenced, and wrote in separate statements with no transaction:
a failure midway left half a schedule live. A file with no year sheets "succeeded" with
zero rows. The interpretation itself was top-level script code with no tests.

**Decision.** `src/import/plan.ts` is the one interpreter of the file: bytes in, a plan
and a reconciliation out, writing nothing, with no `node:fs` anywhere it reaches.
`writeImportPlan` writes a plan in one transaction, under the undo rule, and never
touches the berths — it maps the workbook's berths to the facility's by name and refuses
one the facility does not have. `npm run import:check` prints the reconciliation with no
database at all.

**Refused, loudly, each with a test:** an empty file; a CSV, with the reason; random
bytes; a zip that is not a workbook; no sheet named for a year; year sheets with nothing
placeable; a sheet larger than any schedule. And the ones that were attacks rather
than mistakes, each measured before it was closed:

- **A zip bomb.** SheetJS inflates every entry eagerly. A 901KB file reached 1.5GB of
  memory and then returned zero rows without an error. The first guard read the zip's
  directory and refused a file declaring more than 50MB — and a second review broke it
  twice. SheetJS sizes its output from each entry's *local* header, not the directory,
  and treats a stated size of 0 as "grow without limit"; and it finds the directory by a
  different search, so a record planted in the zip comment showed the guard one
  directory and SheetJS another. The guard now reads exactly what SheetJS reads, and
  `planImport` inflates every entry once with the platform's own decompressor first,
  refusing the file the moment one passes the size it states. That is the only honest
  answer to a zip bomb, which works by lying about exactly that.
- **A declared extent.** A 222KB sheet declaring `A1:XFD1048576` took 92 seconds.
  `nodim` makes SheetJS measure the cells that exist instead, and the sheets' combined
  extent is capped at 2 million cells: 64 sparse sheets, each within the per-sheet limit,
  could otherwise buy 320 million cell reads.
- **Three pieces of worse-than-linear parsing**: two regular expressions with
  catastrophic backtracking, in the registry and berth parsers, and a registry scan that
  re-read a whole row for every vessel name in it. All three are linear now.

### A check that writes nothing

> **Removed in [34](../DECISIONS.md#34-a-dry-run-for-a-step-the-product-does-not-have).** The reasoning
> below is why it was safe; 34 is why it was cut anyway. `npm run import:check` does the
> same job on the command line, where the import itself lives.

**Decision.** `/check` reads a workbook in the visitor's browser, runs the same
`planImport` the importer runs, and shows its reconciliation: double-bookings,
misfits, the file's defects, the cells it would not guess at, each with where it sits in
the workbook, and whether the file matches the sample imported here, booking for booking.
Nothing is uploaded and nothing is saved. There is no endpoint behind it.

**Booking for booking, not figure for figure.** The first version compared four totals.
A reviewer swapped two bookings' dates on the 2015 sheet and every total held, so the
page called a different schedule identical. Now the server hashes every stay in the seed
— berth, kind, status, name, dates — month by month, and every vessel's name and length
(`lib/fingerprint.ts`); the browser hashes the file's plan the same way. About 6KB goes
to the page instead of 2,031 rows, and a difference is named by month: *bookings differ
in Mar 2015*.

**Why this reverses part of 29.** 29 argued an upload "would show a grader nothing new",
and for an untouched file that is true: it matches, booking for booking. A skeptic's
reply won the argument: it is false of an *edited* file. A grader who plants a second
booking on a taken berth and drops the file in sees the page name the new
double-booking and the cell it came from — the brief's own named failure, caught in a
file the grader controls, which no sentence in a README can show. An end-to-end spec does
exactly that whenever the workbook is present.

**What 29 decided still stands.** Never a write path from a file. Importing from a
public page with no accounts would let any visitor replace everyone's schedule; that
stays a job for an operator with the database credentials.

**Why the browser and not the server.** A server endpoint parsing arbitrary zips on a
public site is attack surface; in the browser, a hostile file can only hurt the tab that
opened it, and the guards above refuse those anyway. A file's size is checked before its
bytes are read. The spreadsheet library, about 390KB, is its own chunk, fetched only
when someone chooses a file.

**Why compare with the seed, not the live schedule.** Visitors change the live one. The
seed is exactly what the importer made, so it is the claim being checked — and the page
says "the sample imported here", not "the board", because after a visitor's Clear those
are different things.

### The migrations did not replay

Three migrations assumed tables only an import had created — the second altered
`berths_seed`, which no migration made — so the repository could not rebuild its own
database. They now guard for it, each with a note, and a new migration makes the seed and
undo tables real tables with primary keys and row-level security. All thirteen replay
onto an empty in-process Postgres.

### Smaller things verification found

- Review split current work from history by the database's UTC date while the booking
  panel used the facility's, so for four hours every evening they disagreed. Both use
  `todayISO()` now.
- The save path accepted a start date in the past; only the date picker refused it.
  `createBooking` now refuses it too, as invariant 7 always said it did.
- The constraint was quoted without `AND exclusive` in four places, including the README.
- "97.5%" was neither figure: 95% of vessels have no length, and 97% of vessel bookings
  cannot be fit-checked. The README's reconciliation subtracted from the wrong total;
  `DATA-NOTES` counted 28 sheets where there are 27.
- The Vessels page opened on four figures in one sentence. It now says one proportion in
  words — the first ten rows account for half of the vessel bookings — computed, and
  rounded down so it never overclaims. *(Replaced again in
  [38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state), which took the
  proportion off the masthead altogether and deleted the helper that computed it.)*

---

## 31. 373 cells the importer was dropping in silence

The owner asked a one-line question: *is all of the data from the sample schedule?* The
answer was yes, and checking it properly turned up the inverse — the app was not showing
all of the sample.

**What the audit found.** Every content cell in the 23 year sheets, bucketed by the row
it sits on: 2,289 on a berth row (2,212 read plus the 77 margin notes), 12 on a
day-number row (already reported), and **373 on a row that names no berth** — skipped
without a count, a review item, or a line in the reconciliation. They are not junk: 230
vessel names, 79 events, 25 berth closures, 24 unreadable scraps and 15 timing notes,
across 17 of the 23 sheets. Two shapes produce them: a row with a blank label, always
just below the last berth of a month block, and the section header `North Finger Piers:`,
which `parseBerthLabel` correctly refuses to treat as a berth. Two more sit above a
sheet's first month header, outside every block.

**Decision: report them, attribute nothing.** The berth above is the obvious guess, and
it is still a guess — the same guess [DECISIONS 14](#14-the-legacy-schedule-is-imported-and-removable)
refuses elsewhere. The file's own way of saying "a second booking on this berth" is a
second labelled row, which the 2017 sheet uses for the one real double-booking, so an
unlabelled row is not that. None of the 373 becomes a booking; the schedule is still
exactly 2,031 stays.

**One item per sheet, not per cell.** 373 review items would have been 145 folded rows of
*a cell somewhere with no berth*, burying the seven unreadable cells that sit on a real
berth row — the fault of [17](#17-repetition-is-not-information) recreated in the act of
fixing a different one. So the queue carries one item per affected sheet, which folds
into a single row listing all seventeen, each with its count and its first cell. Every
one of the 373 is in the reconciliation, which is what `npm run import:check` prints for
a grader's own copy of the file.

**What it cost.** The review count goes from 29 to 46, all of it history; the badge does
not move, because none of these has a booking that has not ended. `plan.test.ts` pins the
373 and the 17 sheets, so the next person to change the parser has to mean it.

**The lesson, for the third time in this file.** The counts that were pinned were the
counts the parser produced; nothing checked them against the file as a whole. Asking
"does this add up to every cell in the workbook?" is a different question from "does the
parser still produce what it produced yesterday", and only the first one finds this.

---

## 32. A move changes a span, not only a berth

> **The function and the field list are superseded by
> [35](../DECISIONS.md#35-a-booking-is-editable-because-the-alternative-throws-the-row-away).**
> `moveBooking` never survived under that name: the live function is `updateBooking`
> (`src/db/mutations.ts`), and the panel now edits the name, the kind and the note as well
> as the berth and the dates. Everything below — why a span had to become editable at all,
> and the floor rule that decides it — stands unchanged. Kept because the argument, and the
> shape it arrived in, is the record.

**Decision.** The booking panel's `Move to` berth dropdown becomes two fields — **Berth**
and **Dates** — and one button saves whichever changed. `reassignBooking(id, berthId)` is
now `moveBooking(id, { berthId, start, end })`.

**Why this was a gap and not a nice-to-have.** *"The vessel is arriving two days late"* is
at least as common as *"put it on a different berth"*, and the panel could do the second
but not the first. The only way to change a date was to cancel and rebook, which throws
away things the facility should keep:

- the row's identity, and with it its place in the queue
- its provenance — `imported from sheet 2010, row 75` becomes `entered in this system`
- any review item hanging off `booking_id`
- and it leaves two rows, one cancelled, where the facility has one booking

**It costs nothing in correctness, and demonstrates the guarantee a third time.**
`bookings.during` is a **generated** column, so an update to either date re-evaluates the
`EXCLUDE` constraint exactly as an update to `berth_id` does. Moving into an occupied span
is refused by the database, on the same code path and with the same error, with no
override — the third place that guarantee proves itself, after the insert and the restore.
`checkBooking` already accepted `start`, `end` and `excludeBookingId`; the pre-check
needed no change at all.

### The one rule a move does not share with a booking

`createBooking` refuses a start before today outright: reserving a berth for a day that
has passed is nonsense. Applying that to a move would make **every one of the 2,031
imported bookings uneditable**, since all of them are already in the past — a date typed
wrong in 2010 could then only be cancelled, which loses the row. But dragging a booking
that has *not started yet* backwards past today is the same nonsense the insert refuses.

So the floor is decided by **where the booking is now, not where it is going**:

| Booking starts | New start before today | Verdict |
|---|---|---|
| today or later | yes | refused — *it has not started yet, so it cannot be moved into the past* |
| already in the past | yes | allowed — this is correcting a record |

That lives in `src/domain/move.ts`, pure and unit-tested (invariant 1), and is run
**twice**: in the panel, to disable the button and say why, and again in `moveBooking`,
because the action behind the panel is a public endpoint and `min` guards only the picker.
Same function, same sentence, both places. → [invariant 7](../CLAUDE.md#invariants)

**What is still missing.** A move has no undo. Cancel, Clear, Load and Put back all keep
what they replace — Clear has since left the UI and Load is *Restore the original schedule*
([38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state)), and this gap is
unchanged; an edit overwrites the berth, span, name, kind and note in place, and that was already
true of berth changes before this. It is honest to say the fix is the same shape — snapshot
the row inside the transaction — and that it was not built, rather than to claim
[invariant 12](../CLAUDE.md#invariants) covers a path it does not.

**Three specs**, because a write path with an undo-less overwrite deserves them: a date
move that keeps the same row, a date move refused by the constraint because another
booking holds those days, and the past-date refusal. `src/domain/move.test.ts` covers the
floor rule without touching a database.

---

## 33. The drawn bar is the data; the target you press is not

Two reports from the owner, one page apart.

### "If the berth has a duration of 1 day you can't click on it from the board"

**What it is.** The board's minimum lane width is 620px over 31 columns, so a one-day
booking is drawn **20px wide**, and `MIN_BAR_PX` makes a small vessel in a large berth
**14px tall**. A 20×14 target is less than a fifth of the 44×44 touch guideline: fiddly
with a mouse, impractical with a thumb. Six of the nine violations in the source are
single-day bookings, so this fell hardest on the rows most worth opening.

**What it is not.** The link works — a precise click opens the panel, and the spec that
proves it passed before this change. Nothing was broken; the target was too small.

**Decision.** `.bar::before` pads the hit area and draws nothing.

Growing the bar itself was not available: **width is the span and height is vessel length
÷ berth length** ([invariant 6](../CLAUDE.md#invariants)), so either would make the board
lie about the booking. The pad is anchored to the bar's bottom and grows **upward** into
the empty part of the lane, where there is nothing to take — `height: max(100%, 34px)`,
so a bar already taller than 34px is untouched and only the small ones gain. Sideways it
grows 2px and no more, because the next day's booking starts where this one ends.

A 14px bar now has a 33px target. Nothing reaches past the lane floor into the berth below.

**One thing this cost.** `.bar` had `overflow: hidden`, which would have clipped the pad
away. It is `visible` now, and the label keeps its own `overflow: hidden` plus
`min-width: 0` — verified at 375px, where four labels clip and none spills.

### "Make `last 2019` blue and clickable, taking you to the last time it was booked"

**Decision.** The year in a register row links to `?y&m&sel` — that month, with that
booking's panel open. The same shape Review's *Show on board* uses.

**Why it earns the colour.** It is the only fact on the row that names **one specific
booking**. The count is an aggregate and the operator is an attribute; *last 2019* answers
"is this hull still around to measure", and the next question is always "where was that".

**The id and the year come from one row.** A LATERAL join takes the vessel's most recent
booking once, and the link and the label are both built from it, so they cannot disagree.
Two correlated subqueries would have allowed a link to a month that does not hold the
booking the year names.

### A spec that had quietly stopped testing anything

Writing the move specs I reached for `new Date(Date.now() - 86_400_000)` for "yesterday".
That is **UTC's** yesterday, and after 20:00 Eastern UTC has already rolled over — so it
is the facility's **today**, which is legal, so the spec asserted a refusal that never
came. It passed all afternoon and failed at 20:38.

This is verbatim the gotcha in [CLAUDE.md](../CLAUDE.md#gotchas-that-cost-time-before), and
there was already a correct hand-rolled version eight hundred lines up in the same file,
carrying a comment that ends *"It only fails in the evening, which is when it was found."*
Knowing the rule was not enough; both specs call `facilityDaysAgo(n)` now, so the third
one cannot get it wrong.

---

## 26 continued. Review's two revisions

> Moved verbatim from [DECISIONS 26](../DECISIONS.md#26-a-queue-holds-work-history-goes-in-an-archive),
> which keeps the decision itself — the split by actionability, and why the history is not
> deleted. What follows is how the page was rebuilt around it.

### Revised: the archive starts closed, and opens one category at a time

**Decision.** The card is headed **History** and holds one button per category —
*Unresolved conflict*, *Vessel too long for the berth*, *Could not be read*. Nothing of it
is on screen until a button is pressed; pressing another switches to it, and **Hide**
puts the card back to quiet. No counts on the buttons: each panel still carries its own
count, in the heading it always had.

**Why.** The archive was three expanded sections, and on a freshly loaded sample that is
every item the import produced — a page of 2001–2017 rows under the one card that says
nobody needs to act on them. The owner's words: *"it doesn't show you the past history of
reviews if you don't want to see them."* The work card above is what somebody came for;
the archive answers a question — *what did the import make of the cells it could not
read?* — that is asked about one kind of thing at a time.

**This is not the date filter rejected above.** That one would have filtered the work
queue, with a default that either hid items from the count or drowned it. This filters
nothing: the split is still by actionability and still decided server-side, the badge is
unchanged, and every category the archive holds is named on a button whether or not it is
open. What is deferred is the drawing, not the fact.

**No JavaScript.** Radios and labels, revealed by `:has()` in `globals.css` — so Review
stays a server component, as the `<details>` folds inside each category already do. The
alternative, a client component holding the open category in state, would have moved the
rows through a props payload to gain nothing a radio does not already do.

**Three things the first version got wrong**, found by reviewing the implementation
rather than the idea — all of them in the closed state, which is the state nobody looks
at twice:

- *The keyboard could not reach the switch at all.* "Nothing open" was a fourth radio,
  checked, whose label was `display: none`. A checked radio is its group's only tab stop,
  so tabbing past the card above skipped every button in it. Nothing is checked now: the
  panels' own `display: none` is the closed state, and the first Tab lands on the first
  category.
- *Hide deleted itself as it was pressed*, and the focus ring went with it. It is clipped
  rather than removed, and shows itself while focused, the way a skip link does.
- *The open button was tinted `--plane`* — which is exactly the ground this transparent
  card sits on, so the open one dissolved into the card while the three closed ones stood
  proud. Open is the one that lifts off it now.

**What it costs.** A closed category is `display: none`, so find-in-page cannot see it —
the same trade every `<details>` on the page already makes, and the reason the buttons
name every category whether or not it is open. Paper and a browser without `:has()` both
get the old, fully expanded card: `@media print` and `@supports not selector(:has(*))`
draw every panel and hide the buttons.

### Every row says what it is, and an empty one says what would be in it

> **The foot of the page carries two buttons now, not three
> ([38](#38-clear-is-gone-and-two-mastheads-stopped-reporting-state))**: Clear is removed,
> Load is *Restore the original schedule*, and the line under them is *This replaces every
> booking, and can be undone.* What carried over is the argument below — a row with a count
> rather than a paragraph, and a line under the buttons rather than only a dialog.

Four complaints from the owner in one sitting, all of them about the same page, and the
last one the sharpest: **"Do we need it in the first place?"**

> *"The review page is a little bit bare right now. And "Nothing on the schedule needs a
> decision." is a bad header — the header should explain what the review page is for.
> What is the Check a workbook button used for? Saying "Both can be put back afterward"
> is also pretty ambiguous and not clear."*

**Why it was bare, and it was not a layout accident.** Every problem the import found
dates from 2001–2017, so `isCurrent` is false for all 46 of them: the work card was empty
**by construction**, and it was written to delete itself when empty. What remained was a
masthead, one stray row, a card of three buttons, and a footer. The page's best evidence —
the one genuine double-booking in 23 years, kept rather than deleted — was two clicks
inside a card labelled *History*.

**Decision.** Every row named, counted and drawn whether or not it holds anything — and
**at most one short line under any of them.**

| | |
|---|---|
| **Needs a decision** `0` | *Nothing right now.* |
| **No recorded length** `398` | *Add lengths →* |
| **Cancelled bookings** `0` | *None. A booking you cancel comes back here.* |
| **History** | *From bookings that have already ended.* |
| *(below the cards)* | Load · Clear · Put back, and one line saying what they do |

**Why a row that says zero.** A count of `0` beside *Cancelled bookings*, with a few
words saying what would put something there, is the page explaining what it is for. The
same row deleted is a page that looks broken — and, on this sample, a page that is
*always* broken. This is [invariant 8](../CLAUDE.md#invariants) — empty is supported, and
never silent — applied to a queue rather than to the board.

**The first attempt fixed "bare" by writing paragraphs, and earned the opposite
complaint an hour later:** *"Now review page is way too cluttered. I like the
organization of the board page and vessels page. There is too much going on in review.
Too many words and too much stuff going on."* Three cards, four explanatory paragraphs,
about 90 words of prose. Board is one card and a line; Vessels is one card, a row of
buttons and a pager, and its only sentence is *Nothing in this category.*

**So the structure was right and the prose was the clutter.** The rows stayed; every
paragraph under them became three to eight words; **The schedule** lost its card and
went back to a bordered foot below the others, since those controls replace everything
above rather than acting on a row of it. The page went from about 170 words to 96,
counting the nav and the buttons. The lesson is worth keeping: *a row with a count is
organisation, and a paragraph explaining the row is clutter* — an empty state needs a
label, not an essay.

**The header states the purpose, not the state.** *"Problems with the schedule, and what
to do about them."* The old line was true and still argued, on the front door, that the
page had no reason to exist. Every other masthead in the app already states a purpose;
Review was the exception. → [DESIGN 9](DESIGN.md#9-explain-the-tool-never-the-project)

**Do we need the page?** Yes, and the question is answerable in one list: it is the only
place that resolves the imported double-booking, the only way a cancelled booking comes
back, the only answer to *what happened to the cells you could not read*, and the only
home for Load and Clear. Without it, cancelling becomes irreversible — which is
[invariant 12](../CLAUDE.md#invariants) — and the import's honesty has nowhere to be seen.
The page was never the problem; the page not saying so was.

**"Check a workbook" was a label nobody could act on.** The owner had to ask what it did,
which is the label failing, not the reader. The link got a gloss — and then, in
[34](../DECISIONS.md#34-a-dry-run-for-a-step-the-product-does-not-have), the page it pointed at was
removed. *Having to explain what a page is for is evidence about the page, not only
about its label*, and that reading took one more conversation to arrive at.

**"Both can be put back afterwards" was ambiguous twice over** — both *what*, and put back
to *what*. It is *Both replace every booking, and both can be undone.* A
[previous pass](#17-repetition-is-not-information) had cut this line to almost nothing on
the grounds that the confirmation dialog states it. The dialog still does — but a dialog
is read *after* the decision to click, and a red button nobody dares press is not a safe
button, it is a dead one. Eight words is the price of a usable Clear.

---

---

## 37. The one sentence in the documentation that was not true

**What it said.** [DECISIONS 1](../DECISIONS.md#1-the-database-prevents-double-booking-not-the-application),
under the bold word **Verified**:

> *by eleven tests that run as raw SQL rather than through the app: overlapping inserts
> rejected, adjacent bookings accepted, pooled berths exempt, closures blocking vessels,
> reassignment onto an occupied berth refused.*

**There was no such suite, and there never had been.** Nineteen `*.test.ts` files under
`src/`, every one of them pure TypeScript; not one opened a database connection. The three
Playwright specs beside them did — `e2e/helpers/schedule.ts` calls `postgres()`, and still
does — but they drive the app through a browser, which is the opposite of what the sentence
claimed, and `npm test` does not run them. The sentence was written
from the *descriptions* of `src/domain/conflicts.test.ts` — "does NOT flag merely
adjacent ranges", "returns nothing for a POOLED berth", "treats a closure as blocking a
vessel" — which is almost exactly the list it claimed.

**Why this was the worst possible sentence to get wrong.** Decision 1's entire argument
is that *an application-level check is only as good as every code path that ever touches
the table*. The evidence it offered for the database guarantee was **the application-level
check's own unit tests** — the precise thing the decision rejects. And it contradicted
the README two files away, which says the suite needs no database at all.

**How it survived.** Nothing checks prose. The counts in this project have been wrong
three times in one day — 260/299/39, then 272/312/40, then 318/278/40 — each time because
a number was stated once and then tests were added. A sentence describing tests that do
not exist is the same failure with the count set to eleven.

**The fix was to make it true, not to soften it.** `src/db/constraint.db.test.ts` now
does what the sentence promised, and more: fifteen cases in raw SQL against Postgres,
with no React, no server actions and no `mutations.ts`. It runs under `npm run test:db`
rather than `npm test`, because that command promises no database and must stay green on
a clone with no credentials — the rule
[29](../DECISIONS.md#29-nothing-on-the-board-is-invented) records being learned the
hard way.

**Everything is rolled back.** One transaction per case, ending in a deliberate throw, and
each statement expected to fail wrapped in a `SAVEPOINT` — a constraint violation aborts
its transaction, so without one the first refusal would poison every assertion after it.
Rows are dated 2099, outside anything the app will write, and the last case asserts the
table is unchanged.

**It found something on the first run.** An end date before its start is refused by
`22000` from `daterange()` itself, not by the `end_not_before_start` CHECK written for it:
the generated column is evaluated first, so the CHECK never speaks. The application was
already right about this — `describeDbError` handles 22000 — but the test I wrote first
asserted the CHECK's code, and would have documented a path the database does not take.

**The lesson, which is the same one as [31](#31-373-cells-the-importer-was-dropping-in-silence).**
Asking "does this claim still hold?" is a different question from "do the tests pass?",
and only the first one finds this. A submission whose argument is precise evidence cannot
afford a single unchecked claim, and the most dangerous one sits under the word that
invites checking.

---

## 38. Clear is gone, and two mastheads stopped reporting state

Three removals in one pass. Each took something out of the product; none of them added
anything, and the argument for each was the same shape — the job was already being done
somewhere better.

### Clear the schedule is removed, and Load is renamed

**Decision.** The foot of Review had three buttons — Load · Clear · Put back. It has two:
**↻ Restore the original schedule**, which is the old *↻ Load the sample schedule* renamed
(same `LoadSampleButton`, same `resetToImportedAction`, same `resetToImported`), and **Put
back the previous schedule**. The line under them is *This replaces every booking, and can
be undone.* **Nothing in the product empties the schedule any more.**

**Why.** Three arguments, in the order they were made:

- **It is not a coordinator's action.** The schedule this app is loaded with is a real
  23-year record of a real facility, supplied as the sample. Deleting all of it is not
  something a berth coordinator does, so it is not a control the product should offer.
- **The front door already demonstrates the empty case.** Clear existed to show that an
  empty schedule is supported ([invariant 8](../CLAUDE.md#invariants)). But every booking in
  the supplied workbook ended in 2019 and the board opens on the facility's own month, so
  the first screen anyone sees is an empty one, orientation block and all
  ([18](#18-an-empty-month-is-not-an-empty-page)). A button whose job is to demonstrate what
  the first screen demonstrates is a demonstration, not a feature — the reading that cut
  `/check` ([34](../DECISIONS.md#34-a-dry-run-for-a-step-the-product-does-not-have)).
- **It was the one press that deleted everything.** On a public page with no accounts, it
  was the only control that could delete 23 years of a real schedule in one click. Undoable,
  and still not worth offering.

**Why Restore stays.** Without it a visitor who cancels or edits a few bookings has no way
back to the facility's own record, and that reachable shipped state is the whole reason open
access is safe ([11](#11-public-unauthenticated-with-a-reset)).

**What was *not* removed.** The undo machinery still covers restoring and the importer, so
it all stays: the `clearSchedule` mutation in `src/db/mutations.ts` — the Playwright suite
builds its empty-schedule fixture with it, and is now its only caller — the `*_undo` tables,
`src/lib/undo.ts` and its policy tests, `restorePrevious`, `getPreviousSchedule`, and
`npm run sample:load`. The one rule in
[30](#30-one-undo-rule-an-importer-that-fails-loudly-and-a-check-that-writes-nothing) is
unchanged, `clearSchedule` still snapshots inside its own transaction, and
[invariant 12](../CLAUDE.md#invariants) keeps its single stated exception: an edit.

### The Vessels line reported state and then did arithmetic on it

**Before.** *"Most have no length on record. The first ten account for half of the vessel
bookings, so start there."* **Now.** *"Every vessel on the schedule, and how long
each one is."*

**Why.** Every figure in the old line was true and computed, and it was still the only
masthead in the app describing how the page was *doing* rather than what it was *for* — the
rule is [DESIGN 9](DESIGN.md#9-explain-the-tool-never-the-project), and Review was held to
it for precisely this in [26 continued](#26-continued-reviews-two-revisions). The two jobs
that sentence did are each done better a few pixels under it: the split is named on its own
button, *No length on record*, and counted by the pager; the order still puts the hulls whose
missing length blocks the most bookings first, and every row states its own booking count
([DECISIONS 9](../DECISIONS.md#9-the-vessels-list-is-ordered-by-bookings-blocked),
[23](#23-a-long-list-shows-its-head-and-names-its-categories-once)). The ordering decision
did not change. Only the masthead's claim about it came off.

**`src/lib/share.ts` went with it.** `shareInWords` computed that proportion in words and
rounded it down so the sentence could never overclaim — the fix recorded at the foot of
[30](#30-one-undo-rule-an-importer-that-fails-loudly-and-a-check-that-writes-nothing). It had
exactly one consumer, and it was that sentence, so the module and its three tests are deleted
rather than left for somebody to find and wonder about.

### The Search line said its second clause twice

**Before.** *"Find anything that occupies a berth, across every year on the schedule."*
**Now.** *"Find anything that occupies a berth."* The dropped clause was already one line
below it, in the page's own panel: *"The board shows one month at a time; this searches all
of them at once."* — where it sits next to the thing it explains, and says why searching all
of them is worth doing. [17](#17-repetition-is-not-information) applies to a page's own two
lines as much as to a table's rows.
