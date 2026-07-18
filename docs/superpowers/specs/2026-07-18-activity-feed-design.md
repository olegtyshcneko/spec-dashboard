# Git-Derived Activity Feed — Design

**Date:** 2026-07-18
**Status:** Approved
**Scope:** new `packages/core/src/activity.ts` (+ tests), new `packages/renderer/src/pages/activity/index.astro`, new `packages/renderer/src/components/ActivityHistory.astro`, `packages/renderer/src/layouts/BaseLayout.astro` (nav link), `packages/renderer/src/pages/specs/[...id].astro` and `packages/renderer/src/pages/knowledge/[...id].astro` (history section), shared styles (`assets/style.css`, `packages/renderer/src/styles/global.css`), `docs/AUTOMATION.md`, this repository's Pages workflow (`fetch-depth: 0`)

## Purpose

Show a reader **what happened lately** — a chronological feed of meaningful changes to specifications and knowledge entries, derived from the git history the content already lives in. Nothing in the dashboard currently shows change over time: the overview shows current state, the roadmap shows planned delivery, and `updated` frontmatter dates carry no detail. This feature adds a global `/activity` page and a per-entry history section, both generated at build time. Delivery metrics (cycle time, throughput) are a deliberate follow-up spec layered on the same extracted data, not part of this one.

## Approach decision

Chosen: **live extraction from git at build time**. A new core module walks the git history of the content directory during `specdash build` (the renderer's existing `loadProject` call site) and hands semantic events to the renderer like any other project data. Nothing derived is committed to the repo; the feed can never drift from history. This matches how `reconcile.ts` already treats git as the source of truth.

Rejected alternatives:

- **Committed ledger file** — a CLI/MCP refresh command writing `activity.json` into the repo would make builds git-independent, but the ledger drifts when the refresh step is forgotten, and a generated file lives under version control.
- **Hybrid (live + committed snapshot fallback)** — most robust across environments, but two code paths and cache-staleness rules before the simple version has proven inadequate.
- **Raw commit stream** — rendering `git log` messages directly is far simpler but noisy, and commit messages are not written for dashboard readers. Semantic events derived from frontmatter diffs are the product's language (states, milestones, priorities).

## Extraction (core)

A new module `packages/core/src/activity.ts` exports `extractActivity(root: string, config: DashboardConfig): ActivityResult`. It is deliberately **not** part of `loadProject()` — validation and the MCP server call `loadProject` on hot paths and must not pay for a history walk. Only the build consumes it.

Extraction uses exactly **two git subprocesses** (the `execFileSync` pattern from `reconcile.ts`):

1. `git log --format=… --name-status --find-renames -- <contentDir>` — one pass over every commit touching content, yielding per-commit hash, committer timestamp, author name, and per-file A/M/D/R status.
2. One `git cat-file --batch` process, fed `<sha>:<path>` lines on stdin, to read every needed file revision without spawning a process per revision.

Only frontmatter is parsed from each revision (the text between the opening `---` fences); bodies are never read. Per file lineage (renames followed via `R` status), consecutive revisions are compared oldest → newest by a **pure function** `deriveEvents(older: Frontmatter | null, newer: Frontmatter | null): ActivityEvent[]`, unit-testable without git.

### Event model

```ts
interface ActivityEvent {
  entryId: string;          // frontmatter id at that revision
  entryTitle: string;       // title at that revision
  entryKind: "spec" | "knowledge";
  type: "created" | "state-changed" | "milestone-changed" | "priority-changed" | "updated" | "removed";
  from?: string;            // tracked-field transitions only
  to?: string;              // also initial state on spec "created"
  commit: string;
  timestamp: number;        // committer time, seconds
  author: string;
}
```

- **Specs** track `state`, `milestone`, and `priority`. A single commit changing both state and milestone emits two events.
- **Knowledge** entries have no lifecycle fields; they emit only `created`, `updated`, and `removed`.
- `updated` means a commit touched the entry without changing a tracked field. A file `A` status emits `created`; `D` emits `removed`; a rename alone emits nothing.
- A revision whose frontmatter fails to parse is treated as opaque: the commit yields an `updated` event for that file (identified from its nearest parseable revision) and tracked-field diffing skips over it — extraction never throws on malformed history.
- Events referencing entries that no longer exist stay in the global feed (rendered without a link). No caps and no config knobs in v1: content repos hold tens of entries, and the whole event set is small.

### Availability contract

```ts
interface ActivityResult {
  available: boolean;  // false: not a repo, git missing — events is empty
  shallow: boolean;    // true: history truncated (git rev-parse --is-shallow-repository)
  events: ActivityEvent[];
}
```

`available: false` must never fail the build; the renderer degrades (below) and the build prints a single warning. When `shallow` is true, **`created` events are suppressed entirely** — in a shallow clone the boundary commit shows every file as added, which would fabricate creation events — while state/milestone/priority transitions within the available window remain valid.

## Renderer

### `/activity` page

`packages/renderer/src/pages/activity/index.astro`, with a nav link in `BaseLayout` between Roadmap and Graph. Events render newest first, grouped under day headings (UTC date of the commit timestamp, matching the date-only convention used elsewhere). Each row shows:

- an event-type badge reusing the existing pill language (`state-changed` carries the visual weight; `updated` renders muted);
- the entry's mono ID and title, linking via `hrefFor()` when the entry still exists;
- a human description — "state ready → active", "milestone set to next-release", "priority p2 → p1", "created as backlog", "removed";
- the commit author.

Within one day, consecutive `updated` events for the same entry merge into a single row with a count ("updated ×3") at build time, so plain editing sessions do not flood the feed.

Filtering is URL-backed, consistent with the overview and roadmap conventions: `type` (event type), `kind` (`spec` | `knowledge`), and a text filter over ID, title, and description. The filter script is the page's only client JS.

### Per-entry history

`packages/renderer/src/components/ActivityHistory.astro` renders on spec and knowledge entry pages alongside `EntryMeta`/`Relationships`: that entry's events (matched by `entryId`) as a compact vertical list, newest first, filtered at build time — no client JS. An entry with no recorded events (not yet committed) shows "No recorded history yet."

### Degradation states

- **`available: false`** — the Activity page renders a notice ("Activity requires git history at build time") pointing at `docs/AUTOMATION.md`; the nav link stays; entry pages omit their history section; the build prints one warning.
- **`shallow: true`** — the feed renders with a banner stating history is truncated and linking the docs; `created` events are already suppressed by core. `docs/AUTOMATION.md` gains a `fetch-depth: 0` note for checkout steps, and this repository's own Pages workflow adopts it so the deployed dashboard dogfoods complete history.
- **Uncommitted entries** — visible everywhere else in the dashboard; their history section shows the empty message above.

## Error handling

- Git failures (missing binary, not a repo, unreadable object) are caught in `extractActivity` and produce `available: false`; partial reads never surface a half-built feed.
- Malformed frontmatter in historical revisions degrades to `updated` events (see Event model) — extraction is total over any history.
- All feed and history HTML is built from data at build time; event text is inserted as text nodes/escaped output, never raw HTML.

## Verification

- **Core unit tests (differ):** table-driven cases for every event type; no-tracked-change → `updated`; state+milestone change in one commit → two events; knowledge entries emitting only created/updated/removed; malformed older/newer frontmatter; `null → frontmatter` (created, with initial state for specs) and `frontmatter → null` (removed).
- **Core integration test:** a temp git repo fixture built by the test (init, scripted commits: create, edit body only, flip state, move milestone, rename file, delete file) asserting the exact extracted event list, order, and authorship. A `git clone --depth 1` of the fixture asserts `shallow: true` and the absence of `created` events. A non-repo directory asserts `available: false` without throwing.
- **Build output:** the built site contains `activity/index.html`; every page's nav includes the Activity link; a spec entry page contains its history section; `html-validate` stays green along with the existing core and MCP suites.
- **Browser sweep (Playwright):** day groups render newest first; `type`/`kind`/text filters update rows and the URL; an `updated ×n` merged row appears; clicking an event navigates to the entry page; the entry page shows matching history; layout holds at 390×844 with no horizontal overflow.
- **Degradation:** building a copy of the project without `.git` produces the notice page and the single build warning, not a failure.

## Out of scope

Delivery metrics (cycle time, time-in-state, throughput — the natural follow-up spec on this data), owner-change events, activity in `project.json` or MCP resources, RSS/JSON feeds of activity, config knobs for event caps or time windows, and `file://` support.
