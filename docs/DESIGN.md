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

Full argument: [DECISIONS 4](../DECISIONS.md).

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
`/search` is a destination, **not a fourth tab** — do not add it to the nav, and do not
delete it for breaking the rule.

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
  one-line tagline is not a page, and neither is a title. See DECISIONS 24.

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
  are distinct pairs of bookings. See [DECISIONS 17 and 23](../DECISIONS.md).
- **A long list shows its head.** Vessels renders 25 of 418 with a filter that searches
  the whole register. Rendering all of them made the page 21,713px tall and buried the
  page's own argument. Review shows five rows per section and folds the rest behind a
  `<details>`; navigation on a row is a text link, and only the decision is a button.
- **A count strip is repetition too.** The board once carried *7 berths · 0 in September ·
  418 vessels · 29 to review* beside the month; three of the four were already on screen
  as seven lanes, the empty-month line, and the Review badge. It is gone (DECISIONS 24).
