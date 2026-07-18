# Global Full-Text Search — Design

**Date:** 2026-07-18
**Status:** Approved
**Scope:** `packages/renderer/src/layouts/BaseLayout.astro`, new `packages/renderer/src/pages/search-index.json.ts`, shared styles

## Purpose

Let a reader find any specification or knowledge entry by words in its **body**, not just its frontmatter, from any page of the dashboard. The existing index-page search box matches only metadata (id, title, summary, milestone, categories, owners, tags); body prose and knowledge entries are invisible to it. That page-level filter stays as-is — this feature adds a global search layered above it.

## Approach decision

Chosen: **build-time JSON index + bundled MiniSearch** (MIT, ~8 KB gzipped), imported in the layout script and bundled by Astro into the static output. No CDN, no backend; offline hosting still works.

Rejected alternatives:

- **Zero-dependency hand-rolled matching** — keeps runtime deps at zero but gives cruder ranking and no typo tolerance.
- **Pagefind post-build** — scales to thousands of pages, but adds a Rust build dependency wired into `specdash build`, needs UI theming, and targets a scale the project has explicitly declared out of scope (`docs/TROUBLESHOOTING.md` directs projects with thousands of entries to category-scoped dashboards).

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
  "tags": ["git", "ci"],
  "url": "/specs/spec-006/",
  "body": "plain text of the MDX body"
}
```

- `collection` is `spec` or `knowledge`; knowledge records omit `state`, `milestone`, and `priority`-style fields they do not have.
- `url` is base-path aware, like every generated page link.
- `body` is the MDX body stripped to plaintext: import/export lines and JSX tags removed, markdown syntax (heading markers, emphasis, link syntax, code-fence markers) removed, but heading text, list text, checklist text, and code text kept.
- `body` is capped at 20,000 characters per record; matching covers the capped text only.

## Client behavior

The search UI lives in `BaseLayout` so it exists on every page.

- **Trigger:** a search control in the `site-header` nav after Health — an input-shaped button labeled `Search /` on desktop, an icon button on narrow viewports. Keyboard `/` or `Ctrl+K` opens it anywhere; both are ignored while focus is in another input, textarea, or select. `Esc` closes.
- **Overlay:** a native `<dialog>`, top-aligned, containing the query input and result list. `<dialog>` supplies focus trapping and Esc handling.
- **Index loading:** `search-index.json` is fetched lazily on first open of the dialog (not on page load) and cached for the session. The MiniSearch instance indexes `title`, `summary`, `body`, `id`, and `tags`, with `title` boosted highest, then `summary`, then the rest; `prefix: true` and mild fuzziness (`fuzzy: 0.2`) for typo tolerance.
- **Results:** flat ranked list, re-rendered on every keystroke (no debounce needed at the documented scale), capped at the top 20 with an "N matches" count line. Each row shows the entry id in the mono display face, a state dot for specs using the established status color roles, a collection badge for knowledge entries, the title, and one snippet: a window of body text around the first matched term with matches wrapped in `<mark>`. When no matched term occurs in the body (a title/summary/tag-only match), the snippet falls back to the entry summary, unhighlighted.
- **Keyboard in results:** ArrowUp/ArrowDown move a highlighted selection, Enter navigates to the selected entry's page, plain click works too.
- **Empty states:** an empty query shows a short hint line; a query with no matches shows a directive empty state consistent with the roadmap's pattern.
- **URL:** the query is deliberately **not** persisted in the URL. This deviates from the page filters' URL-backed convention because the dialog is a modal, not a view; encoding modal state in the URL would produce confusing Back-button behavior.
- **Styling and motion:** reuse existing dark-theme tokens and card styles; open/close is a simple fade honoring `prefers-reduced-motion`.

## Error handling

- If the index fetch fails, the dialog shows an inline "Search index unavailable" message — never a silent dead search box — and retries on the next open.
- A project with zero entries produces a valid empty index and a working dialog whose empty state simply reports no content.
- Result rows and snippets are constructed with DOM nodes (`textContent` plus explicit `<mark>` elements), never by assigning raw HTML from index content.

## Verification

- **Build output:** `dist/search-index.json` exists, parses as JSON, contains one record per non-archived entry (12 at time of writing: 11 specs + 1 knowledge), contains no markdown or JSX artifacts (no `##`, no `import `, no `<` tag fragments in `body`), and record `url` values carry the base prefix when built with a subpath base.
- **Existing gates stay green:** core and MCP test suites, `html-validate` over the built site.
- **Browser sweep (Playwright):** open the dialog via click and via `/`; search a term that appears only in a spec body (proving full-text reach beyond frontmatter); assert a highlighted snippet renders; Enter navigates to the entry page; Esc closes; repeat the core flow at a mobile viewport (390×844).

## Out of scope

Section-level deep links into entry pages, search analytics, URL persistence of the query, indexing archived entries, and any server-side or external search service.
