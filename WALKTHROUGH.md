# Walkthrough

Written for the project owner, not for a reviewer. It is what you would say if asked to
explain this out loud. Nothing here is in the product — the app is a tool, not a document
about itself.

---

## The 30-second version

> A marine research facility books vessels onto berths for ranges of days, and also runs
> events like community sail days that take a berth too. Two things go wrong today: they
> catch double-bookings by eye on a grid, and nobody checks whether a vessel actually
> fits the berth it is assigned.
>
> Those two problems look the same and are not, and the whole design comes from keeping
> them apart. **A double-booking is decidable** — you always know the dates — so I made
> it *unstorable*: a Postgres exclusion constraint refuses the write. **A vessel not
> fitting is not decidable**, because a vessel's length is only known once somebody
> records it. So that one warns and never blocks.
>
> One is a wall. The other is advice. Treating them the same would either block people on
> data they do not have, or weaken the guarantee on the one thing I can actually promise.

---

## The four questions you are most likely to get

### "Why is the conflict check in the database instead of the application?"

> Checking in application code has a race: two requests both ask "is this berth free",
> both get yes, and both write. That is the same failure the facility has today, with two
> people reading one grid. A constraint has no gap between the check and the write.
>
> Three beats: **the race → the constraint → what it cost.** What it cost was the ORM —
> you cannot express an exclusion constraint in one, so the schema is plain SQL.

### "Why does the size check only warn, if that is the thing that is actually broken?"

> Because the data to check it usually does not exist. A coordinator booking a visiting
> vessel by email does not have its length to hand. If the system refused to save
> anything it could not verify, it would refuse almost everything and be abandoned.
>
> So the fit check warns, the bar is drawn hatched when the length is unknown, and the
> Vessels tab is ordered by how many bookings each missing length blocks — so the gap
> closes through normal use instead of through a data-entry project.

### "What was the hardest part?"

> Noticing what was wrong when everything passed. Twice the app was fully tested and
> deployed and still wrong in a way no test caught.
>
> The schedule could not reach past 2019, because I had let "where the board opens"
> harden into "how far the board can go" — and nothing bounded the dates on save, so a
> booking for next year would store correctly and then be invisible forever.
>
> And once the app started with an empty schedule, the booking form turned out to refuse
> any vessel it did not already know, telling you to add it on a tab that cannot add
> vessels. With no vessels on the register, no vessel booking could be created at all.
> Both bugs were invisible while there was data sitting in the database.

### "What would you do next?"

> **Rafting** — two vessels legitimately sharing one berth happens, and modelling it
> properly means berth capacity in feet rather than a yes/no. **Draft and depth** —
> vessel draft matters, but no berth depth exists anywhere in the material I was given,
> so that check is impossible rather than merely missing. And **undo for a move** — cancel,
> clear and load all keep what they replace, but a move overwrites the old berth and dates
> in place; the fix is the same shape, and I would rather say it is missing than imply it
> is covered. **Drag-to-reassign** on the board is the natural next interaction, now that
> moving in time and space is one action behind it.

---

## Things worth saying because they show judgment

- **The sample data is loaded, but removable.** The brief never asked for it to be
  installed, so loading is an action rather than a fixture — and I built the empty path
  first, which is how I found two bugs that hundreds of preloaded vessels had been
  hiding. Keeping both states working is the point.
- **Nothing in it is destructive for long.** Cancelling is a soft delete you restore from
  Review, and restoring re-runs the constraint, so it can be refused. Clearing the
  schedule and loading the sample over it both snapshot what they replace in the same
  transaction that replaces it, so the undo can never be out of step with what it is
  undoing. There are no accounts, so reversibility does the work a login would have done
  badly.
- **What I chose not to build.** No auth, no request-and-approve flow, no notifications,
  no drag-and-drop, no rafting. Each is in `DECISIONS.md` with a reason.
- **What the data cannot support.** Draft/depth checking is impossible. Inventing depths
  would produce confident wrong answers.
- **Unknown is a first-class answer.** A vessel with no recorded length is drawn hatched
  and says so. It is never assumed to fit.
- **Nothing on the board is invented.** Every booking is from their workbook or entered
  through the app. For a while the sample added bookings around today with made-up dates,
  so the board opened on a busy month; it read as clutter, and it was the one place the
  app showed data nobody had entered, so it came out. The board now opens on an empty
  month that says where the bookings are.
- **Importing is not a button, and I can say why.** Their file is a trap-laden migration,
  and a control that re-imports it would let anyone on a public site with no accounts
  replace everyone's schedule. So `npm run import` runs behind the database credentials,
  and `npm run import:check` prints the same parse without writing. And the file can never
  be CSV — collapsing the merged cells drops 58% of booked days and erases the only
  double-booking in 23 years. I measured that rather than assumed it.
- **I built a page for this and then deleted it.** `/check` ran the importer in the
  browser on your own copy of the workbook and saved nothing. It worked, and it managed no
  berths: a dry run for a command-line step the product does not offer. The brief asks for
  a system to manage reservations, and a page that demonstrates the import is a page about
  the project. Cutting something good that does not belong is the same judgment as not
  building it.
- **The look was borrowed from a site I find easy, and then measured.** The scale, the
  centred title, the one big button. What I did not take: its emoji, and its 10px mobile
  table — that is the one thing it does wrong, and there is a rule here against it.
- **Search treats typed input as text, not as a pattern.** A typed `%` is escaped before
  it reaches SQL; unescaped it would match the whole schedule. Same instinct as putting
  the conflict rule in the database.
- **The colours were validated, not chosen.** Two palettes were rejected by running a
  colour-vision checker rather than looking at them: orange for events sat too close to
  the red used for violations, and violet collapsed into blue for protanopes. (That was
  while a dark theme still existed; the app is light only now, which is why those hues
  survived the switch unchanged — they were validated against the light surface.)

---

## A six-minute demo script

Show the history first, then create the failure live. Pointing at a violation proves the
board renders one; watching the system refuse a booking proves the rule is real.

1. **Open the board.** It lands on today. *"It opens on the current month, because this is
   a live schedule — the line down the board is today. Their workbook ends in 2019, so this
   month is empty, and it says so and links to where the bookings are, instead of looking
   like it failed to load."*
2. **Jump to July 2010. Point at the red bar on North Pier Face.** *"That's R/V CLEAR TERN,
   120 feet, in a 75-foot berth — from their own spreadsheet. It breaks out of its row
   because the bar's height is vessel length over berth length. The misfit is the
   arithmetic, not a badge you have to learn, and nothing in the spreadsheet could have
   told you it was there. Almost every other bar is hatched: we don't know that vessel's
   length. That's the real state of their data."*
3. **Back to today. `+ New booking`, type `R/V Long Ketch`, Save.** *"Their busiest vessel,
   267 bookings, and no length on record — so the fit check says amber, not green. Typing
   a new name works too: saving registers the vessel, so the register fills through
   normal use rather than a data-entry project."*
4. **`+ New booking` again.** It reopens on the same berth and day. *"Red. Save is
   disabled and it names the booking in the way. There is no override, because the
   database itself refuses the write — no code path, race or concurrent request gets
   around it."*
5. **Press `Find me a berth`.** *"It proposes a free berth and says why — the smallest one
   that fits, when the length is known. It proposes; I still choose, because the
   coordinator knows things the database doesn't."* Save enables, the length warning stays
   amber. *"One rule is a wall, the other is advice. That asymmetry is the whole design."*
6. **Clear the schedule on Review, then put it back.** Your booking from step 3 is what
   makes it worth keeping. *"Nothing here is destructive for long. Clear, Load and Put
   back each keep what they replace, in the same transaction that replaces it, so the
   undo can't be out of step with what it undoes. The one thing not kept is the untouched
   sample, because Load can always make it again."*
7. **Go to Review, then press History → Unresolved conflict.** *"Every job this page does
   is a row with a count, and a row reading zero still says what would fill it — nothing
   needs a decision today, nothing is cancelled, 398 vessels have no length. Everything
   the import couldn't resolve is kept below as history, one button per kind of problem
   and closed until you ask — including the one genuine double-booking in 23 years, kept
   rather than deleted. The cells it couldn't read are traceable to sheet, row and column.
   It's history and not work, because nobody can move a boat that sailed in 2017."*
8. **Open Vessels and press `last 2019` on the top row.** *"The register is a queue, not
   an alphabet: it is ordered by how many bookings each missing length blocks, so the top
   ten cover about half the schedule. The year is a link to that hull's last booking. Type
   a length in and the fit check starts working on every booking that vessel has — the
   missing data gets collected as a side effect of ordinary work, which is the only way it
   ever gets collected."*

---

## If you are asked how it was built

> Next.js and TypeScript on Vercel, Postgres on Supabase, no ORM. The rules live in
> `src/domain` and `src/lib`, which import nothing from the database or the UI — 272 unit
> tests run in under a second with no infrastructure, and 39 more verify the parse once
> the workbook is in place. 62 Playwright specs build their own
> fixture against a real server and restore the sample afterwards, so the app is left in
> the state it ships in.
>
> I used Claude to write it. The work that mattered was deciding what it should do, and
> catching the places where what it produced was confidently wrong.

---

## Where things are, if someone wants to look

| File | What is in it |
|---|---|
| `README.md` | What it does and how to run it |
| `DECISIONS.md` | Every design choice with its reasoning, including the rejected options |
| `ASSUMPTIONS.md` | Where the brief was silent and a choice had to be made |
| `CLAUDE.md` | The invariants — what must not be broken and why |
| `docs/OPERATIONS.md` | Deploying, keep-warm, database posture |
| `docs/DESIGN.md` | The presentation rules in full, and where each came from |
