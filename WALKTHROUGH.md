# Walkthrough

Written to be **studied and spoken from**, not skimmed. Plain language, no code reading
required.

---

## The 30-second version

> A marine research facility scheduled berths in a spreadsheet for 23 years. Two things
> kept going wrong: double-bookings, caught only by scanning a grid by eye, and vessels
> assigned to berths they were too long for.
>
> When I looked at the data, those two problems turned out to be completely different
> shapes. Double-booking is decidable — you always know the dates. Vessel fit is not,
> because **only 20 of 418 vessels have a recorded length anywhere in the file**. 97% of
> bookings could never have been checked.
>
> So I made double-booking impossible at the database level, and made vessel fit visible
> instead — a warning that never blocks, plus a registry that fills in as you work. The
> board draws each booking's height as vessel length over berth length, so a vessel that
> doesn't fit visibly breaks out of its row.

**Lead with the 97% figure.** It reframes the brief from "build a scheduler" to "the
facility cannot answer the question it's asking", and it is the single most persuasive
thing you found.

---

## Lead with the numbers you can defend

| Number | What it means |
|---|---|
| **20 of 418** | vessels with a recorded length. Everything else follows from this. |
| **97%** | of bookings that cannot be fit-checked at all today |
| **9** | physically impossible assignments in the 54 bookings that *could* be checked — worst is a 170′ vessel in a 90′ berth |
| **2,212 → 2,031** | source cells collapsed into real stays |
| **272 / 272** | month blocks parsed, none skipped |
| **186** | unit tests, none needing a database |
| **10** | vessel lengths that would make 51% of the schedule verifiable |

---

## The four questions you're most likely to get

### "Why is the conflict check in the database instead of the code?"

> Because checking in code has a gap. You query for overlaps, find none, then insert —
> and between those two steps another request can do the same thing. Both find nothing,
> both insert, and now you have a double-booking. A database constraint has no gap; the
> overlap is simply unstorable.
>
> It also means the guarantee doesn't depend on my code being right. Anything that ever
> touches that table — a future API, a bulk import, a bug of mine — still can't create
> one.

If pushed on how you know: *eleven tests run as raw SQL against the database, not through
the app.*

### "Why does the size check only warn, if it's the thing that's actually broken?"

> Because the data to check it mostly doesn't exist. 97% of bookings reference a vessel
> with no recorded length. If the system refused to save anything it couldn't verify, it
> would refuse almost everything and get abandoned.
>
> So the warning is loud but never blocking, and the Vessels tab is sorted by how many
> bookings each missing length is blocking. Recording ten lengths makes half the schedule
> checkable. The system turns an impossible problem into a ten-minute one.

### "What was the hardest part?"

Be specific — this answer is better than a general one:

> Parsing the spreadsheet. Each month is laid out as a **calendar**, so day 1 sits under
> its real weekday and starts at a different column every month — column 1 in August
> 1997, column 4 in January 2010. I had assumed a fixed offset, which silently misdated
> the whole file. The fix reads the day alignment from the sheet and then verifies it
> against the real calendar for that month.
>
> Two other things were hiding in there: the 2002, 2003 and 2004 sheets each open with
> the *previous* December, so taking the year from the sheet name misdates those blocks.
> And the 2010 sheet labels its last two blocks "NOVEMBER 2018" and "DECEMBER 2018" —
> a typo, because the 2018 sheet already has those months. A stated year is only trusted
> when it's credible.

### "What would you do next?"

> Three things, in order. **Rafting** — the source says "will raft alongside if needed",
> so two vessels legitimately sharing a berth does happen; modelling it properly means
> berth capacity in feet rather than a yes/no, which is a bigger change than this needed.
> **Draft and depth** — the vessel sheets record draft, but no berth anywhere in the file
> has a recorded depth, so that check is currently impossible rather than merely missing.
> And **drag-to-reassign**, which is the common real operation and the natural next
> interaction.

---

## Things worth saying because they show judgment

- **What I chose not to build.** No auth, no request portal, no notifications, no
  drag-and-drop, no rafting. Each is in `DECISIONS.md` with a reason.
- **What the data cannot support.** Draft/depth checking is impossible — no berth depth
  exists in the file. Inventing depths would produce confident wrong answers.
- **Nothing is silently dropped.** Every cell the importer couldn't classify becomes a
  review item with a pointer back to its original sheet, row and column.
- **The colours were validated, not chosen.** Two palettes were rejected by running a
  colour-vision checker: orange for events was too close to the red used for violations,
  and violet collapsed into blue in dark mode for protanopes.

---

## A five-minute demo script

1. **Open the board.** It lands on July 2010. *"Almost every bar is hatched — that means
   we don't know the vessel's length. That's the real state of this facility's data."*
2. **Point at the red bar on North Pier Face.** *"That one breaks out of its row because
   the bar's height is vessel length over berth length. It's a 120-foot vessel in a
   75-foot berth. Nothing in the spreadsheet could have told you that."*
3. **Click + New booking.** Vessel `R/V Long Ketch`, berth South Float East, July 6–8.
   *"Red — the berth is taken, and Save is disabled. There's no override. Amber — we
   can't verify the length, but that one doesn't stop me."*
4. **Change the dates to July 22–24.** *"Berth is clear, Save enables, and the amber
   warning is still there. That's the whole design: one rule is a wall, the other is
   advice."*
5. **Go to Vessels.** *"Sorted by how many bookings each missing length blocks. Ten
   entries here makes half the schedule checkable."*
6. **Go to Review.** *"Everything the import couldn't resolve, including one genuine
   double-booking from 2017 that I kept rather than deleted, and each row traces back to
   its spreadsheet cell."*

---

## If you're asked how it was built

Answer straightforwardly. A good version:

> I worked through it with Claude — the analysis of the spreadsheet, the design decisions
> and the trade-offs were mine to direct, and the implementation was written with it. I
> can walk you through any decision in the repo and why it went that way.

That is both true and the thing they actually care about, which is whether you understand
it. Check whether the club has a stated AI policy and follow it; if it does and this
conflicts, say so rather than working around it.

---

## Where things are, if someone wants to look

```
src/domain/     the rules — overlap detection, fit checking, cell classification
                no database, no UI, 186 tests
src/import/     the spreadsheet parser and stay-stitching
src/db/         SQL queries and writes
src/app/        the three pages
```

The one structural rule: **`src/domain` imports nothing from the database or the UI.**
That's why the rules can be tested without either, and why the importer and the live
board apply exactly the same logic.
