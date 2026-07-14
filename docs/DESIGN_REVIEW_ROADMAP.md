# Design review — Roadmap page

Reviewed: 2026-07-14, live site at
`https://olegtyshcneko.github.io/spec-dashboard/roadmap/` (timeline + list views,
`scope=current|all`, desktop 1440px and mobile 390px). Reference screenshots in
`.playwright-mcp/` (gitignored). Design tokens read from the published CSS.

## What already works

- Clear page framing: eyebrow ("Delivery view"), title, one-sentence job statement.
- Filters, count line, stat tiles, legend, timeline — the scan order is logical.
- Card anatomy is consistent between timeline and list views; the mobile layout
  stacks cleanly with no horizontal overflow.
- Status pills, mono IDs (`SPEC-001`), and the dark blue-gray surface system read
  as a coherent developer tool.

## Findings, by priority

### P0-1 · Every milestone has equal visual weight

The page's stated job is "follow current delivery", but the active/next milestone
looks identical to seven completed ones. With `scope=all` the reader lands on
v0.1.0 (May) and scrolls past ~7 full-height shipped cards — each with nested spec
cards — before reaching what is actually next. Only ~1.5 cards fit a viewport, so
the timeline reads as a uniform list and the spine metaphor adds little.

**Proposal:** make history compact and the present loud.

- Collapse completed milestones by default to a one-line summary row:
  `● v0.1.0 · MDX compiler — 2/2 shipped — Jul 11` (expand on click to reveal specs).
- Render the active milestone expanded, visually distinct (accent border or
  slightly raised surface), and auto-scroll/anchor to it when the page loads.
- Result: the whole roadmap fits in one or two viewports; the timeline finally
  shows shape (a run of small closed rows, one big open one, planned stubs after).

This is the single highest-leverage change on the page.

### P0-2 · Default landing (`scope=current`) is an empty state

The default URL resolves to one "Next release" card containing "No work is
assigned to this milestone." First-visit impression: the project looks idle, while
the stat tiles right above claim 8 milestones / 7 completed. The page fails its
primary job on landing.

**Proposal:** when the current scope has no assigned work, don't show a lone empty
card. Options (pick one):

- Fall back to showing the most recently delivered milestone above the empty
  "Next release" stub — "here's what just shipped, here's the empty slot".
- Or auto-widen to `scope=all` with completed rows collapsed (pairs with P0-1).
- Either way, upgrade the empty-state copy from a passive statement to a
  direction: what action assigns work to a milestone (CLI command, MCP tool,
  frontmatter field) — this product is git-native, tell the user the command.

### P0-3 · Color roles collide; "planned" reads as an error

Current assignments observed in the tokens and UI:

| Hue | Used for |
|---|---|
| Rose `#fb7185` (`--accent`) | Brand wordmark, links, **planned** timeline dot, spec IDs |
| Gold `#fbbf24` (`--gold`) | Eyebrow, active filter/toggle states, **active** timeline dot, card top-borders |
| Green | Completed/shipped |
| Orange→green gradient | Every progress bar, always full width |

Two problems:

1. The brand accent doubles as the "planned" status color, and rose-red on dark
   reads as danger/blocked. Planned work is neutral-future, not a problem state.
   The status quintet already in the tokens has a natural fit: backlog blue
   (`--s-backlog-*`) or the purple (`--s-nice-*`) for planned.
2. The orange→green gradient bar is identical on every card at 100%, so it
   encodes nothing — and a "complete" bar that starts orange reads as partially
   unhealthy. Completed bars should be a single quiet green fill (or drop the bar
   entirely on collapsed rows — "2/2 shipped" text carries it).

**Proposal:** write down role assignments and enforce them: rose = brand/identity
only; gold = "needs attention now" (active milestone, active filters); blue or
purple = planned/future; green = done. Reserve the gradient exclusively for the
active milestone's real partial progress — see Signature below.

### P1-4 · Redundant status signals per card

A completed milestone currently states "completed" five ways: left-rail pill +
left-rail date, green dot, Start/Delivered date block, full progress bar, and a
SHIPPED pill on every child spec. The left rail duplicates the card's own date to
the pixel ("Completed 2026-07-11" vs "Delivered 2026-07-11").

**Proposal:** the dot + one date on the card is enough. Drop the left-rail pill
and date (the rail keeps only dots and the spine); on collapsed rows the summary
line carries the rest. Child SHIPPED pills are implied by a completed milestone —
consider showing them only when they differ from the milestone state (that's the
informative case).

### P1-5 · Dates and counts are hard to scan

- ISO `2026-07-11` repeated up to 4× per card, small, faint, right-aligned with
  stacked labels. Humanize display dates ("Jul 11, 2026"), keep ISO in a `title`
  attribute; one date per completed card ("Shipped Jul 11").
- Stat tiles mix units without saying so: "8 milestones / 7 completed /
  8 scheduled" — milestones vs milestones vs work items. "8 scheduled" vs
  "8 milestones" invites misreading. Label the unit ("8 specs scheduled") or
  split rows.
- Stat tiles ignore the active filter (scope=current shows "1 milestone in
  current roadmap" while tiles still say 8/7/8). Decide: tiles are global
  (then visually separate them from the filtered list) or filtered (then update
  them). Mixed is the confusing option.
- Count-line copy "8 milestones in complete roadmap" → "Showing 8 of 8
  milestones".

### P1-6 · Toolbar alignment and control roles

- The scope segmented control (Current/All/Completed) has no label while its
  neighbors have MILESTONE / WORK STATE / SEARCH eyebrows, so the row has two
  baselines. Same for Clear filters and the view toggle.
- The Timeline/List toggle is not a filter; it sits in the filter card and uses
  the same gold active style as the scope control, implying it filters. Move it
  to the section header level (right of the count line is a natural spot).
- Scope segmented control and the milestone `<select>` overlap in purpose
  (both narrow which milestones show) — worth clarifying or merging.
- Native `<select>` elements render with OS chrome that clashes with the custom
  inputs beside them; minimal custom styling (appearance: none + chevron) fixes.
- "Clear filters" is enabled even when nothing is filtered — disable or hide
  until at least one filter is active.

### P2-7 · Identity: everything is system-UI

Typography is `ui-sans-serif` for every role; mono appears only in IDs, counts,
and chips — and those are the most characterful moments on the page. For a
git-native tool the honest, distinctive direction is to lean into the
terminal/manifest aesthetic the `SPEC-001` labels already hint at: a
characterful mono or narrow grotesk for display (page title, milestone titles,
stat numbers), keeping the quiet system sans for body. One display face, used
in few places, changes the templated feel more than any color tweak.

### P2-8 · Small polish

- Version chip renders the slug (`v0-1-0`) next to a title that already says
  "v0.1.0" — reads as a typo. Show the semver in the chip, or drop the chip on
  milestones whose title starts with the version.
- Favicon 404s on every load (`/favicon.ico`) — add one (even a simple SVG
  glyph) and link it in the layout head.
- Legend sits detached mid-air between stats and timeline; anchoring it to the
  timeline column (top of the spine) ties it to what it explains.
- Faint text (`--text-faint` #7d8c9e) at 10–11px mono is ~5:1 contrast — passes
  AA, but it's the floor; avoid going fainter/smaller.

## Signature element (one bold moment)

Reserve the animated orange→green gradient for exactly one place: the active
milestone's progress bar, showing real partial progress (e.g. 3/7 specs shipped
fills 43%). Everything else stays quiet — collapsed green history rows, muted
planned stubs. The page then has one glowing "you are here" moment that is also
its most informative pixel. Honors `prefers-reduced-motion` by rendering static.

## Open questions

1. Collapsed-by-default completed milestones — acceptable, or should history stay
   expanded (e.g. for stakeholder screenshots)?
2. Default scope when "current" is empty: show last shipped milestone, or widen
   to all-collapsed?
3. Timeline order: keep oldest→newest with auto-scroll to active, or flip to
   newest-first like a changelog?
4. Is a typography/identity pass (P2-7) in scope, or is this review limited to
   hierarchy/clarity fixes?

## Implemented 2026-07-14

Shipped on the `worktree-roadmap-design-improvements` branch. Verified via the
core + mcp test suites, `html-validate`, and a full desktop (1440×900) + mobile
(390×844) Playwright sweep of every page.

### Findings addressed

- **P0-1 · Milestone hierarchy** — completed milestones now collapse to one-line
  `<details>` summary rows (`● v0.1.0 · MDX compiler — 2/2 shipped — Jul 11`);
  active/planned milestones render expanded. Work-state filters force the matching
  details open. A one-time hero anchor scrolls the active/planned milestone into
  view on load when it starts below the fold.
- **P0-2 · Default landing** — `scope=current` now surfaces the most recently
  shipped milestone (tagged "Latest shipped") above a directive empty state that
  names the concrete action (`milestone: next-release`) instead of a passive
  "no work assigned" line.
- **P0-3 · Color roles** — planned is now backlog blue (`--s-backlog-fg`,
  #93c5fd), completed progress bars are a single quiet green fill, and the
  orange→green gradient is reserved exclusively for the active milestone's real
  partial progress (`[data-milestone-status="active"] .roadmap-progress span`).
- **P1-4 · Redundant status signals** — the left rail is slimmed to a 96px spine
  with dots only; the duplicate status pill and rail date are gone, leaving the
  card's own dot + single date to carry the state.
- **P1-5 · Dates and counts** — display dates humanized ("Jul 11, 2026", ISO kept
  in `title`); stat tiles relabeled with explicit units
  ("8 milestones / 7 delivered / 8 specs scheduled"); count line rewritten to
  "Showing X of Y milestones · <scope>".
- **P1-6 · Toolbar** — the scope control now carries a label to match its
  neighbors; the Timeline/List view switch moved out of the filter card up to the
  overview row; native `<select>`s get `appearance: none` + a custom chevron; and
  "Clear filters" is disabled whenever nothing is filtered (default scope, no
  milestone/state/search).
- **P2-7 · Identity (partial)** — a mono display face (`--font-display`, the
  system mono stack) is applied to the h1, milestone titles, and stat numbers,
  keeping the system sans for body. Delivered via the platform mono stack rather
  than a bundled webfont, so the terminal/manifest character lands with no extra
  network payload.
- **P2-8 · Polish** — the redundant slug chip (`v0-1-0` next to a `v0.1.0` title)
  was removed, and an inline SVG favicon is linked in the layout head (no more
  `/favicon.ico` 404 — confirmed zero console errors across the sweep).

### Deliberately skipped

- **Stat tiles stay global.** Rather than make the tiles react to the active
  filter, their labels were clarified so the global scope is unambiguous; the
  mixed filtered/unfiltered reading called out in P1-5 is thereby avoided without
  coupling the tiles to the filter state.
- **Legend position unchanged.** The legend anchoring suggestion in P2-8 was not
  pursued; its current placement was judged acceptable for this pass.

### Accepted trade-off

- Milestone titles are marked up as `<strong>`, not `<h2>`. Headings are not valid
  phrasing content inside a `<summary>`, and HTML validity there was prioritized
  over heading-based navigation — screen readers flatten headings within a summary
  anyway, so the practical accessibility cost is negligible.
