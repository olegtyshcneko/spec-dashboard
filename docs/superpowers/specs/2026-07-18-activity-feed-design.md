# Git-Derived Activity Feed — Design

**Date:** 2026-07-18
**Status:** Approved (hardened after external design review, 2026-07-18)
**Scope:** new `packages/core/src/activity.ts` (+ tests), `packages/core/src/index.ts` (barrel export), new `packages/renderer/src/pages/activity/index.astro`, new `packages/renderer/src/components/ActivityHistory.astro`, `packages/renderer/src/lib/project.ts` (extraction call site), `packages/renderer/src/layouts/BaseLayout.astro` (nav link), `packages/renderer/src/pages/specs/[...id].astro` and `packages/renderer/src/pages/knowledge/[...id].astro` (history section), shared styles (`assets/style.css`, `packages/renderer/src/styles/global.css`), `docs/AUTOMATION.md`, this repository's Pages workflow (`fetch-depth: 0`)

## Purpose

Show a reader **what happened lately** — a chronological feed of meaningful changes to specifications and knowledge entries, derived from the git history the content already lives in. Nothing in the dashboard currently shows change over time: the overview shows current state, the roadmap shows planned delivery, and `updated` frontmatter dates carry no detail. This feature adds a global `/activity` page and a per-entry history section, both generated at build time. Delivery metrics (cycle time, throughput) are a deliberate follow-up spec layered on the same extracted data, not part of this one.

## Approach decision

Chosen: **live extraction from git at build time**. A new core module walks the git history of the content directory when the renderer loads project data and hands semantic events to the renderer like any other project data. Nothing derived is committed to the repo; the feed can never drift from history. This matches how `reconcile.ts` already treats git as the source of truth.

Rejected alternatives:

- **Committed ledger file** — a CLI/MCP refresh command writing `activity.json` into the repo would make builds git-independent, but the ledger drifts when the refresh step is forgotten, and a generated file lives under version control.
- **Hybrid (live + committed snapshot fallback)** — most robust across environments, but two code paths and cache-staleness rules before the simple version has proven inadequate.
- **Raw commit stream** — rendering `git log` messages directly is far simpler but noisy, and commit messages are not written for dashboard readers. Semantic events derived from frontmatter diffs are the product's language (states, milestones, priorities).

## Extraction (core)

A new module `packages/core/src/activity.ts` exports `extractActivity(root: string, config: DashboardConfig): ActivityResult`, re-exported from the core barrel. It is deliberately **not** part of `loadProject()` — validation and the MCP server call `loadProject` on hot paths and must not pay for a history walk. It runs wherever the renderer loads project data: `packages/renderer/src/lib/project.ts` calls it once at module scope, exactly like `loadProject`. That covers `specdash build` and `specdash dev` identically; in dev the result is computed at server start and is **not** invalidated on content change — the same accepted behavior `loadProject` already has in dev.

### History model: first-parent walk

Extraction walks **first-parent history only**: `git log --first-parent --diff-merges=first-parent`. The feed answers "what landed on this branch", so commits inside unmerged or side branches are invisible, and changes that arrive via a merge commit are attributed to the merge commit (its committer time and author). This is a deliberate choice, not a limitation: diffing arbitrary DAG order would fabricate transitions between sibling branches. The walk order emitted by `git log` (newest first, deterministic) is the canonical event order (see Determinism).

### Git invocations

All git output that contains paths is **NUL-delimited**; nothing parses paths from line-based output. Git runs from the **repository toplevel** (`git rev-parse --show-toplevel`), and the content pathspec is computed relative to the toplevel — the dashboard root may be nested inside a larger repository, so config-relative paths must never be handed to git directly.

1. Preflight: `git rev-parse --show-toplevel` and `--is-shallow-repository` (failure → `available: false`).
2. `git log --first-parent --diff-merges=first-parent -z --name-status --find-renames --format=… -- <toplevel-relative contentDir>` — per-commit hash, committer timestamp, author name, and NUL-delimited per-file A/M/D/R status. Run via `execFileSync` with an **explicit `maxBuffer`** (64 MiB); name-status output is metadata-sized.
3. One `git cat-file --batch -Z` process fed `<sha>:<toplevel-relative path>` requests for every needed revision. Responses are parsed by the **declared byte size** in each object header — blob content is arbitrary bytes and must never be split on delimiters. Per-object `missing` / non-blob responses do not fail the process; the affected revision is treated as opaque (below). The batch runs with an explicit `maxBuffer` (256 MiB); overflow or any subprocess failure degrades to `available: false` with a reason, never a partial feed.

Whole blobs are transferred (git offers no cheaper granularity), but only the frontmatter block — the text between the opening `---` fences — is ever parsed; bodies are discarded unread. At this project's documented scale (tens of entries, KB-sized MDX) total blob volume is a few megabytes.

### Historical frontmatter projection

Historical revisions are **not** validated against today's Zod schemas — old revisions may predate current required fields or enum values and are still meaningful history. A revision is **parseable** when its frontmatter block parses as YAML to an object with a string `id`. From a parseable revision, extraction projects only the tracked fields, all as optional strings: `id`, `title`, `state`, `milestone`, `priority`. A missing field and an explicit `null` are both "unset" (rendered as "milestone set to X" / "milestone cleared"). Anything else about the revision is ignored.

### Event derivation

Two layers with an explicit boundary:

- **Pure differ** — `deriveChanges(older: TrackedFields | null, newer: TrackedFields | null): ChangeDelta[]`, where a delta is `{ type, from?, to? }` over the six event types. `null → fields` yields `created` (with initial state for specs); `fields → null` yields `removed`; field-level differences yield `state-changed` / `milestone-changed` / `priority-changed`; a revision pair with no tracked-field difference yields a single `updated`. Unit-testable with no git and no commit context.
- **Enrichment** — the extractor maps each delta plus its commit metadata (hash, committer time, author) and file status into an `ActivityEvent`. File status drives which differ call happens: `A` → `deriveChanges(null, rev)`; `D` → `deriveChanges(rev, null)`; `M` → diff against the previous revision in first-parent lineage; `R` alone (rename, identical content) → no differ call and **no event**; `R` with content change → treated as `M` under the new path.

```ts
interface ActivityEvent {
  entryId: string;          // frontmatter id at that revision
  entryTitle: string;       // title at that revision (id used when title is unset)
  entryKind: "spec" | "knowledge";
  type: "created" | "state-changed" | "milestone-changed" | "priority-changed" | "updated" | "removed";
  from?: string;
  to?: string;
  commit: string;
  timestamp: number;        // committer time, seconds
  author: string;
}
```

- **Specs** track `state`, `milestone`, and `priority`; one commit changing several tracked fields emits one event per field. **Knowledge** entries (under `knowledge/`) emit only `created`, `updated`, and `removed`. `entryKind` comes from the file's directory at that revision.
- **Identity is the frontmatter `id`.** If a revision changes an entry's `id`, that commit emits `removed` for the old id and `created` for the new one — id edits are identity changes, consistent with the product rule that ids are stable. Id reuse after deletion attaches the old lineage to the per-entry history of the new entry; this is an accepted, documented limitation (stable ids are a product contract, reuse is author error surfaced by review, not by this feature).
- **Renames** are best-effort: `--find-renames` detection is a similarity heuristic, and an undetected rename (heavily rewritten file) legitimately surfaces as `removed` + `created` — accepted. A rename that crosses `specs/` ↔ `knowledge/` changes `entryKind` and is treated as `removed` + `created`, never a silent kind flip. History from before a file (or the content directory itself) moved into the pathspec is out of reach and simply starts at the move; accepted.

### Opaque revisions

A revision is **opaque** when its frontmatter is unparseable (per the projection rule) or its blob is unreadable (`missing` from cat-file). Attribution rules:

- The opaque commit emits a single `updated` event, using id/title from the **nearest earlier parseable revision** in the same lineage (or the nearest later one when the file has no earlier parseable revision).
- Tracked-field diffing **skips over** opaque revisions: the next parseable revision is diffed against the last parseable one, so a state change hidden inside an opaque span is attributed to the commit that made the file parseable again.
- A file whose first revisions are opaque emits `created` at its **first parseable** revision (with that revision's state).
- Deleting a file that never had a parseable revision emits nothing. Deleting a file whose last parseable revision exists emits `removed` with that revision's id/title.

Extraction never throws on malformed history; every rule above degrades to truthful, attributable output.

### Availability contract

```ts
interface ActivityResult {
  available: boolean;  // false: git missing, not a repo, subprocess failure, buffer overflow
  reason?: string;     // set when available is false — surfaced in the build warning
  shallow: boolean;    // git rev-parse --is-shallow-repository
  events: ActivityEvent[];
}
```

`available: false` must never fail the build; the renderer degrades (below) and the build prints one warning that includes `reason`. When `shallow` is true, `created` events are suppressed **only for shallow boundary commits** — the graft commits listed in the repository's shallow file (`git rev-parse --git-path shallow`), where every file spuriously appears added. Genuine creations after the boundary keep their `created` events; transitions within the available window are valid throughout.

### Determinism

Event order is total and reproducible: primary order is the first-parent walk order from `git log` (newest first — deterministic even for equal timestamps); within one commit, events sort by toplevel-relative path, then by fixed event-type order (`created`, `state-changed`, `milestone-changed`, `priority-changed`, `updated`, `removed`). Integration tests assert exact sequences against this rule.

## Renderer

### `/activity` page

`packages/renderer/src/pages/activity/index.astro`, with a nav link in `BaseLayout` between Roadmap and Graph. Events render newest first, grouped under day headings (UTC date of the commit timestamp, matching the date-only convention used elsewhere). Each row shows:

- an event-type badge reusing the existing pill language (`state-changed` carries the visual weight; `updated` renders muted);
- the entry's mono ID and title, linking via `hrefFor()` when the entry still exists;
- a human description — "state ready → active", "milestone set to next-release", "priority p2 → p1", "created as backlog", "removed";
- the commit author.

**`updated` merging** happens at build time, before any client filtering: within one UTC day, consecutive `updated` events for the same entry collapse into a single row ("updated ×3") carrying the newest event's commit and timestamp and the distinct authors joined ("A, B"). The merged row's type is `updated` for filtering purposes. Per-entry history does **not** merge — it is the detail view.

**Filtering** is URL-backed to the house standard set by the roadmap and search specs:

- Query params: `type` (event type), `kind` (`spec` | `knowledge`), `q` (text over ID, title, and description). Filters combine with AND.
- State hydrates from the URL on load; changes write via `history.replaceState` (filter tweaks are not navigation steps, so Back/Forward need no `popstate` handling). Unknown or invalid param values are ignored and fall back to "all".
- A count line ("Showing X of N events") lives in a `role="status"` region and updates with the filters; a directive no-match empty state matches the roadmap's pattern; day headings whose rows are all hidden are hidden too.
- The filter script is the page's only client JS.

### Per-entry history

`packages/renderer/src/components/ActivityHistory.astro` renders on spec and knowledge entry pages alongside `EntryMeta`/`Relationships`: that entry's events (matched by `entryId`) as a compact vertical list, newest first, unmerged, filtered at build time — no client JS. An entry with no recorded events (not yet committed) shows "No recorded history yet."

### Degradation states

- **`available: false`** — the Activity page renders a notice ("Activity requires git history at build time") pointing at `docs/AUTOMATION.md`; the nav link stays; entry pages omit their history section; the build prints one warning including `reason`.
- **`shallow: true`** — the global feed **and every per-entry history section** render a truncation note linking the docs; boundary-commit `created` suppression is already handled by core. Without the per-entry note, an entry created before the boundary would falsely claim "No recorded history yet". `docs/AUTOMATION.md` gains a `fetch-depth: 0` note for checkout steps, and this repository's own Pages workflow adopts it so the deployed dashboard dogfoods complete history.
- **Uncommitted entries** — visible everywhere else in the dashboard; their history section shows the empty message (plus the truncation note when shallow).

## Error handling

- Git failures (missing binary, not a repo, subprocess error, `maxBuffer` overflow) are caught in `extractActivity` and produce `available: false` with a `reason`; partial reads never surface a half-built feed.
- Per-object cat-file `missing`/non-blob responses and malformed frontmatter degrade per the Opaque revisions rules — extraction is total over any history and every emitted event is attributable to a real commit.
- All feed and history HTML is built from data at build time; event text is inserted as text nodes/escaped output, never raw HTML.

## Verification

- **Core unit tests (differ):** table-driven `deriveChanges` cases for every event type; no-tracked-change → `updated`; state+milestone change → two deltas; `null → fields` and `fields → null`; unset vs `null` milestone equivalence; knowledge projections emitting only created/updated/removed.
- **Core integration test (temp repo fixture):** scripted commits — create, edit body only, flip state, move milestone, rename file (with and without edits), delete file, an id change (asserting removed+created), a malformed-frontmatter span repaired later (asserting the `updated` at the opaque commit and the transition attributed to the repairing commit), and a **divergent-branch merge** (state flipped on a side branch, merged — asserting one transition attributed to the merge commit and none from side-branch commits). Assertions cover the exact event sequence under the Determinism rule, and authorship.
- **Shallow behavior:** clone the fixture with `git clone --depth 2 file://…` (the `file://` transport is required — local-path clones ignore `--depth`) and assert `shallow: true`, suppression of boundary-commit `created` events only, and survival of a genuine post-boundary creation. A non-repo directory asserts `available: false` with a `reason`, without throwing.
- **Nested-root case:** a fixture where the dashboard root sits in a repo subdirectory asserts toplevel-relative pathspec handling.
- **Build output:** the built site contains `activity/index.html`; every page's nav includes the Activity link; a spec entry page contains its history section; `html-validate` stays green along with the existing core and MCP suites.
- **Browser sweep (Playwright):** day groups render newest first; `type`/`kind`/`q` filters hydrate from a deep-linked URL, update rows, the count line, and the URL via `replaceState`; invalid params fall back to "all"; an `updated ×n` merged row appears; the no-match empty state shows; clicking an event navigates to the entry page; the entry page shows matching unmerged history; layout holds at 390×844 with no horizontal overflow.
- **Degradation:** building a copy of the project without `.git` produces the notice page and the single build warning, not a failure.

## Out of scope

Delivery metrics (cycle time, time-in-state, throughput — the natural follow-up spec on this data), owner-change events, activity in `project.json` or MCP resources, RSS/JSON feeds of activity, config knobs for event caps or time windows, non-first-parent history exploration, HMR invalidation of activity in `specdash dev`, and `file://` support.
