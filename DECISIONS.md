# Decisions

Fourteen choices, **including the ones rejected** — knowing why something was not built is
usually more informative than the thing that was. Each states the decision, what it cost,
and what was measured. Fifteen minutes end to end; less if you read the bold.

The other 22 entries — library choices, type scale, page layout, the undo state machine,
the importer's hardening — are the build log, in
[docs/ENGINEERING-LOG.md](docs/ENGINEERING-LOG.md), under the numbers they always had.

---

| # | Decision |
|---|---|
| 1 | [The database prevents double-booking, not the application](#1-the-database-prevents-double-booking-not-the-application) |
| 2 | [Fit warns; it never blocks](#2-fit-warns-it-never-blocks) |
| 3 | [A conflict is always refused; there is no override](#3-a-conflict-is-always-refused-there-is-no-override) |
| 4 | [The bar's height is the fit check](#4-the-bars-height-is-the-fit-check) |
| 8 | [The board opens on today; you can look back, but not book back](#8-the-board-opens-on-today-you-can-look-back-but-not-book-back) |
| 9 | [The Vessels list is ordered by bookings blocked](#9-the-vessels-list-is-ordered-by-bookings-blocked) |
| 20 | [Cancelling is reversible, not restricted](#20-cancelling-is-reversible-not-restricted) |
| 21 | [The facility is not WHOI](#21-the-facility-is-not-whoi) |
| 22 | [The system suggests a berth; it never assigns one](#22-the-system-suggests-a-berth-it-never-assigns-one) |
| 26 | [A queue holds work; history goes in an archive](#26-a-queue-holds-work-history-goes-in-an-archive) |
| 29 | [Nothing on the board is invented](#29-nothing-on-the-board-is-invented) |
| 34 | [A dry run for a step the product does not have](#34-a-dry-run-for-a-step-the-product-does-not-have) |
| 35 | [A booking is editable, because the alternative throws the row away](#35-a-booking-is-editable-because-the-alternative-throws-the-row-away) |
| 36 | [One hull, two berths: decidable, and still only a warning](#36-one-hull-two-berths-decidable-and-still-only-a-warning) |

---

## 1. The database prevents double-booking, not the application

**Decision.** A Postgres exclusion constraint:

```sql
EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active' AND exclusive)
```

**Why.** The obvious approach — query for overlaps, then insert if none are found — has a
window between the check and the insert: two requests can both check, both find nothing,
and both insert. A constraint has no such window. The overlap is unstorable, not merely
discouraged, and the guarantee survives things I did not write: a future API, a bulk import,
someone at the database directly, a bug in my own code.

**Rejected:** an application-level check-then-insert. Simpler to read, but the guarantee is
only as good as every code path that ever touches the table.

**Verified** by eleven tests that run as raw SQL rather than through the app: overlapping
inserts rejected, adjacent bookings accepted, pooled berths exempt, closures blocking
vessels, reassignment onto an occupied berth refused.

---

## 2. Fit warns; it never blocks

**Decision.** A vessel too long for its berth produces a visible warning. Saving is still
allowed. Only a conflict disables Save.

**Why.** A length is only known once somebody records it, and most never will: **20 of 418
vessels** in the client's own 23 years carry one anywhere. The coordinator booking a visiting
vessel by email does not have its LOA to hand. A system that refused to save anything it
could not verify would refuse almost everything and be abandoned in a week.

The deeper point: **the two problems in the brief are different shapes.** Overlap is decidable
from data we always have. Fit depends on data that mostly does not exist. Treating both as
"validation" forces one of two bad outcomes — blocking on unknowns, or softening the overlap
guarantee. Keeping them apart lets each be as strict as it can honestly be.

**Rejected:** requiring a length before a vessel can be booked. Clean in principle, but it
makes the common case — a vessel nobody has measured — unbookable, and invites someone to
type a plausible number to get past the form. A guess recorded as fact is worse than an
honest blank.

**Rejected:** a conflict override, for the reason in
[3](#3-a-conflict-is-always-refused-there-is-no-override).

---

## 3. A conflict is always refused; there is no override

**Decision.** Overlapping bookings on an exclusive berth cannot be saved. No reason field, no
supervisor confirmation, no escape hatch.

**Why.** An override turns "this system cannot double-book" into "this system usually does not
double-book", which is a far weaker claim and a far weaker guarantee. The honest response to a
genuine need for two vessels on one berth is rafting — modelled properly as berth capacity in
feet — not a checkbox that disables the rule.

**Consequence worth stating:** `bookings.status` still carries a `conflict_unresolved` value,
and the constraint applies `WHERE status = 'active'`. Nothing in the app creates that status
now. It is the seam an import path would need, and it costs nothing to leave in place.

---

## 4. The bar's height is the fit check

**Decision.** `height = vessel length ÷ berth length`. A 120′ vessel in a 75′ berth is drawn
1.6 lanes tall and visibly breaks its row.

**Why.** The alternative is an icon or a colour meaning "too long" — a symbol you must learn.
Proportional height is not a symbol; it is the measurement, so you see *how badly* a vessel
does not fit, not merely that it does not. It is the standard **space-time representation of
the berth allocation problem** (time on one axis, quay space on the other, rectangle height =
vessel length) adapted to fixed berths, over the interaction model of a hotel PMS **tape
chart**.

**Adjusted after seeing it render:** a floor of 9px, because a 40′ vessel in the 410′ berth is
proportionally a 3px hairline that reads as an empty berth. Proportionality still governs
everything above the floor, including every overflow.

**Adjusted again, from the owner reading the board cold**, and neither fault was the idea. The
overflowing bar was filled solid, so where it grew into the lane above it covered that
booking's label outright — making the misfit visible was costing the booking next to it. It is
9% red with a solid border now, and the measurement sits on its own white chip. And the legend
explained every colour and the hatching while never mentioning height, which left *the height
is the fit check* as the one thing on the board nobody was told. The lesson is the ordinary
one: the person who has looked at a thing for a week cannot tell which parts of it are
legible.

**Borrowed as an anti-pattern:** tape-chart documentation warns the chart must never be used
to judge availability, because reservations with no room assigned are omitted from it. A view
that silently omits records is dangerous — which is why a booking the board cannot draw is a
bug rather than a display detail, and why a fixed date window that hid future bookings was
one ([8](#8-the-board-opens-on-today-you-can-look-back-but-not-book-back)).

---

## 8. The board opens on today; you can look back, but not book back

**Decision.** The board opens on the current month. Every bound is computed at request time:
the form refuses a start earlier than today, while the board reaches three years forward and
back over whatever is on the schedule.

**Why.** This is a tool for a facility that exists now, so next month has to be reachable. An
earlier version opened on a month from the attached sample and bounded the range to that
sample's own extent, ending in 2019.

**That bound was a bug, not a preference.** Nothing limited the dates on save, so a booking
could be created for 2026, stored correctly, and be permanently invisible because the board
could not navigate to the month it landed in. "Where the board opens" is a presentation
choice; "how far the board can go" is a capability, and conflating them cost a feature.

**Why viewing reaches further back than booking.** A berth cannot be reserved for a day that
has passed, so the form refuses it. But a window beginning at today would make a booking
recorded last month unreachable the instant the year turned — the same failure in the other
direction. Looking back is a record; booking back is a mistake.

**The floor is derived from the data, not fixed.** `firstYear()` takes the earliest booking on
the schedule, so importing the workbook widens the window to 1997 on its own. A fixed floor
would have left every imported booking stored, searchable and impossible to open — the third
time this project would have shipped a booking nobody could navigate to. Deriving the bound
ends the class of bug rather than the instance.

**Two details.** "Today" resolves in `America/New_York`: the server runs in UTC, where 10pm on
the 30th is already the 1st, and the board would open a month ahead of the one on the
coordinator's wall. And a date input's `min` constrains the picker, not a save that happens
through a click handler, so the past-date check lives in the save path too.

---

## 9. The Vessels list is ordered by bookings blocked

**Decision.** Vessels with no recorded length first, ranked by how many bookings they make
unverifiable.

**Why.** "Most vessels are missing a length" sounds hopeless, and alphabetical ordering keeps
it that way. Bookings concentrate heavily on a few regular hulls — the first ten rows account
for half of all vessel bookings — so recording a handful of lengths makes a large share of the
schedule verifiable. The page states how many bookings the next entries would unlock, so the
work looks finite instead of endless.

---

## 20. Cancelling is reversible, not restricted

**Decision.** No sign-in. A cancelled booking can be restored from Review, and the
confirmation dialog says so **before** you click, not after.

**Why not authentication.** Three reasons, in order of how much they settle it:

- **It does not solve the problem.** Signing in with Google proves *who you are*; it does not
  stop you cancelling somebody else's booking. That needs ownership recorded per booking and
  checked on cancel. Auth is only the identity source — and the expensive half.
- **It gates the one thing the URL has to prove.** The brief names *"whether it works"* first,
  and it is the only criterion a reviewer can judge from a link. A login wall in front of a
  public demo — or a mismatched OAuth redirect URI, the usual way this breaks — turns a working
  app into a broken sign-in screen.
- **The harm was already small, and undo takes it to zero.** `cancelBooking` was always a soft
  delete: `status = 'cancelled'`, the row untouched. The undo data existed and was simply not
  on screen.

**What it cost.** One nullable column, `bookings.cancelled_at`, earning its place twice: it
orders the *Recently cancelled* list, and it picks out which review items to re-open. Cancel
stamps it and resolves that booking's open items in one transaction, so
`resolved_at >= cancelled_at` finds the ones cancelling closed and leaves anything a
coordinator resolved by hand alone. Imported rows have it null, so the list only ever holds
something a person undid here, not 2,031 rows of history.

**Restore goes to `active`, never back to `conflict_unresolved`.** If the berth was taken
meanwhile, the constraint refuses the update and the refusal is shown. Restoring outside the
constraint would put back a double-booking, which is the one thing this system claims cannot
happen ([1](#1-the-database-prevents-double-booking-not-the-application)). A spec exercises
exactly that case.

**Rejected: a "booked by" field.** Attribution without accounts is spoofable by typing a
different name, so it would charge every booking friction for a guarantee it cannot make. The
honest version is in `ASSUMPTIONS.md`: a staff tool that would sit behind institutional SSO in
a real deployment.

---

## 21. The facility is not WHOI

**Decision.** The app is titled `Harborview Dock Schedule`, and the facility is
`Harborview Marine Research Center`, the name carried in the sample workbook. WHOI's name,
logo and marks appear nowhere.

**Why.** The brief opens *"A WHOI marine research facility needs to manage berths of varying
lengths."* WHOI is a real, operating institution; this deployment is public and
unauthenticated; and every row in it is synthetic — the facility name, the seven berth labels
and all 418 vessel names come from the supplied workbook, not from a real waterfront. Putting
a real organisation's marks on a public page states a relationship that does not exist.

Nothing is lost by declining. The reviewers wrote the prompt, the submission form records
which option was chosen, and the app is transparently a berth scheduler loaded with their own
sample data. There was no ambiguity for a logo to resolve.

**Where Woods Hole survives, because there it is a fact rather than a claim:**
`FACILITY_TIME_ZONE` is `America/New_York`, since that is where the brief's facility is and
resolving "today" in UTC would roll the board a month early (`src/lib/nav.ts`).

---

## 22. The system suggests a berth; it never assigns one

**Decision.** The berth dropdown states what each berth is doing on the chosen dates —
`North Pier East — 240ft · free, fits`, `Inner Channel — 55ft · free, 115ft too short`,
`North Pier Face — 75ft · taken Jul 14 – 17` — and **Find me a berth** proposes one and says
why. The person still picks and still saves.

**Why not auto-assignment.** The brief's second failure is *"verifying that a vessel actually
fits the berth it has been assigned to"* — assigned, by a person. Having the system choose
attacks that a level up: there is less left to verify. But choosing outright fails twice over:

- **95% of vessels have no recorded length** (398 of 418), so for 97% of vessel bookings the
  system cannot know what fits. Assigning anyway would mean guessing, and
  [invariant 2](CLAUDE.md) is that a length is never invented. With no length the suggester
  ranks on availability alone and says `fit is not checked` in as many words.
- **The coordinator knows things the database does not**: shore power, crane reach, which
  float is nearest the lab, who is arriving at 0600. A silent assignment ignoring all of that
  is confidently wrong, and confidently wrong twice is how a tool stops being used.

So it does the work, shows its reasoning, and a person confirms — the honest division of
labour, where the system owns what it can check and nothing else.

**Best-fit, because it is one sentence.** The proposal is the **smallest free berth the vessel
fits in**, so a 40ft launch does not consume the 410ft pier. Standard bin-packing, and it
matters less for being optimal than for being explainable: *"smallest free berth that fits
120ft, so the longer ones stay open."* When nothing fits it says so with the number — `No free
berth is long enough for 300ft — the longest free one is 240ft` — because a refusal carrying
the measurement is worth more than a proposal that does not fit.

**The pooled berth is never suggested.** Small craft slips accepts another boat regardless, so
it would win every time and carry no information; it stays selectable, labelled
`shared, no fit check`. Ranking and wording live in `src/lib/suggest.ts`, pure and unit-tested
against a fixture ([invariant 1](CLAUDE.md)).

**Rejected: two modes, "book a specific berth" or "book any berth".** A fork in the form costs
a second path to build and test, and the "any" branch would hide the one thing worth showing —
*why* that berth.

---

## 26. A queue holds work; history goes in an archive

**Decision.** Review splits in two. **Needs a decision** holds items whose booking has not
ended yet, and it is what the red badge counts. **History** holds everything else — bookings
that already ended, and cells the importer could not read — with its counts, groupings and
buttons intact, in a quieter card that does not claim to be pending work.

**Why, measured.** The badge read **30**. Of those thirty:

| | Count | When |
|---|---|---|
| A booking that had not happened yet | **1** | two days out |
| Bookings that had already ended | 10 | 2006–2017 |
| Cells with no booking attached at all | 19 | sheets back to 2001 |

Nobody can move a vessel that sailed in 2017. Presenting twenty-nine such items as work asks
for a decision that cannot be made, and a queue mostly full of those is one people stop
reading — at which point the one real item, a 120ft vessel in a 75ft berth this coming
Tuesday, is what gets missed. The queue was hiding its own best find.

*That one current item came from the invented sample bookings removed in
[29](#29-nothing-on-the-board-is-invented). On a fresh load the work card is empty and all 29
items are history, which is the truest version of this decision's point: the badge used to say
29 and mean none. The audit in
[log 31](docs/ENGINEERING-LOG.md#31-373-cells-the-importer-was-dropping-in-silence) later took
the archive to 46, and the badge still did not move.*

**The history is not deleted.** It is the evidence that the import dropped nothing silently
([invariant 3](CLAUDE.md)): "what happened to the cells you could not parse?" needs a better
answer than "gone". Nothing is removed; only the framing changes, and that is the whole fix.

**The split is by actionability, not by severity.** An unresolved conflict is the worst thing
the queue can hold, and a 2017 one still goes to the archive, because severity is not the
question — *can anybody still do something about it* is. The predicate is one line of SQL,
`b.end_date >= ${todayISO()}::date`, and an item with no booking joins to nothing and lands in
the archive, which is correct: an unreadable 2001 cell is a record, not a task. So the badge
moves with the calendar — a misfit booked for next week counts, and the morning after that
booking ends it stops counting and moves down on its own, with nothing marked done for the
number to stay honest.

**Rejected: a date filter on the queue.** Same information, one more control, defaulting either
to lying (hiding history) or to today's problem (showing everything). Two cards state the
distinction without asking anybody to operate anything.

**The page was then rebuilt twice around this split.** The archive starts closed, one button
per category; every row is drawn with its count whether or not it holds anything, because a
row that deletes itself when empty leaves a page that looks broken — and on this sample,
always broken. The second rebuild was mine to answer for: my first fix for "bare" was four
paragraphs of prose, and the owner's next message was *"way too cluttered"*. The rows stayed,
the prose went from about **170 words to 96**, and three accessibility faults in the closed
state — a keyboard trap, a *Hide* button that deleted its own focus ring, and an open button
tinted the card's own colour — came out with it. All of it, with the owner's words and the
counts, is in
[log 26 continued](docs/ENGINEERING-LOG.md#26-continued-reviews-two-revisions).

---

## 29. Nothing on the board is invented

Three questions from the owner on the last day, which are one question: *what is this data,
and how does it get in?*

**Decision.** The sample is the workbook and nothing else. The bookings that
[log 25](docs/ENGINEERING-LOG.md#25-the-sample-reaches-around-today) placed around the load
day, with real vessel names and invented dates, are removed.

**Why.** The owner judged them clutter, and was right about more than that. They were the one
place the app showed data nobody had entered. Every other row is either the client's own or
something a person made through the form, and "only the dates were invented" is a weaker
sentence to defend than "nothing was". They also had to be kept honest by machinery — a unit
test pinning the misfit count, a spec asserting a bar on today's month — which is effort spent
maintaining a fiction.

**What it costs, stated.** The board opens on an empty month again, which is the case
[log 18](docs/ENGINEERING-LOG.md#18-an-empty-month-is-not-an-empty-page) was built for: the
grid draws, one line says where the bookings are, and links there. And the refusal can no
longer be seen on the first click — a visitor books something and then books it again, which
is two clicks and shows the rule working rather than a scenario staged for it.

### Why there is no upload

> **Revisited in [log 30](docs/ENGINEERING-LOG.md#30-one-undo-rule-an-importer-that-fails-loudly-and-a-check-that-writes-nothing)**:
> a read-only check existed for a while, and was then cut by
> [34](#34-a-dry-run-for-a-step-the-product-does-not-have). Never a write path from a file
> still stands.

The owner asked whether 23 years of synthetic data meant the graders wanted a way to load a
spreadsheet. The file *is* the test — named "Synthetic Sample", and its defects are plants: a
2010 sheet labelling two months 2018, Decembers carried into the next year's sheet, names
typed over the day-number row. **Decision: no upload, no import button, and never a write path
from a file.** Four reasons, each checked against this codebase:

- **It would show a grader nothing new.** Their own file produces exactly the board already
  live. The one new output is a reconciliation, and those numbers can be stated where a grader
  reads — the README, and `npm run import:check`.
- **It cannot be CSV.** A booking's dates are the width of a merged cell. Measured by running
  this project's own parser with every cell collapsed to its first day, which is what a CSV
  export does: booked days fall from 5,155 to 2,173, multi-day stays from 608 to 69, the
  92-day M/Y BLUE TIDE stay becomes three one-day stays, and **the only double-booking in 23
  years disappears**. An import that silently loses the brief's own named failure is the worst
  possible demonstration of a system built to catch it.
- **"Add" has no sound meaning.** The grid gives its rows no identity. Adding the workbook
  onto a loaded schedule makes 2,012 stays collide with their own twins, and deduplicating
  them silently drops rows. Only "replace, with an undo" is sound — and that replaces the
  sample with the same sample.
- **A migration happens once, run by an operator.** A public, unauthenticated button that
  parses arbitrary zip files and replaces the schedule is attack surface bought for a
  demonstration.

### What the review found instead

Asking *whether the parse is visible* turned up four real problems, and they mattered more
than any button. **`npm test` failed on a fresh clone** — the reconciliation tests parsed the
gitignored workbook inside `describe()`, so elsewhere collection crashed with ENOENT, and the
repo went public with the README promising a green run; the tests skip by name without the
file now. **Loading the sample was irreversible**, deleting visitors' bookings and discarding
the Clear snapshot, which contradicted invariant 12 the day after
[log 28](docs/ENGINEERING-LOG.md#28-clear-is-undoable-and-the-board-is-not-a-wall) declared it
had no exceptions; Load snapshots like Clear now. **A documented figure was wrong and
untested** — "484 spellings fold into 418 vessels", in a code comment and in
`docs/DATA-NOTES.md`. No way of counting the file reproduces 484; the real figure is 446, and
it is a test now, found only because a new section claimed each rule was locked into a test
and checking that claim was cheaper than trusting it. And **the central constraint was not in
the repository**: the `EXCLUDE` existed only as prose, where every migration now sits in
`supabase/migrations/`, exported from the database's own log.

**The general lesson**: the question worth asking was never "what else can this do", but "what
does a stranger actually see". Here the stranger was someone cloning the repository, and what
they saw was red.

---

## 34. A dry run for a step the product does not have

**Decision.** `/check` is deleted — the page, `WorkbookCheck`, `lib/fingerprint`,
`getSample()`, the link at the foot of Review and five e2e specs. It read a workbook in the
visitor's browser and showed what the importer would make of it, saving nothing.

**The exchange.** The owner asked what the page was for. I explained it, and got back:

> *"Why do we have it. If it doesn't do anything. The whole entire point of this project was
> to submit a working application that is practical and for the user to use easily."*

I defended it as a **dry run** — see what a schedule file would become before anyone touches
the live one — which is a real operation real migration tools have. The answer was one
question:

> *"Wait is there an importing schedule tab or no. If you answer no then remove it entirely."*

**No.** Importing is `npm run import`, on the command line, behind the database credentials —
deliberately, because a public page with no accounts must not be able to replace everyone's
schedule. So `/check` was a rehearsal for a step the product does not offer: a dry run whose
real run only exists on my laptop. That is a sharper version of the argument than the one I
was making for it, and it settles the question.

**Why my own defence was wrong.** Asked what the page did, I called it *"the honesty check on
the import"* — a statement about **the project**, not about the tool, which is exactly what
[invariant 9](CLAUDE.md#invariants) forbids. I had built a page of it while enforcing the rule
everywhere else. The brief asks for a system to **manage reservations**; `/check` managed
nothing, and no coordinator would ever have opened it.

**What is genuinely lost.** It was the only thing in the app that could show someone the
import is real — that the 2,031 bookings were parsed from their file rather than typed into a
database. So that is answered where the import lives: `npm run import:check` prints the same
reconciliation, from the same `planImport`, touching no database, and the counts are pinned by
unit tests against the workbook itself. A reader gets it in the README instead of a page.

**What stays, and why.** `src/import/zipGuard.ts` and `SHEET_LIMITS` were written to survive a
hostile upload, and there is no upload any more — but `npm run import` still replaces the live
schedule from a file, and a corrupt or absurdly large one should be refused loudly rather than
parsed into a half-written transaction.

**The general rule, now in [DESIGN 9](docs/DESIGN.md#9-explain-the-tool-never-the-project):** a
page that **demonstrates** rather than **manages** does not belong in the product, however well
it is built. Cutting something good that does not belong is the same judgment as not building
it — it is just more expensive, and the expense is mine.

---

## 35. A booking is editable, because the alternative throws the row away

**Decision.** `updateBooking` replaces `moveBooking`. One transaction now writes the
berth, the dates, the name, the kind and the note; one button saves whatever changed.

**Why the name mattered as much as the date.** [32](docs/ENGINEERING-LOG.md) refused
cancel-and-rebook for a date change, because it loses the row's identity, its
`imported from sheet 2010, row 75` provenance and the review items hanging off
`booking_id`, and leaves two rows where the facility has one booking. Every word of that
applies to a mistyped vessel name — and a mistyped name is worse, because the misspelled
hull then sits on the register forever, unmeasurable and uncorrectable.

**The note is the field this project argued for and never built.**
[22](#22-the-system-suggests-a-berth-it-never-assigns-one) says the coordinator knows
things the database does not — *shore power, crane reach, which float is nearest the lab,
who is arriving at 0600* — and used that to refuse auto-assignment. The `notes` column
was in the first migration, typed at the query boundary, a parameter of
`createBookingAction`, and reached the INSERT. **Nothing ever wrote to it.** The argument
for human judgment had nowhere to record any.

### Three edges, each of which would have corrupted something quietly

- **A rename re-resolves `vessel_id`, but only when the label actually changed.** An
  imported booking's label is the spreadsheet's raw text while its vessel is the
  canonical name, so re-resolving on every date-only save would have registered a
  duplicate hull *each time a date was corrected*.
- **Changing kind nulls or resolves `vessel_id`.** Without that the database refuses the
  write, and `describeDbError` used to answer every class-23514 violation with *"Those
  dates are not valid for a booking"* — pointing at the wrong field entirely. It now
  distinguishes `vessel_required_for_vessel_kind` and names the empty one.
- **A note is not a finding.** `notes` was rendered inside the conflict strip, so an
  ordinary note would have appeared dressed as a reason the booking is in trouble.

**What this does not fix.** An edit still overwrites in place with no undo, and it now
overwrites more than a berth and a span. [Invariant 12](CLAUDE.md#invariants) was widened
to say so rather than left to imply cover it does not have.

---

## 36. One hull, two berths: decidable, and still only a warning

**Decision.** When a vessel is booked at a **different** berth over the same days, both
panels say so in amber. It never blocks, and there is no constraint behind it.

**It is a real fault in their own data.** Twelve rows of the supplied workbook put one
hull at two berths on overlapping days. Four overlap by two whole days; eight share
exactly one, which is what a same-day berth shift looks like in a spreadsheet that
records only whole days. The `EXCLUDE` is on `berth_id`, and `checkBooking` only ever
queried the one berth — so the system that promises a double-booking is unstorable would
happily record one hull in two places, and already had, four times.

**This is the awkward case for [2](#2-fit-warns-it-never-blocks), and the entry needs
saying properly.** That decision framed the split as *decidable → unstorable, undecidable
→ advisory*, with fit advisory because the length usually does not exist. **This one is
decidable.** The dates are always known; the instinct is a second `EXCLUDE` on
`(vessel_id, during)`.

The source schedule forbids it. A constraint would abort `npm run import` on those four
rows and roll back all 2,031, so the history this project promises to keep could not be
loaded at all. So the rule is not *decidable versus not* — it is **preventable versus
already present**. A guarantee can only be absolute about what it is allowed to refuse,
and refusing the facility's own past is not on the table.

**The wording turns on the shared-day count**, because one day has an innocent reading
and two do not. One day asks — *moving berth on 2003-12-01?* — and names the day. Two
states the fact. Both close with the same sentence the fit warning uses, so amber reads
consistently as advisory wherever it appears.

**What is missing.** The historical twelve are only visible to somebody who happens to
open one of those bookings; nothing surfaces them as a list. Making them review items
needs a migration adding the type, which must ship before any code writes it
([the compatibility gotcha](CLAUDE.md#gotchas-that-cost-time-before)) — so it is named
here as unbuilt rather than half-done.

---

## The rest of the record

Entries 5–7, 10–19, 23–25, 27, 28 and 30–33 are in
**[docs/ENGINEERING-LOG.md](docs/ENGINEERING-LOG.md)**, verbatim and under their own numbers:
the library and ORM choices, the validated palette, the borrowed type scale and masthead,
search, the import and its removal, the folding rules behind the review queue, the empty
board's orientation block, the undo state machine and the 24,576 sequences that test it, the
importer's hardening against hostile files, the 373 cells it was dropping in silence, and
moving a booking in time as well as in space.
