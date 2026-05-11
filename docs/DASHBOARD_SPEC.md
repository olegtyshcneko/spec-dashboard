# Dashboard rendering contract

This is the meta-spec: the contract `assets/dashboard.js` implements when it
reads `data.js`. Useful if you're forking the dashboard to a non-trivial
custom variant.

## The data shape

`data.js` sets `window.SPECS` to an array of spec records:

```ts
type Spec = {
  slug: string;           // kebab-case; must match specs/<slug>.html
  title: string;          // short, plain-language name
  status:
    | "implemented"
    | "wip"
    | "backlog"
    | "nice-to-have"
    | "known-issue";
  priority: "p0" | "p1" | "p2";
  summary: string;        // 1–2 sentences shown on the card
  tags: string[];         // arbitrary but kept small for filter UX
  updated: string;        // ISO date YYYY-MM-DD
  href: string;           // relative URL to the detail page
};
```

If your project needs more fields, add them to the record and read them in
`assets/dashboard.js`. No schema lives anywhere else — the contract is
defined by what the renderer reads.

## How `dashboard.js` consumes it

The renderer:

1. Reads `window.SPECS` (set by `data.js`).
2. Renders a status tab bar with one tab per entry in the `SECTIONS` constant
   at the top of `dashboard.js`, plus a leading "All" tab. The active tab is
   tracked in `activeStatus` (null = All). Each tab shows a count of specs
   that match the current text + tag filter for that status.
3. Renders the spec list below the tabs — one row per spec matching the
   active tab + text + tag filters. The row shows status pill, title,
   summary (clamped to two lines), priority dots, up to three tags, and a
   relative `updated` date. When the "All" tab is active, rows are grouped
   by status in a fixed order (`ALL_TAB_STATUS_ORDER` near the top of
   `dashboard.js` — currently: wip → nice-to-have → known-issue → backlog →
   implemented), most-recently-updated first within each group. When a
   specific status tab is active, rows render in `data.js` order.
4. Updates the `#dash-counter` element under the page title with the number
   of visible vs. total specs.

Filters AND together: search narrows the visible specs across the active
tab; switching tabs further narrows; tag chips narrow on top of that.

The renderer is the only file you'd touch to change the index layout. The
detail pages are plain HTML — they don't go through any rendering step.

## Detail page convention

Each `specs/<slug>.html` is a self-contained HTML article:

- Uses the `.detail` container class
- Has a `<header>` with status pill, priority dots, title, and summary
- Embeds a small JSON `<script id="spec-meta">` for any future tools that
  want to read spec metadata without parsing HTML
- Uses convention classes for sections: `.story`, `.todo`, `details.decision`,
  `.files-list`

The classes are not load-bearing for the index — only `style.css` cares
about them. You could deviate per-page if needed.

## Knowledge entries

Knowledge entries are not specs and don't appear in `data.js`. They live in
`knowledge/<slug>.html`, are listed in `knowledge.html`, and can optionally
be surfaced on the index home in the `.kb-hero` section.

If you don't need a knowledge base, delete:

- `knowledge.html`
- `knowledge/`
- The `<section class="kb-hero">…</section>` block in `index.html`

The rest of the dashboard works unchanged.
