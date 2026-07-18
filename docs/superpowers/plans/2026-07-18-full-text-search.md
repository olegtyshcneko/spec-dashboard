# Global Full-Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of the dashboard gets a global search dialog that finds specs and knowledge entries by words in their MDX **bodies**, not just frontmatter.

**Architecture:** A new core helper converts raw MDX bodies to plaintext via the remark/MDX AST. A new Astro endpoint emits `search-index.json` (one record per non-archived entry). `BaseLayout.astro` gains a header trigger plus a native `<dialog>` whose Astro-bundled script loads the index lazily and searches it with MiniSearch. No backend, no CDN — everything is bundled into the static output.

**Tech Stack:** TypeScript, Astro 7 (static output), MiniSearch 7, unified/remark-parse/remark-mdx, node:test, Playwright MCP for browser verification.

**Design spec:** `docs/superpowers/specs/2026-07-18-full-text-search-design.md` — the authority if anything here seems ambiguous.

## Global Constraints

- Node.js 22.12+, npm workspaces; core builds with `tsc`, tests run against `packages/core/dist` (build before testing).
- New dependencies, exact: `unified@^11.0.5`, `remark-parse@^11.0.0`, `remark-mdx@^3.1.1` (core); `minisearch@^7.2.0` (renderer). No other new packages.
- MiniSearch config, exact: fields `["title", "summary", "body", "id", "tags"]`, boosts `{ title: 4, id: 3, summary: 2, tags: 2, body: 1 }`, `prefix: true`, `fuzzy: 0.2`, `combineWith: "AND"`.
- Body plaintext capped at **20,000** characters per record. Result list shows at most **20** rows.
- Copy, exact: count line `Showing X of N matches`; load failure `Search index unavailable.`; empty-query hint `Type to search specs and knowledge.`; no-match state `No matches for “<query>”. Try fewer or different words.`
- The search query is never persisted in the URL.
- Result rows and snippets are built with DOM nodes (`textContent`, `createElement`) — never `innerHTML` from index content.
- The index URL reaches the script via `data-index-url={withBase("search-index.json")}`; the index is cached per page load; a failed load resets the cached promise so reopening retries.
- Every interactive element keeps the accessibility contract in the spec (`showModal()`, accessible names, combobox pattern with `aria-activedescendant`, `role="status"` / `role="alert"` regions, non-color selection cues).
- Playwright MCP outputs go under the project's `.playwright-mcp/`, never /tmp. Call `browser_close` when the browser session is done.

---

### Task 1: Core MDX→plaintext transform

**Files:**
- Modify: `packages/core/package.json` (deps added by npm)
- Create: `packages/core/src/search-text.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/search-text.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `mdxBodyToPlainText(body: string, limit?: number): string` exported from `@spec-dashboard/core` (i.e. importable from `packages/core/dist/index.js`). `limit` defaults to 20000. Input is an MDX body **without** frontmatter (core strips frontmatter before storing `entry.body`).

- [ ] **Step 1: Install the parser dependencies**

```bash
npm install -w @spec-dashboard/core unified@^11.0.5 remark-parse@^11.0.0 remark-mdx@^3.1.1
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/test/search-text.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mdxBodyToPlainText } from "../dist/index.js";

const sample = [
  'import { Chart } from "./chart.js";',
  'import Widget',
  '  from "widget";',
  "",
  "## Delivery notes",
  "",
  "The **reconcile** loop compares [Git evidence](https://example.com/evidence) with specs.",
  "",
  "![Roadmap overview](./roadmap.png)",
  "",
  '<Widget kind="stat" label="Specs shipped">',
  "  Eleven specs shipped.",
  "</Widget>",
  "",
  "{new Date().getFullYear()}",
  "",
  "Run `specdash validate` before building.",
  "",
  "```ts",
  'import MiniSearch from "minisearch";',
  'const button = "<button>";',
  "```",
].join("\n");

test("strips MDX syntax but keeps searchable text including code content", () => {
  assert.equal(
    mdxBodyToPlainText(sample),
    'Delivery notes The reconcile loop compares Git evidence with specs. ' +
      'Roadmap overview Eleven specs shipped. Run specdash validate before building. ' +
      'import MiniSearch from "minisearch"; const button = "<button>";',
  );
});

test("caps output at the limit", () => {
  const long = "word ".repeat(6000);
  assert.equal(mdxBodyToPlainText(long).length, 20000);
  assert.equal(mdxBodyToPlainText("alpha beta gamma", 5), "alpha");
});

test("returns empty string for empty body", () => {
  assert.equal(mdxBodyToPlainText(""), "");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core
```

Expected: FAIL — `SyntaxError: The requested module '../dist/index.js' does not provide an export named 'mdxBodyToPlainText'`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/search-text.ts`:

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";

const parser = unified().use(remarkParse).use(remarkMdx);

interface MdastNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MdastNode[];
}

const DROPPED_TYPES = new Set([
  "mdxjsEsm",
  "mdxFlowExpression",
  "mdxTextExpression",
  "yaml",
  "html",
  "definition",
]);

const VALUE_TYPES = new Set(["text", "code", "inlineCode"]);

export function mdxBodyToPlainText(body: string, limit = 20000): string {
  const tree = parser.parse(body) as unknown as MdastNode;
  const parts: string[] = [];
  collect(tree, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function collect(node: MdastNode, parts: string[]): void {
  if (DROPPED_TYPES.has(node.type)) return;
  if (node.type === "image" || node.type === "imageReference") {
    if (node.alt) parts.push(node.alt);
    return;
  }
  if (VALUE_TYPES.has(node.type) && typeof node.value === "string") {
    parts.push(node.value);
    return;
  }
  for (const child of node.children ?? []) collect(child, parts);
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./search-text.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core
```

Expected: PASS — all tests in `core.test.mjs` and `search-text.test.mjs` green.

- [ ] **Step 6: Commit**

```bash
git add packages/core package.json package-lock.json
git commit -m "feat(core): add AST-based MDX body to plaintext transform"
```

---

### Task 2: search-index.json endpoint

**Files:**
- Create: `packages/renderer/src/pages/search-index.json.ts`

**Interfaces:**
- Consumes: `mdxBodyToPlainText` from Task 1; `projectModel`, `withBase`, `hrefFor` from `packages/renderer/src/lib/project.ts` (existing).
- Produces: `dist/search-index.json` — a JSON array of records. Spec records: `{ id, collection: "spec", title, summary, kind, state, milestone?, tags, url, body }`; knowledge records: `{ id, collection: "knowledge", title, summary, kind, tags, url, body }`. **Every field is a string**; `tags` is space-joined; `url` is base-prefixed. Task 3's client relies on `id`, `collection`, `title`, `summary`, `state`, `url`, `body`.

- [ ] **Step 1: Create the endpoint**

Create `packages/renderer/src/pages/search-index.json.ts` (the relative core import matches `lib/project.ts`'s existing idiom):

```ts
import type { APIRoute } from "astro";
import { mdxBodyToPlainText } from "../../../core/dist/index.js";
import { projectModel, hrefFor } from "../lib/project";

const specRecords = projectModel.specs
  .filter((entry) => entry.data.state !== "archived")
  .map((entry) => ({
    id: entry.id,
    collection: "spec",
    title: entry.data.title,
    summary: entry.data.summary,
    kind: entry.data.kind,
    state: entry.data.state,
    ...(entry.data.milestone ? { milestone: entry.data.milestone } : {}),
    tags: (entry.data.tags ?? []).join(" "),
    url: hrefFor("specs", entry.id),
    body: mdxBodyToPlainText(entry.body),
  }));

const knowledgeRecords = projectModel.knowledge.map((entry) => ({
  id: entry.id,
  collection: "knowledge",
  title: entry.data.title,
  summary: entry.data.summary,
  kind: entry.data.kind,
  tags: (entry.data.tags ?? []).join(" "),
  url: hrefFor("knowledge", entry.id),
  body: mdxBodyToPlainText(entry.body),
}));

export const GET: APIRoute = async () =>
  new Response(JSON.stringify([...specRecords, ...knowledgeRecords]), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
```

- [ ] **Step 2: Build the site**

```bash
npm run build
```

Expected: build completes; `dist/search-index.json` exists.

- [ ] **Step 3: Assert the emitted index (derived count, string fields)**

```bash
node --input-type=module -e "
import fs from 'node:fs';
import fg from 'fast-glob';
const records = JSON.parse(fs.readFileSync('dist/search-index.json', 'utf8'));
const files = fg.sync('content/{specs,knowledge}/*.mdx');
const expected = files.filter((f) => !/^state:\s*archived\b/m.test(fs.readFileSync(f, 'utf8'))).length;
if (records.length !== expected) throw new Error('count ' + records.length + ' != ' + expected);
for (const r of records) {
  for (const k of ['id', 'collection', 'title', 'summary', 'kind', 'tags', 'url', 'body']) {
    if (typeof r[k] !== 'string') throw new Error(r.id + ': field ' + k + ' is not a string');
  }
  if (!r.url.startsWith('/')) throw new Error(r.id + ': url ' + r.url);
  if (r.tags.includes(',')) throw new Error(r.id + ': tags must be space-joined, found comma');
  if (/^##\s/m.test(r.body) || r.body.includes('](')) throw new Error(r.id + ': markdown artifacts in body');
}
console.log('search-index.json OK:', records.length, 'records');
"
```

Expected: `search-index.json OK: <N> records` where N equals the current non-archived entry count. (Do not hard-code N — the count is derived.)

- [ ] **Step 4: Assert base-prefixed URLs under a subpath build**

```bash
node packages/cli/dist/index.js build --root . --base /spec-dashboard/ --out-dir dist-subpath
node --input-type=module -e "
import fs from 'node:fs';
const records = JSON.parse(fs.readFileSync('dist-subpath/search-index.json', 'utf8'));
if (!records.every((r) => r.url.startsWith('/spec-dashboard/'))) throw new Error('subpath base missing from urls');
console.log('subpath urls OK');
"
rm -rf dist-subpath
```

Expected: `subpath urls OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/pages/search-index.json.ts
git commit -m "feat(renderer): emit search-index.json build-time endpoint"
```

---

### Task 3: Search dialog UI in BaseLayout

**Files:**
- Modify: `packages/renderer/package.json` (dep added by npm), root `package-lock.json`
- Modify: `packages/renderer/src/layouts/BaseLayout.astro`
- Modify: `assets/style.css` (`.site-header nav` rule ~line 151, plus new styles at end of file)

**Interfaces:**
- Consumes: `dist/search-index.json` record shape from Task 2; `withBase` from `lib/project.ts`.
- Produces: DOM contract for Task 4 — `#search-trigger` (button, `aria-label="Search"`), `#search-dialog` (dialog, `data-index-url`), `#search-input` (combobox), `#search-results` (listbox with `#search-option-<i>` rows), `#search-status` (`role="status"`), `#search-error` (`role="alert"`, hidden by default). Shortcuts `/`, `Ctrl+K`, `Meta+K`; Esc closes; focus returns to the opener.

- [ ] **Step 1: Record html-validate baselines before any change**

```bash
npm run build
npx --yes html-validate dist/index.html 2>&1 | tail -1
npx --yes html-validate dist/roadmap/index.html 2>&1 | tail -1
```

Note both finding counts; after this task they must not grow.

- [ ] **Step 2: Add the MiniSearch dependency**

```bash
npm install -w @spec-dashboard/renderer minisearch@^7.2.0
```

- [ ] **Step 3: Add the trigger, dialog, and script to BaseLayout**

In `packages/renderer/src/layouts/BaseLayout.astro`, replace the closing `</nav>` line inside the header with:

```astro
          <button type="button" id="search-trigger" class="search-trigger" aria-label="Search">
            <span class="search-glyph" aria-hidden="true">⌕</span>
            <span class="search-trigger-label" aria-hidden="true">Search</span>
            <kbd aria-hidden="true">/</kbd>
          </button>
        </nav>
```

Then replace the closing `</body>` with the dialog, script, and `</body>`:

```astro
    <dialog id="search-dialog" class="search-dialog" aria-label="Search" data-index-url={withBase("search-index.json")}>
      <div class="search-head">
        <input
          id="search-input"
          type="search"
          role="combobox"
          aria-expanded="false"
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-label="Search specs and knowledge"
          placeholder="Search specs and knowledge…"
          autocomplete="off"
        />
        <button type="button" id="search-close" class="search-close">Close</button>
      </div>
      <p id="search-status" class="search-status" role="status"></p>
      <p id="search-error" class="search-error" role="alert" hidden>Search index unavailable.</p>
      <ul id="search-results" class="search-results" role="listbox" aria-label="Search results"></ul>
    </dialog>
    <script>
      import MiniSearch from "minisearch";

      const dialog = document.querySelector("#search-dialog");
      const trigger = document.querySelector("#search-trigger");
      const input = document.querySelector("#search-input");
      const closeButton = document.querySelector("#search-close");
      const status = document.querySelector("#search-status");
      const errorBox = document.querySelector("#search-error");
      const list = document.querySelector("#search-results");
      const indexUrl = dialog.dataset.indexUrl;

      let indexPromise = null;
      let mini = null;
      let results = [];
      let selected = 0;
      let opener = null;

      function loadIndex() {
        if (!indexPromise) {
          indexPromise = (async () => {
            const response = await fetch(indexUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const records = await response.json();
            const instance = new MiniSearch({
              fields: ["title", "summary", "body", "id", "tags"],
              storeFields: ["id", "collection", "title", "summary", "state", "url", "body"],
              searchOptions: {
                boost: { title: 4, id: 3, summary: 2, tags: 2, body: 1 },
                prefix: true,
                fuzzy: 0.2,
                combineWith: "AND",
              },
            });
            instance.addAll(records);
            return instance;
          })();
          indexPromise.catch(() => {
            indexPromise = null;
          });
        }
        return indexPromise;
      }

      function openSearch() {
        if (dialog.open) return;
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
        dialog.showModal();
        input.focus();
        errorBox.hidden = true;
        if (mini) {
          render();
          return;
        }
        dialog.setAttribute("aria-busy", "true");
        status.textContent = "Loading search index…";
        loadIndex()
          .then((instance) => {
            mini = instance;
            dialog.removeAttribute("aria-busy");
            render();
          })
          .catch(() => {
            dialog.removeAttribute("aria-busy");
            status.textContent = "";
            errorBox.hidden = false;
          });
      }

      function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      function buildSnippet(result) {
        const snippet = document.createElement("p");
        snippet.className = "search-snippet";
        const bodyLower = result.body.toLowerCase();
        const bodyTerm = result.terms.find(
          (term) => (result.match[term] || []).includes("body") && bodyLower.includes(term.toLowerCase()),
        );
        if (!bodyTerm) {
          snippet.textContent = result.summary;
          return snippet;
        }
        const at = bodyLower.indexOf(bodyTerm.toLowerCase());
        const start = Math.max(0, at - 60);
        const end = Math.min(result.body.length, at + bodyTerm.length + 120);
        const windowText = result.body.slice(start, end);
        const termSet = new Set(result.terms.map((term) => term.toLowerCase()));
        const pattern = new RegExp(`(${result.terms.map(escapeRegExp).join("|")})`, "gi");
        if (start > 0) snippet.append("…");
        for (const piece of windowText.split(pattern)) {
          if (!piece) continue;
          if (termSet.has(piece.toLowerCase())) {
            const mark = document.createElement("mark");
            mark.textContent = piece;
            snippet.append(mark);
          } else {
            snippet.append(piece);
          }
        }
        if (end < result.body.length) snippet.append("…");
        return snippet;
      }

      function resultRow(result, index) {
        const row = document.createElement("li");
        row.id = `search-option-${index}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        row.className = "search-result";
        const head = document.createElement("div");
        head.className = "search-result-head";
        const idBadge = document.createElement("span");
        idBadge.className = "search-result-id";
        idBadge.textContent = result.id;
        head.append(idBadge);
        if (result.collection === "spec") {
          const dot = document.createElement("span");
          dot.className = "search-state-dot";
          dot.dataset.state = result.state;
          dot.setAttribute("aria-hidden", "true");
          const stateText = document.createElement("span");
          stateText.className = "sr-only";
          stateText.textContent = result.state;
          head.append(dot, stateText);
        }
        const title = document.createElement("span");
        title.className = "search-result-title";
        title.textContent = result.title;
        head.append(title);
        row.append(head, buildSnippet(result));
        row.addEventListener("click", () => {
          location.href = result.url;
        });
        return row;
      }

      function applySelection() {
        [...list.children].forEach((row, index) => {
          row.setAttribute("aria-selected", index === selected ? "true" : "false");
          row.classList.toggle("is-selected", index === selected);
        });
        const active = list.children[selected];
        if (active) {
          input.setAttribute("aria-activedescendant", active.id);
          active.scrollIntoView({ block: "nearest" });
        } else {
          input.removeAttribute("aria-activedescendant");
        }
      }

      function render() {
        if (!mini) return;
        const query = input.value.trim();
        list.replaceChildren();
        errorBox.hidden = true;
        results = [];
        selected = 0;
        if (!query) {
          input.setAttribute("aria-expanded", "false");
          input.removeAttribute("aria-activedescendant");
          status.textContent = "Type to search specs and knowledge.";
          return;
        }
        const all = mini.search(query);
        results = all.slice(0, 20);
        if (!results.length) {
          input.setAttribute("aria-expanded", "false");
          input.removeAttribute("aria-activedescendant");
          status.textContent = `No matches for “${query}”. Try fewer or different words.`;
          return;
        }
        input.setAttribute("aria-expanded", "true");
        status.textContent = `Showing ${results.length} of ${all.length} matches`;
        results.forEach((result, index) => list.append(resultRow(result, index)));
        applySelection();
      }

      trigger.addEventListener("click", openSearch);
      closeButton.addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => {
        if (opener) opener.focus();
        opener = null;
      });
      input.addEventListener("input", render);
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (selected < results.length - 1) {
            selected += 1;
            applySelection();
          }
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          if (selected > 0) {
            selected -= 1;
            applySelection();
          }
        } else if (event.key === "Enter" && results.length) {
          event.preventDefault();
          location.href = results[selected].url;
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        const target = event.target;
        const editable =
          target instanceof HTMLElement &&
          (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
        if (editable) return;
        const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        const isK = (event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey) && !event.altKey;
        if (isSlash || isK) {
          event.preventDefault();
          openSearch();
        }
      });
    </script>
  </body>
```

- [ ] **Step 4: Add the styles**

In `assets/style.css`, add `flex-wrap: wrap;` to the existing `.site-header nav` rule (~line 151):

```css
.site-header nav { display: flex; flex-wrap: wrap; gap: 14px; font-size: 14px; align-items: center; }
```

Append at the end of the file:

```css
/* Global search */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.search-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.search-trigger:hover { color: var(--accent); border-color: var(--accent); }
.search-trigger kbd {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.search-dialog {
  width: min(560px, calc(100vw - 32px));
  margin: 10vh auto auto;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}
.search-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
@media (prefers-reduced-motion: no-preference) {
  .search-dialog[open] { animation: search-fade 120ms ease-out; }
}
@keyframes search-fade { from { opacity: 0; } }
.search-head {
  display: flex;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--border);
}
.search-head input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-muted);
  color: var(--text);
  font: inherit;
}
.search-close {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-muted);
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}
.search-status, .search-error { padding: 10px 14px; margin: 0; font-size: 13px; color: var(--text-muted); }
.search-error { color: var(--s-issue-fg); }
.search-results {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 50vh;
  overflow-y: auto;
}
.search-result {
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
}
.search-result:hover { background: var(--surface-muted); }
.search-result.is-selected {
  background: var(--surface-muted);
  border-color: var(--accent);
}
.search-result-head { display: flex; align-items: center; gap: 8px; }
.search-result-id { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-muted); }
.search-result-title { font-weight: 600; }
.search-state-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--s-backlog-fg); }
.search-state-dot[data-state="shipped"] { background: var(--s-implemented-fg); }
.search-state-dot[data-state="active"] { background: var(--s-wip-fg); }
.search-state-dot[data-state="review"] { background: var(--s-nice-fg); }
.search-state-dot[data-state="blocked"] { background: var(--s-issue-fg); }
.search-snippet { margin: 6px 0 0; font-size: 13px; color: var(--text-muted); }
.search-snippet mark { background: transparent; color: var(--accent); font-weight: 600; }
@media (max-width: 640px) {
  .search-trigger-label, .search-trigger kbd { display: none; }
}
```

- [ ] **Step 5: Build and compare html-validate baselines**

```bash
npm run build
npx --yes html-validate dist/index.html 2>&1 | tail -1
npx --yes html-validate dist/roadmap/index.html 2>&1 | tail -1
```

Expected: build succeeds; finding counts do not exceed the Step 1 baselines. If they grew, fix the new markup until they match.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer assets/style.css package.json package-lock.json
git commit -m "feat(renderer): global full-text search dialog in BaseLayout"
```

---

### Task 4: Browser verification sweep

**Files:** none created except Playwright MCP outputs under `.playwright-mcp/` (project root, never /tmp). Fixes discovered here are amended into the Task 3 files with a follow-up commit.

**Interfaces:**
- Consumes: the DOM contract from Task 3 (`#search-trigger`, `#search-dialog`, `#search-input`, `#search-results`, `#search-option-<i>`, `#search-status`, `#search-error`).

- [ ] **Step 1: Serve the built site**

```bash
npm run build
python3 -m http.server 4173 --directory dist &
```

- [ ] **Step 2: Pick verification terms from the live content**

A **body-only** term (in a body, absent from every frontmatter block): verify with

```bash
grep -c "interval overlap" content/specs/roadmap-time-range-filter.mdx
sed -n '1,25p' content/specs/roadmap-time-range-filter.mdx | grep -c "overlap" || true
```

Expected: first command ≥ 1, second 0 — `interval overlap` matches SPEC-011 through its body only. If content changed and this no longer holds, pick another term the same way. Similarly pick a **frontmatter-only** term (in a `summary:`, absent from the body below it) for the fallback check — `ninety` currently qualifies (SPEC-011's summary says "next ninety days"; its body uses digits): verify with `grep -n "ninety" content/specs/*.mdx` that every hit is in frontmatter.

- [ ] **Step 3: Run the sweep with Playwright MCP against `http://localhost:4173/`**

Assert each item; screenshot failures into `.playwright-mcp/`:

1. Click `#search-trigger` → dialog open, focus in `#search-input` (`document.activeElement`).
2. Type `interval overlap` → SPEC-011 row appears with a `<mark>`-highlighted snippet; `#search-status` reads `Showing X of N matches`.
3. ArrowDown then Enter → browser navigates to the SPEC-011 detail page.
4. Back on the home page: press `/` → dialog opens. Press Esc → dialog closes and `document.activeElement` is `#search-trigger` (focus restored). Press `Control+k` → dialog opens.
5. Focus the existing index-page filter input, press `/` → dialog does **not** open (guarded in editable targets).
6. Query `zzzzqqqq` → `#search-status` shows the `No matches for “zzzzqqqq”…` empty state, listbox empty.
7. Query the frontmatter-only term from Step 2 → the matching row's snippet shows the entry summary with **no** `<mark>`.
8. Failure path: `mv dist/search-index.json dist/search-index.json.bak`, hard-reload, open search → `#search-error` visible (`Search index unavailable.`). Restore with `mv dist/search-index.json.bak dist/search-index.json`, close and reopen the dialog → search works (retry succeeded without reload).
9. Resize to 390×844 → only the glyph shows on `#search-trigger` (accessible name still "Search"), `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal overflow), and the type-and-navigate flow works.
10. Reduced motion: confirm the built CSS wraps the dialog animation in `@media (prefers-reduced-motion: no-preference)`:
    `grep -c "prefers-reduced-motion: no-preference" dist/assets/*.css assets/style.css` ≥ 1 (check whichever path the built site serves).

- [ ] **Step 4: Verify the fetch under a subpath base**

```bash
node packages/cli/dist/index.js build --root . --base /spec-dashboard/ --out-dir dist-subpath
mkdir -p .subpath-serve && ln -sfn ../dist-subpath .subpath-serve/spec-dashboard
python3 -m http.server 4174 --directory .subpath-serve &
```

With Playwright MCP, open `http://localhost:4174/spec-dashboard/`, open search, run a query, then check `browser_network_requests`: the index request URL must be `http://localhost:4174/spec-dashboard/search-index.json` with status 200, and result Enter-navigation must land on a `/spec-dashboard/…` page. Clean up:

```bash
rm -rf dist-subpath .subpath-serve
```

- [ ] **Step 5: Shut down cleanly**

Kill both `http.server` background jobs and call the Playwright MCP `browser_close` tool.

- [ ] **Step 6: Commit any fixes**

If Step 3 surfaced fixes, apply them to the Task 3 files and commit:

```bash
git add -u
git commit -m "fix(renderer): search dialog fixes from browser verification"
```

---

### Task 5: Documentation and self-capture

**Files:**
- Modify: `README.md`, `docs/USER_GUIDE.md`, `docs/DASHBOARD_SPEC.md`
- Create: `content/specs/full-text-search.mdx`
- Modify: `packages/mcp/test/server.test.mjs`

**Interfaces:**
- Consumes: nothing structural; records the shipped feature in the dashboard's own content, which changes live-repo counts the MCP test pins.

- [ ] **Step 1: Update the docs**

In `README.md`, in the "Dashboard intelligence" bullet list, add after the graphical explorer bullet:

```markdown
- a global full-text search dialog (`/` or `Ctrl+K`) over spec and knowledge bodies with ranked, highlighted results;
```

In `docs/USER_GUIDE.md`, in the reader-features list (the one containing "A filter-first roadmap with Current/All/Completed scope…"), add:

```markdown
- Global full-text search from every page: `/` or `Ctrl+K` opens a dialog that ranks specs and knowledge by title, summary, id, tags, and body text, with highlighted snippets.
```

In `docs/DASHBOARD_SPEC.md`, in the generated-outputs list (the one containing `/roadmap/index.html …`), add:

```markdown
- `/search-index.json` with one plaintext search record per non-archived specification and knowledge entry, consumed by the global search dialog present on every page;
```

- [ ] **Step 2: Capture SPEC-012 in the dashboard's own content**

Create `content/specs/full-text-search.mdx`:

```mdx
---
schemaVersion: 1
id: SPEC-012
title: Global full-text search
summary: Find any specification or knowledge entry by words in its body from a search dialog available on every page.
kind: feature
state: shipped
priority: p1
milestone: next-release
categories: [experience]
tags: [search, filters, accessibility]
owners: [maintainer]
blockers: []
dependsOn: [SPEC-001]
related: [SPEC-003]
sourceRefs:
  - type: file
    value: packages/core/src/search-text.ts
  - type: file
    value: packages/renderer/src/pages/search-index.json.ts
  - type: file
    value: packages/renderer/src/layouts/BaseLayout.astro
  - type: file
    value: docs/superpowers/specs/2026-07-18-full-text-search-design.md
created: 2026-07-18
updated: 2026-07-18
---

## Intent

Let a reader find work and knowledge by words in the prose, not just frontmatter metadata, without leaving the page they are on.

## Acceptance criteria

- [x] Emit a build-time search index with one plaintext record per non-archived specification and knowledge entry.
- [x] Convert MDX bodies to searchable plaintext through the remark AST, keeping code text and dropping ESM, expressions, and JSX syntax.
- [x] Open a global search dialog from every page via a header control, `/`, `Ctrl+K`, or `Meta+K`, honoring editable-target and composition guards.
- [x] Rank results with boosted title/id/summary matching, AND term combination, prefix and fuzzy matching, and highlighted body snippets.
- [x] Meet the modal combobox accessibility contract: focus trapping, accessible names, live status, non-color selection cues, and focus restoration.
- [x] Handle index load failures with a visible alert and a real retry on reopen.

## Verification

- Core unit tests cover the MDX plaintext transform fixtures and cap behavior.
- Build assertions verify record counts, string fields, and subpath base prefixes.
- A Playwright sweep verified open paths, body-only matching, snippet highlighting, keyboard navigation, failure retry, and the 390px layout.

## Risks

- The bundled index grows with content volume; the documented scale guidance (category-scoped dashboards beyond hundreds of entries) bounds it.
- Search quality depends on the plaintext transform staying faithful as MDX usage evolves.

## Out of scope

Section-level deep links, URL persistence of queries, search analytics, and archived-entry indexing.
```

- [ ] **Step 3: Update the MCP server test's pinned counts**

In `packages/mcp/test/server.test.mjs`: change `assert.equal(result.structuredContent.specs, 11);` to `12`, and `assert.equal(scan.structuredContent.nextSpecId, "SPEC-012");` to `"SPEC-013"`.

- [ ] **Step 4: Run every gate**

```bash
npm run validate
npm test
npm run build
```

Expected: validation reports 12 specs, 1 knowledge entry, 0 diagnostics; both suites pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/USER_GUIDE.md docs/DASHBOARD_SPEC.md content/specs/full-text-search.mdx packages/mcp/test/server.test.mjs
git commit -m "docs: document global search and capture SPEC-012"
```

---

## Out of plan scope

Version bump and release tagging (`v0.9.0`) follow the repository's separate release flow once the feature is accepted.
