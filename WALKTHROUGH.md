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

- **I did not load the sample data.** The brief attached a schedule; it never asked for it
  to be installed as the facility's data. Comparing the three options makes that clear —
  one attached nothing, one attached a blank reporting form, and nobody would preload an
  app with the contents of a form. The only thing I took from it is the berths.
- **What I chose not to build.** No auth, no request-and-approve flow, no notifications,
  no drag-and-drop, no rafting. Each is in `DECISIONS.md` with a reason.
- **What the data cannot support.** Draft/depth checking is impossible. Inventing depths
  would produce confident wrong answers.
- **Unknown is a first-class answer.** A vessel with no recorded length is drawn hatched
  and says so. It is never assumed to fit.
- **Search treats typed input as text, not as a pattern.** A typed `%` is escaped before
  it reaches SQL; unescaped it would match the whole schedule. Same instinct as putting
  the conflict rule in the database.
- **The colours were validated, not chosen.** Two palettes were rejected by running a
  colour-vision checker: orange for events sat too close to the red used for violations,
  and violet collapsed into blue in dark mode for protanopes.

---

## A five-minute demo script

Because the app ships empty, you build the demonstration live — which is more convincing
than pointing at data that was already there.

1. **Open the board.** It lands on today, empty, with all seven berths and a line marking
   today. *"This is the normal state of a reservation system: the schedule its users have
   made. It starts empty."*
2. **Book a vessel.** `+ New booking`, type a name nothing knows, pick a berth, set dates.
   *"The name matches nothing, so it is a new vessel — saving registers it. That is how
   the register fills."*
3. **Book a second vessel over the same berth and dates.** *"Red. Save is disabled, and it
   names the booking in the way. There is no override — the database itself will refuse
   this write, so no code path, race or concurrent request can get around it."*
4. **Move the dates clear.** *"Save enables. But the warning about the length is still
   there and does not block — we cannot verify the fit, and saying so is honest."*
5. **Go to Vessels, record a length bigger than the berth.** Back on the board: *"The bar
   is now taller than its lane, because the height is vessel length over berth length.
   The misfit is the arithmetic, not a badge you have to learn."*
6. **Go to Review.** *"One row per thing that needs a decision, plus a single line saying
   how much of the schedule cannot be fit-checked yet — derived, so it cannot go stale."*

---

## If you are asked how it was built

> Next.js and TypeScript on Vercel, Postgres on Supabase, no ORM. The rules live in
> `src/domain` and `src/lib`, which import nothing from the database or the UI — 111 unit
> tests run in under a second with no infrastructure. 33 Playwright specs build their own
> fixture against a real server and clear it afterwards, so the app is left in the state
> it ships in.
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
