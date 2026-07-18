# Global Full-Text Search — Design

**Date:** 2026-07-18
**Status:** Approved (revised after external design review, 2026-07-18)
**Scope:** `packages/core/src` (plaintext transform + tests), new `packages/renderer/src/pages/search-index.json.ts`, `packages/renderer/src/layouts/BaseLayout.astro`, `packages/renderer/package.json` and the root lockfile (MiniSearch dependency), shared styles (`assets/style.css`, `packages/renderer/src/styles/global.css`)

## Purpose

Let a reader find any specification or knowledge entry by words in its **body**, not just its frontmatter, from any page of the dashboard. The existing index-page search box matches only metadata (id, title, summary, milestone, categories, owners, tags); body prose and knowledge entries are invisible to it. That page-level filter stays as-is — this feature adds a global search layered above it.

## Approach decision

Chosen: **build-time JSON index + bundled MiniSearch** (MIT, ~8 KB gzipped), declared as a dependency of `@spec-dashboard/renderer`, imported in the layout script, and bundled by Astro into the static output. The result is self-contained on any static HTTP host — no CDN, no application backend (`file://` remains unsupported, as elsewhere in the project).

Rejected alternatives:

- **Zero-dependency hand-rolled matching** — keeps runtime deps at zero but gives cruder ranking and no typo tolerance.
- **Pagefind post-build** — scales to thousands of pages, but adds a Rust build dependency wired into `specdash build`, needs UI theming, and targets a scale the project has explicitly declared out of scope (`docs/TROUBLESHOOTING.md` directs projects with thousands of entries to category-scoped dashboards).

## MDX-to-plaintext transform (core)

A new exported helper in `@spec-dashboard/core` (e.g. `mdxBodyToPlainText(body: string): string`) converts a raw MDX body to searchable plaintext. It parses to an AST using the remark/MDX toolchain already present in the dependency tree (declared explicitly in core's manifest) rather than regex stripping. Node rules:

- **Removed entirely:** MDX ESM nodes (imports/exports, including multiline), MDX expressions (`{...}`), HTML comments, image/link destinations, YAML frontmatter if present.
- **Kept as text:** headings, paragraphs, list and checklist text, table cell text, link and image labels, emphasis/strong content (markers dropped), inline-code and fenced-code **values** (fence markers and language tags dropped), and the textual descendants of JSX elements (tags and attributes dropped).
- Whitespace is normalized to single spaces; the result is capped at 20,000 characters per record.

This lives in core so the existing `core.test.mjs` suite can test it directly against fixtures (see Verification).

## Index generation (build time)

New endpoint `packages/renderer/src/pages/search-index.json.ts`, following the `project.json.ts` precedent. It emits one record per **non-archived** spec and knowledge entry:

```json
{
  "id": "SPEC-006",
  "collection": "spec",
  "title": "Continuous Git reconciliation",
  "summary": "Compare dashboard content with repository evidence…",
  "kind": "feature",
  "state": "shipped",
  "milestone": "v0-5-0",
  "tags": "git ci",
  "url": "/specs/spec-006/",
  "body": "plain text of the MDX body"
}
```

- `collection` is `spec` or `knowledge`; knowledge records omit `state` and `milestone`.
- `tags` is the frontmatter tag array **joined into one space-separated string**, so every indexed field is a plain string and MiniSearch needs no custom field extraction. An empty tag list yields `""`.
- `url` is base-path aware, like every generated page link.
- `body` comes from the core transform above.

## Client behavior

The search UI lives in `BaseLayout` so it exists on every page.

- **Trigger:** a search control in the `site-header` nav after Health — an input-shaped button labeled `Search /` on desktop, an icon button with `aria-label="Search"` on narrow viewports. The header nav gains a wrap rule so the added control cannot overflow at 390 px.
- **Shortcuts:** `/`, `Ctrl+K`, and `Meta+K` open search. All are ignored when the event target is an input, textarea, select, or `contenteditable` element, when `event.isComposing` is true, or (for `/`) when any modifier is held. `Esc` closes.
- **Dialog semantics:** a native `<dialog>` opened with `showModal()` (required — plain `show()` does not trap focus), top-aligned, with an accessible name (`aria-label="Search"` or `aria-labelledby` on a visible heading), a visible labeled close button, initial focus in the query input, and focus restored on close to the control that opened it.
- **Index loading:** the base-aware URL of `search-index.json` is passed to the script via a data attribute (`withBase("search-index.json")`); a bare relative fetch would resolve wrongly under nested routes and subpath bases. The index is fetched lazily on first open and cached **per page load** — this is a multi-page site, so navigation naturally discards the in-memory instance and normal HTTP caching serves repeat fetches. Load failures reset the cached promise so the next open genuinely retries.
- **Search configuration:** MiniSearch indexes `title`, `summary`, `body`, `id`, and `tags` with numeric boosts `title: 4, id: 3, summary: 2, tags: 2, body: 1`, `prefix: true`, `fuzzy: 0.2`, and `combineWith: "AND"` (MiniSearch defaults to OR; AND keeps multi-term queries precise).
- **Results:** flat ranked list, re-rendered on every keystroke (no debounce needed at the documented scale), showing at most 20 rows with a count line reading `Showing X of N matches`. Each row shows the entry id in the mono display face, a state dot for specs (accompanied by visually hidden state text — never color-only), the title, and one snippet.
- **Snippet selection:** take the first matched document term whose match fields include `body` (matched terms come from the MiniSearch result, not the raw query — fuzzy/prefix matches may not literally contain the query text), slice a window around its first occurrence, and wrap **every** matched term inside the window in `<mark>`. When no matched term occurs in the body, the snippet falls back to the entry summary, unhighlighted.
- **Keyboard and AT model:** the combobox pattern — focus stays in the query input (`role="combobox"`, `aria-expanded`, `aria-controls`) over a `role="listbox"` result list whose rows are `role="option"`; `aria-activedescendant` tracks the selection. ArrowDown/ArrowUp move the selection and clamp at the ends (no wrap); the first result is preselected after each re-query; Enter navigates to the selected entry; click works on any row. Selection styling must include a non-color cue (e.g. border/inset) and visible focus styling.
- **Live status:** the count line and error/loading messages live in a `role="status"` region; a failed index load renders as `role="alert"`.
- **Loading and typing races:** while the index loads, the dialog shows a loading state with `aria-busy="true"`; a query typed before initialization completes is kept and replayed once the index is ready.
- **Empty states:** an empty query shows a short hint line; a query with no matches shows a directive empty state consistent with the roadmap's pattern.
- **URL:** the query is deliberately **not** persisted in the URL. This deviates from the page filters' URL-backed convention because the dialog is a modal, not a view; encoding modal state in the URL would produce confusing Back-button behavior.
- **Styling and motion:** reuse existing dark-theme tokens and card styles; open/close is a simple fade honoring `prefers-reduced-motion`.

## Error handling

- The fetch checks `response.ok` (fetch does not reject on HTTP 404/500); JSON parsing, record-shape validation, and MiniSearch construction are each guarded. Any failure shows an inline "Search index unavailable" alert — never a silent dead search box — and the next open retries.
- A project with zero entries produces a valid empty index and a working dialog whose empty state simply reports no content.
- Result rows and snippets are constructed with DOM nodes (`textContent` plus explicit `<mark>` elements), never by assigning raw HTML from index content.

## Verification

- **Core unit tests (new):** `mdxBodyToPlainText` fixtures covering multiline imports/exports, JSX elements with attributes and children, MDX expressions, Markdown links and images, inline code, and fenced code whose *content* includes `import ` and `<button>` — asserting exact expected output (code text kept, syntax and ESM removed). Plus the 20,000-character cap boundary and tag-join behavior including an empty tag array.
- **Build output:** `dist/search-index.json` exists, parses as JSON, and its record count equals the number of non-archived entries **derived from `content/`** (not hard-coded); every indexed field is a string; record `url` values carry the base prefix when built with a subpath base, and a subpath-served build actually fetches the index from the right URL.
- **Existing gates stay green:** core and MCP test suites, `html-validate` over the built site.
- **Browser sweep (Playwright):** open via click, `/`, and `Ctrl+K`; search a term that appears only in a spec body (proving full-text reach beyond frontmatter); assert the highlighted snippet, `Showing X of N` count, ArrowDown+Enter navigation to the entry page, Esc close with focus restored to the trigger, the no-results state, and the title-only summary fallback. Simulate a blocked/404 index request and assert the alert plus successful retry on reopen. Repeat the core flow at 390×844 and confirm the header does not overflow horizontally; spot-check `prefers-reduced-motion`.

## Out of scope

Section-level deep links into entry pages, search analytics, URL persistence of the query, indexing archived entries, `file://` support, and any server-side or external search service.
