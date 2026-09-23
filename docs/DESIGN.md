# Design rules

The presentation half of the invariants, in full. [CLAUDE.md](../CLAUDE.md) states each
one in a line so a session cannot miss it; this file is the detail and the reasoning
behind those lines, and the numbering matches.

These are here rather than inline because a session changing a query or an import rarely
needs them — but a session touching a component needs all of them. **Read this before
changing anything visual.**

---

## 6. Bar height is the fit check

`height = vessel length ÷ berth length`, so a vessel that does not fit overflows its lane
as a consequence of arithmetic rather than as a special case. A 145ft vessel in a 90ft
berth is drawn 1.61 lanes tall and visibly breaks out of its row.

- **State the measurement at any width, including a single day.** Six of the nine
  violations in the source are single-day bookings, including the worst — 170ft in a 90ft
  berth — so gating the text on bar width hid most of them behind a hover. Narrow bars put
  it in a badge above the bar, which already overflows its lane anyway.
- **Say it in words: `170ft in 90ft berth`, never `170′ > 90′`.**
- **Every bar carries a plain-language `data-tip`, shown instantly. Never the native
  `title`** — that took about a second to appear, nobody waited, and the board looked
  unexplained while carrying its own explanation.
- **Tip and badge hang off the side the bar sits on** (`tipSide`, computed from the bar's
  `left`). Anchored the wrong way on a right-hand bar they widen the card's scroll area,
  which makes the board lurch sideways on hover — and the badge, which is always visible,
  gets clipped by the card: a violation late in the month read `120ft in 75ft be`.

- **The overflowing bar is translucent, and its measurement keeps a solid backing.** A
  bar taller than its lane grows over whatever is booked above it, and a solid fill hid
  that booking's label completely. The misfit has to be impossible to miss without
  costing you the booking next door, so the fill is 9% red, the border stays solid, and
  the `120ft in 75ft berth` text sits on its own white chip.
- **The legend states the height rule in words.** It listed the colours and the hatching
  and never mentioned height, which left the board's best idea as the one thing a
  first-time reader had to infer. One line, under the swatches: *bar height is the vessel
  against its berth*.

- **The target is padded; the bar is not.** A one-day booking is 20px wide and a small
  vessel in a large berth is 14px tall — far under the 44×44 touch guideline. Since width
  is the span and height is the fit, neither may grow, so `.bar::before` extends the hit
  area instead: anchored to the bar's bottom, `max(100%, 34px)` tall so it grows upward
  into empty lane and only helps the bars that need it, and 2px sideways because the next
  day's booking starts where this one ends. `.bar` must therefore never be given
  `overflow: hidden` — it declares no overflow at all and so stays at the default, and the
  clipping is done one level down by `.bar .lbl`. `.bar.toolong` states `overflow: visible`
  outright, for the `.ftbadge` that sits above the bar.

Full argument: [DECISIONS 4](../DECISIONS.md#4-the-bars-height-is-the-fit-check) and
[LOG 33](ENGINEERING-LOG.md#33-the-drawn-bar-is-the-data-the-target-you-press-is-not).

## 8. Empty is supported, and never silent

An empty month still draws all seven berth lanes. Replacing the grid with a line of text
was tried and reverted: it made an empty month look like a failure, where seven labelled
lanes look like a schedule waiting for a booking.

It also **says in one line where the bookings actually are**, as a link. A blank grid
cannot be told apart from a page that failed to load, and the visitor who assumes the
latter never finds out otherwise. The pointer is computed
(`getNearestBookedMonth`), never hard-coded: forward from the month on screen first,
falling back to the most recent booking behind it.

Building the empty path is what exposed both bugs in invariant 2.

## 9. Explain the tool, never the project

Three tabs: **Board, Vessels, Review**. No About page, no architecture in the product.
`/search` is a destination, **not a tab** — do not add it to the nav, and do not delete
it for breaking the rule. Any link to a destination **carries a short gloss**: a page
with one way in cannot afford a name you have to guess at.

**A page that demonstrates rather than manages does not belong in the product.** `/check`
let a visitor run the importer over their own workbook in the browser. It was well built
and it managed no berths — a dry run for `npm run import`, which is a command-line step
the app does not offer. It is gone; `npm run import:check` does the same job where the
import itself lives.
→ [DECISIONS 34](../DECISIONS.md#34-a-dry-run-for-a-step-the-product-does-not-have)

Orientation is allowed in exactly **one** place: the empty board. Every other explanation
in the app hangs off something on screen — the legend off a bar, the verdict strip off a
save, the queue off a problem — and on an empty month none of them render, including
`<Legend />`, which is gated on `bookings.length > 0`.

- It **must vanish once a bar exists.**
- **Facts stay visible; rules collapse** behind a `<summary>` that names them. Never
  `Info`: the person who needs those rules is the one who does not know there is anything
  to learn, and would never press a button labelled `Info`.
- **Each page's masthead is its own name and one line** — the board's, being the site's,
  adds the primary action. Vessels and Review put their lede under their name; the site's
  name becomes a small link back in the top row, with the search box and the tabs. A
  one-line tagline is not a page, and neither is a title. See
  [LOG 24](ENGINEERING-LOG.md#24-the-masthead-is-the-pages-name-in-the-reference-sites-shape).
- **That line says what the page is FOR, not how it happens to be doing.** Review's read
  *"Nothing on the schedule needs a decision."* — true, and on the front door it argues
  the page should not exist. State belongs in the card, against the row it is the state
  of, where a count of `0` and a few words saying what would fill it are informative
  rather than dismissive. **All four lines are purpose lines now.** Vessels was the
  exception — its line reported the split and then did arithmetic on it — and the two jobs
  that sentence did are done better below it, by a button that names the split, a pager that
  counts it, and rows ordered so *where to start* is the top of the list
  ([LOG 38](ENGINEERING-LOG.md#38-clear-is-gone-and-two-mastheads-stopped-reporting-state)).
- **A row with a count is organisation; a paragraph explaining the row is clutter.** An
  empty state gets a label, not an essay — *Nothing right now.*, *None missing.* Review
  was rebuilt twice in an hour, once for being bare and once for the prose that fixed it
  ([LOG 26 continued](ENGINEERING-LOG.md#26-continued-reviews-two-revisions)).
  Board is one card and a line; Vessels is one card, a row of buttons and a pager.

## 10. Light only, and one obvious action

- **Do not reinstate a dark theme.** The three mark hues were validated against the light
  surface with the data-viz validator, not chosen by eye, and the custom 404 exists
  precisely because Next's default page carries its own dark mode.
- **`+ New booking` is the only filled button on the board**, and each page has at most
  one. Everything else is an outline. The title and the filled button share the vessel
  blue: one accent, one job.
- **No control may exist only to confirm another.**

## 11. Nothing outside the grid below 13px

Body text outside the board grid never drops below **13px**; uppercase micro-labels and
monospace metadata may be 11–12. **When something will not fit, change its shape, not its
point size.** The chrome is set in Poppins, self-hosted by `next/font`; the grid keeps the
system face.

The grid itself keeps its own scale — day numbers and bar labels at 10px — because 31
columns and seven lanes have to fit one screen at once. That is a shape constraint, not a
reading one, and the tooltip carries the full sentence.

This rule was earned from the reference site the scale was borrowed from, whose mobile
stylesheet reads `font-size: 10px; /* Reduced from 12px */` — a table that would not fit
was shrunk until it did, twice. That is how a readable page becomes an unreadable one, one
commit at a time.

## Two corollaries that are not numbered

- **Repetition is not information.** Identical problems fold into one row with a count; a
  category is named once above its rows, not on every row; a column that is blank or
  identical on every row is furniture, not data. What does *not* fold: conflicts, which
  are distinct pairs of bookings. See
  [LOG 17 and 23](ENGINEERING-LOG.md#17-repetition-is-not-information).
- **A long list shows its head.** Vessels pages: ten of 418 at a time, its two halves on
  two buttons, and a filter that searches the whole register. Rendering all of them made
  the page 21,713px tall and buried the page's own argument, and a *Show the remaining
  393* only moved that wall one click away. Its rows are Review's rows, so the two queues
  read the same, and the page size is stated once, by the pager — *1–10 of 398*, under the
  button that names the category it counts, and nowhere in the page's own line. Review shows
  five rows per section and folds the rest behind a
  `<details>`; navigation on a row is a text link, and only the decision is a button.
  Review's **History** card goes further and starts closed: one button per category, and
  nothing drawn until one is pressed, because an archive nobody has asked for is the
  longest list on the page ([LOG 26 continued](ENGINEERING-LOG.md#26-continued-reviews-two-revisions)).
  Both mechanisms are CSS on a server-rendered page — a fold is a `<details>`, the
  archive is a radio group — so neither costs JavaScript.
- **A count strip is repetition too.** The board once carried *7 berths · 0 in September ·
  418 vessels · 29 to review* beside the month; three of the four were already on screen
  as seven lanes, the empty-month line, and the Review badge. It is gone
  ([LOG 24](ENGINEERING-LOG.md#24-the-masthead-is-the-pages-name-in-the-reference-sites-shape)).
