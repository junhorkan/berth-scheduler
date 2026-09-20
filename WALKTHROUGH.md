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
> so that check is impossible rather than merely missing. And **drag-to-reassign**, which
> is the common real operation and the natural next interaction.

---

## Things worth saying because they show judgment

- **The sample data is loaded, but removable.** The brief never asked for it to be
  installed, so loading is an action rather than a fixture — and I built the empty path
  first, which is how I found two bugs that hundreds of preloaded vessels had been
  hiding. Keeping both states working is the point.
- **What I chose not to build.** No auth, no request-and-approve flow, no notifications,
  no drag-and-drop, no rafting. Each is in `DECISIONS.md` with a reason.
- **What the data cannot support.** Draft/depth checking is impossible. Inventing depths
  would produce confident wrong answers.
- **Unknown is a first-class answer.** A vessel with no recorded length is drawn hatched
  and says so. It is never assumed to fit.
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

## A five-minute demo script

Show the history first, then create the failure live. Pointing at a violation proves the
board renders one; watching the system refuse a booking proves the rule is real.

1. **Open the board.** It lands on today. *"It opens on the current month, because this is
   a live schedule — the line down the board is today. Everything a first-time visitor
   needs is the title, the sentence under it, and the one blue button."*
2. **Jump to July 2010.** *"This is the facility's legacy spreadsheet, imported: 23 years,
   two thousand bookings. Almost every bar is hatched, which means we don't know the
   vessel's length. That is the real state of their data, not a gap in mine."*
3. **Point at the red bar on North Pier Face.** *"That one breaks out of its row because
   the bar's height is vessel length over berth length. A 120-foot vessel in a 75-foot
   berth. The misfit is the arithmetic, not a badge you have to learn — and nothing in
   the spreadsheet could have told you it was there."*
4. **`+ New booking`, over a berth that is already taken.** *"Red. Save is disabled and it
   names the booking in the way. There is no override, because the database itself
   refuses the write — no code path, race or concurrent request gets around it."*
5. **Move the dates clear.** *"Save enables. The length warning is still there and still
   doesn't block. One rule is a wall, the other is advice — that asymmetry is the whole
   design."*
6. **Type a vessel name nothing knows.** *"New vessel — saving registers it. The register
   fills through normal use rather than a data-entry project."*
7. **Go to Review.** *"Everything the import couldn't resolve, one heading per kind of
   problem, repeats folded into one row — including one genuine double-booking from 2017 I
   kept rather than deleted. The cells it couldn't classify are traceable to their sheet,
   row and column. Plus a single derived line for missing lengths, so it can't go stale."*

---

## If you are asked how it was built

> Next.js and TypeScript on Vercel, Postgres on Supabase, no ORM. The rules live in
> `src/domain` and `src/lib`, which import nothing from the database or the UI — 246 unit
> tests run in under a second with no infrastructure. 47 Playwright specs build their own
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
