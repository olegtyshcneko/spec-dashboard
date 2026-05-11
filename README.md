# Spec Dashboard

A drop-in **static HTML dashboard** for documenting features, decisions, and
ongoing work across any project. No build step, no framework, no backend —
just a folder of HTML files and a small `data.js` manifest.

Useful when you want one canonical place to answer:

- What features are shipped, in-progress, planned, or known-broken?
- What were the acceptance criteria? What decisions were made? What was left out of scope?
- Where in the repo does each feature live?
- What background research / prior art shapes the project?

## What's in the box

```
spec-dashboard/
├── index.html                 # Dashboard home (filters + status tabs + Jira-style list)
├── data.js                    # Manifest of every spec — edit this when adding/removing/updating
├── knowledge.html             # Knowledge base index (optional, remove if not needed)
├── _template.html             # Copy this when creating a new spec
├── assets/
│   ├── style.css              # All styling (warm cream palette, gold/red accents)
│   └── dashboard.js           # Renders filters, status tabs, and the spec list from data.js
├── specs/
│   └── example-*.html         # Example spec pages — one per status type
├── knowledge/
│   └── example-research.html  # Example knowledge entry with a Mermaid diagram
└── docs/
    └── DASHBOARD_SPEC.md      # Meta-spec describing the rendering contract
```

## Prerequisites

Nothing more than:

- A modern browser (anything from the last few years)
- Any local static server — `python3 -m http.server` works, as do `npx serve`, `caddy file-server`, GitHub Pages, S3, etc.

`file://` browsing works for navigation but most browsers block loading
`data.js` via script tags from a `file://` origin, so the dashboard home will
sit on its loading message. Use a real server.

The Mermaid CDN (loaded only on knowledge pages that include it) needs an
internet connection. It's optional — pages render fine without it.

## Quick start

```sh
git clone https://github.com/olegtyshcneko/spec-dashboard.git my-project-dashboard
cd my-project-dashboard
python3 -m http.server 8000
# open http://localhost:8000
```

Or copy the contents into a `dashboard/` folder inside an existing repo:

```sh
git clone https://github.com/olegtyshcneko/spec-dashboard.git /tmp/sd
mkdir -p my-project/dashboard
cp -r /tmp/sd/{index.html,data.js,knowledge.html,_template.html,assets,specs,knowledge} my-project/dashboard/
```

Then host the `dashboard/` folder however you serve static files.

## Adding a spec

1. Copy `_template.html` to `specs/<slug>.html`. Use kebab-case for the slug.
2. Fill in every `<!-- FILL -->` marker. Delete sections you don't need
   (open-questions, decisions, etc.). Pick a status and priority — see the
   comment at the top of the template for valid values.
3. Add a matching entry to `data.js`:

   ```js
   {
     slug: "my-feature",
     title: "My feature",
     status: "backlog",          // implemented | wip | backlog | nice-to-have | known-issue
     priority: "p1",             // p0 | p1 | p2
     summary: "1–2 sentence elevator pitch.",
     tags: ["whatever", "you", "want"],
     updated: "2026-05-11",      // ISO date, shown in the row meta as "3d ago", etc.
     href: "specs/my-feature.html",
   },
   ```

4. Reload the dashboard. Your new spec appears as a row under the matching status tab.

That's it. No build, no migration, no CMS.

## Adding a knowledge entry

Optional — if your project doesn't have research / prior art / cross-cutting
decisions to document, delete `knowledge.html`, the `knowledge/` folder, and
the `.kb-hero` block in `index.html`.

If you do want a knowledge base:

1. Drop `<slug>.html` in `knowledge/`. Use the example as a starting point.
2. Add a card in `knowledge.html` linking to it.
3. Add an entry-card in the `.kb-hero` block in `index.html` if you want it
   surfaced on the dashboard home.

## Customizing

**Colors** — every accent in the stylesheet flows through CSS variables at
the top of `assets/style.css`. Change `--accent`, `--gold`, `--ink-deep`, etc.
to re-skin the whole dashboard.

**Status taxonomy** — the five status buckets (`implemented`, `wip`,
`backlog`, `nice-to-have`, `known-issue`) live in the `SECTIONS` array near
the top of `assets/dashboard.js`. Add, rename, or remove buckets there. If
you add a new bucket, also add matching color tokens in `style.css`
(`--s-<key>-bg/fg/border`) and a `.pill[data-status="<key>"]` rule.

**Priority dots** — `p0` / `p1` / `p2` are styled in `style.css` via the
`.prio[data-prio="..."]::before` rules. Same pattern as status — add a new
one if your project needs more granularity.

**Hero / knowledge surface** — the dashboard home has a "knowledge base"
hero block above the filter bar. Edit the copy and the entry-cards in
`index.html`, or delete the `<section class="kb-hero">` entirely if it's not
useful for your project.

**Header chrome** — the dashboard title, subtitle, and nav links live in
`index.html` (`.site-header`). Replace with your project's name and any
external links you want at the top.

## Design notes

- **Static is a feature.** No build step means no version drift, no
  abandoned tooling, no rot from a Vue/React/Svelte that someone needs to
  npm-install to read your docs.
- **Cards are the unit.** Each spec is one HTML file rendered as one card on
  the index. You can read the source without running anything.
- **Color carries information.** Status colors are semantic (green = shipped,
  yellow = in-progress, blue = backlog, purple = nice-to-have, red = issue).
  Don't reuse them for decorative purposes.
- **Filter > navigate.** The index has tag and status filters plus a text
  search; deep linking and tree navigation aren't the primary affordance.
- **Knowledge ≠ specs.** Knowledge entries don't have status — they're
  reference material that informs which specs you write, not the work itself.

## License

MIT. See [LICENSE](LICENSE).
