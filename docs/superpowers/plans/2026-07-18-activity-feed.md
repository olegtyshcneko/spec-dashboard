# Git-Derived Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/activity` page and per-entry history sections showing semantic events (created, state/milestone/priority changed, updated, removed) extracted live from git history at build time.

**Architecture:** A new core module (`packages/core/src/activity.ts`) walks first-parent git history of the content directory with NUL-delimited output, projects historical frontmatter leniently (no Zod), and derives events through a three-layer dispatcher → pure differ → enrichment pipeline. The renderer calls `extractActivity` once at module scope in `lib/project.ts` (like `loadProject`) and renders a static feed page plus an `ActivityHistory` component; the only client JS is the feed's URL-backed filter script.

**Tech Stack:** Node 22 (`node:child_process` `execFileSync`, `node:test`), git CLI (≥ 2.42 for `cat-file -Z`), `yaml` (already a core dependency), Astro 7 (renderer).

**Spec:** `docs/superpowers/specs/2026-07-18-activity-feed-design.md` — read it before starting. Every rule referenced below (opaque revisions, shallow boundary, determinism) is normative there.

## Global Constraints

- Activity requires **Git ≥ 2.42**; older git → `available: false` with reason `git >= 2.42 required for activity extraction`. The build must **never fail** because of activity extraction.
- All git path output is **NUL-delimited** (`-z`, `cat-file --batch -Z`); never parse paths from line-based output. Blob payloads are framed by the **declared byte size**, never by delimiters.
- Git runs from the **repository toplevel**; pathspecs and cat-file requests use toplevel-relative paths (`<contentDir>/specs`, `<contentDir>/knowledge` only).
- Historical frontmatter is projected leniently: parseable = YAML object with a string `id`; tracked fields `id, title, state, milestone, priority` as optional strings; missing / `null` / non-string values are all "unset", never coerced.
- History is **first-parent only** (`--first-parent --diff-merges=first-parent`).
- Leading opaque revisions emit nothing; an entry's history starts at its first parseable revision's `created`.
- Event order: git log walk order (newest first), then within a commit by new path (byte compare), then fixed type order `created, state-changed, milestone-changed, priority-changed, updated, removed`.
- Explicit `maxBuffer`: 64 MiB for `git log`, 256 MiB for `cat-file --batch`.
- Core tests live in `packages/core/test/*.test.mjs`, use `node:test` + `assert/strict`, and import from `../dist/index.js` — **always rebuild core before running tests**: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`.
- Commit after every task with a conventional message; end commit messages with `Co-Authored-By:` per repo session convention if configured.

---

### Task 1: Historical frontmatter projection and pure differ

**Files:**
- Create: `packages/core/src/activity.ts`
- Create: `packages/core/test/activity.test.mjs`

**Interfaces:**
- Consumes: `yaml` package (already in core deps).
- Produces (exact exports later tasks rely on):
  - `interface TrackedFields { id: string; title?: string; state?: string; milestone?: string; priority?: string }`
  - `type EntryKind = "spec" | "knowledge"`
  - `type ActivityEventType = "created" | "state-changed" | "milestone-changed" | "priority-changed" | "updated" | "removed"`
  - `interface ChangeDelta { type: ActivityEventType; from?: string; to?: string }`
  - `projectRevision(content: string): TrackedFields | null`
  - `deriveChanges(older: TrackedFields | null, newer: TrackedFields | null, kind: EntryKind): ChangeDelta[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/activity.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { deriveChanges, projectRevision } from "../dist/index.js";

function doc(frontmatter, body = "Body text.") {
  return `---\n${frontmatter}\n---\n${body}\n`;
}

test("projectRevision extracts tracked fields as strings", () => {
  const fields = projectRevision(doc([
    "id: SPEC-001",
    "title: Example",
    "state: backlog",
    "milestone: v1-0",
    "priority: p1",
    "summary: ignored entirely",
  ].join("\n")));
  assert.deepEqual(fields, { id: "SPEC-001", title: "Example", state: "backlog", milestone: "v1-0", priority: "p1" });
});

test("projectRevision treats missing, null, and non-string tracked fields as unset", () => {
  const fields = projectRevision(doc([
    "id: SPEC-001",
    "title: 42",
    "state: null",
    "milestone: [a, b]",
  ].join("\n")));
  assert.deepEqual(fields, { id: "SPEC-001", title: undefined, state: undefined, milestone: undefined, priority: undefined });
});

test("projectRevision returns null for unparseable revisions", () => {
  assert.equal(projectRevision("no frontmatter at all"), null);
  assert.equal(projectRevision(doc("id: [not, a, string]")), null);
  assert.equal(projectRevision(doc("id: SPEC-001\n  bad:\n indent: {")), null);
  assert.equal(projectRevision(doc("- just\n- a\n- list")), null);
});

test("deriveChanges yields created with initial state for specs", () => {
  assert.deepEqual(
    deriveChanges(null, { id: "SPEC-001", state: "backlog" }, "spec"),
    [{ type: "created", to: "backlog" }],
  );
  assert.deepEqual(deriveChanges(null, { id: "KB-001" }, "knowledge"), [{ type: "created" }]);
});

test("deriveChanges yields removed", () => {
  assert.deepEqual(deriveChanges({ id: "SPEC-001", state: "active" }, null, "spec"), [{ type: "removed" }]);
});

test("deriveChanges emits one delta per tracked field change, in fixed order", () => {
  assert.deepEqual(
    deriveChanges(
      { id: "SPEC-001", state: "ready", milestone: undefined, priority: "p2" },
      { id: "SPEC-001", state: "active", milestone: "v1-0", priority: "p1" },
      "spec",
    ),
    [
      { type: "state-changed", from: "ready", to: "active" },
      { type: "milestone-changed", from: undefined, to: "v1-0" },
      { type: "priority-changed", from: "p2", to: "p1" },
    ],
  );
});

test("deriveChanges collapses no tracked change into a single updated", () => {
  assert.deepEqual(
    deriveChanges({ id: "SPEC-001", state: "active" }, { id: "SPEC-001", state: "active" }, "spec"),
    [{ type: "updated" }],
  );
});

test("deriveChanges suppresses lifecycle deltas for knowledge", () => {
  assert.deepEqual(
    deriveChanges({ id: "KB-001", state: "x" }, { id: "KB-001", state: "y" }, "knowledge"),
    [{ type: "updated" }],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: FAIL — `projectRevision`/`deriveChanges` are not exported (build error or import failure). If the TypeScript build fails because `activity.ts` doesn't exist yet, that counts as the expected failure.

- [ ] **Step 3: Implement projection and differ**

Create `packages/core/src/activity.ts`:

```ts
import YAML from "yaml";

export type EntryKind = "spec" | "knowledge";
export type ActivityEventType =
  | "created"
  | "state-changed"
  | "milestone-changed"
  | "priority-changed"
  | "updated"
  | "removed";

export interface TrackedFields {
  id: string;
  title?: string;
  state?: string;
  milestone?: string;
  priority?: string;
}

export interface ChangeDelta {
  type: ActivityEventType;
  from?: string;
  to?: string;
}

export interface ActivityEvent {
  entryId: string;
  entryTitle: string;
  entryKind: EntryKind;
  type: ActivityEventType;
  from?: string;
  to?: string;
  commit: string;
  timestamp: number;
  author: string;
}

export interface ActivityResult {
  available: boolean;
  reason?: string;
  shallow: boolean;
  events: ActivityEvent[];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function projectRevision(content: string): TrackedFields | null {
  if (!content.startsWith("---")) return null;
  const fenceEnd = content.indexOf("\n---", 3);
  if (fenceEnd === -1) return null;
  let data: unknown;
  try {
    data = YAML.parse(content.slice(3, fenceEnd));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    id: record.id,
    title: asString(record.title),
    state: asString(record.state),
    milestone: asString(record.milestone),
    priority: asString(record.priority),
  };
}

const TRACKED: Array<{ field: "state" | "milestone" | "priority"; type: ActivityEventType }> = [
  { field: "state", type: "state-changed" },
  { field: "milestone", type: "milestone-changed" },
  { field: "priority", type: "priority-changed" },
];

export function deriveChanges(
  older: TrackedFields | null,
  newer: TrackedFields | null,
  kind: EntryKind,
): ChangeDelta[] {
  if (!older && !newer) return [];
  if (!older) {
    const created: ChangeDelta = { type: "created" };
    if (kind === "spec" && newer!.state) created.to = newer!.state;
    return [created];
  }
  if (!newer) return [{ type: "removed" }];
  const deltas: ChangeDelta[] = [];
  if (kind === "spec") {
    for (const { field, type } of TRACKED) {
      if (older[field] !== newer[field]) deltas.push({ type, from: older[field], to: newer[field] });
    }
  }
  return deltas.length > 0 ? deltas : [{ type: "updated" }];
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./activity.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: PASS (all new tests; existing `core.test.mjs` and `search-text.test.mjs` stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/activity.ts packages/core/src/index.ts packages/core/test/activity.test.mjs
git commit -m "feat(core): historical frontmatter projection and activity differ"
```

---

### Task 2: Log stream parser (byte-level grammar)

**Files:**
- Modify: `packages/core/src/activity.ts`
- Modify: `packages/core/test/activity.test.mjs`

**Interfaces:**
- Produces:
  - `interface StatusRecord { status: string; path: string; oldPath?: string; score?: number }`
  - `interface CommitRecord { commit: string; timestamp: number; author: string; files: StatusRecord[] }`
  - `parseLogStream(raw: string): CommitRecord[]`

The log command (used in Task 5) is `git log --first-parent --diff-merges=first-parent -z --name-status --find-renames --format=%x01%H%x01%ct%x01%an -- <pathspecs>`. In the byte stream: each commit header is `\x01<hash>\x01<timestamp>\x01<author>`, NUL-delimited status/path tokens follow (status token, then 1 path token, or 2 for `R`/`C`), and git glues a `\n` before the next header inside a token. The parser is a token walk over `raw.split("\0")`; any token containing `\x01` starts a new commit.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/activity.test.mjs`:

```js
import { parseLogStream } from "../dist/index.js";

const NUL = "\u0000";
const SOH = "\u0001";

test("parseLogStream parses commits, statuses, renames, and glued headers", () => {
  const raw = [
    `${SOH}aaa${SOH}200${SOH}Alice`,
    `${NUL}M${NUL}content/specs/a.mdx`,
    `${NUL}R100${NUL}content/specs/old.mdx${NUL}content/specs/new.mdx`,
    `${NUL}\n${SOH}bbb${SOH}100${SOH}Bob`,
    `${NUL}A${NUL}content/knowledge/k.mdx${NUL}`,
  ].join("");
  assert.deepEqual(parseLogStream(raw), [
    {
      commit: "aaa", timestamp: 200, author: "Alice",
      files: [
        { status: "M", path: "content/specs/a.mdx" },
        { status: "R", path: "content/specs/new.mdx", oldPath: "content/specs/old.mdx", score: 100 },
      ],
    },
    { commit: "bbb", timestamp: 100, author: "Bob", files: [{ status: "A", path: "content/knowledge/k.mdx" }] },
  ]);
});

test("parseLogStream handles a commit with no file records and unknown statuses", () => {
  const raw = `${SOH}ccc${SOH}300${SOH}Cara${NUL}T${NUL}content/specs/t.mdx${NUL}\n${SOH}ddd${SOH}250${SOH}Dan`;
  const commits = parseLogStream(raw);
  assert.deepEqual(commits[0].files, [{ status: "T", path: "content/specs/t.mdx" }]);
  assert.deepEqual(commits[1], { commit: "ddd", timestamp: 250, author: "Dan", files: [] });
});

test("parseLogStream returns [] for empty input", () => {
  assert.deepEqual(parseLogStream(""), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: FAIL — `parseLogStream` is not exported.

- [ ] **Step 3: Implement the parser**

Add to `packages/core/src/activity.ts`:

```ts
export interface StatusRecord {
  status: string;
  path: string;
  oldPath?: string;
  score?: number;
}

export interface CommitRecord {
  commit: string;
  timestamp: number;
  author: string;
  files: StatusRecord[];
}

export function parseLogStream(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  let current: CommitRecord | null = null;
  let pendingStatus: string | null = null;
  let pendingPaths: string[] = [];

  for (const token of raw.split("\u0000")) {
    const headerAt = token.indexOf("\u0001");
    if (headerAt !== -1) {
      const [hash = "", timestamp = "", author = ""] = token.slice(headerAt + 1).split("\u0001");
      current = { commit: hash, timestamp: Number(timestamp), author, files: [] };
      commits.push(current);
      pendingStatus = null;
      pendingPaths = [];
      continue;
    }
    const cleaned = token.replace(/^\n+/, "");
    if (!current || cleaned === "") continue;
    if (pendingStatus === null) {
      pendingStatus = cleaned;
      pendingPaths = [];
      continue;
    }
    pendingPaths.push(token);
    const twoPath = pendingStatus.startsWith("R") || pendingStatus.startsWith("C");
    if (pendingPaths.length === (twoPath ? 2 : 1)) {
      const record: StatusRecord = twoPath
        ? { status: pendingStatus[0]!, path: pendingPaths[1]!, oldPath: pendingPaths[0]! }
        : { status: pendingStatus[0]!, path: pendingPaths[0]! };
      const score = Number(pendingStatus.slice(1));
      if (twoPath && Number.isFinite(score) && pendingStatus.length > 1) record.score = score;
      current.files.push(record);
      pendingStatus = null;
    }
  }
  return commits;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/activity.ts packages/core/test/activity.test.mjs
git commit -m "feat(core): NUL-delimited git log stream parser for activity"
```

---

### Task 3: Batch blob reader (`cat-file --batch -Z`)

**Files:**
- Modify: `packages/core/src/activity.ts`
- Modify: `packages/core/test/activity.test.mjs`

**Interfaces:**
- Produces: `readBlobs(toplevel: string, requests: string[]): Map<string, string | null>` — key is the request string `<sha>:<path>`; value is UTF-8 content, or `null` for `missing`/non-blob responses. Exported for testing.

- [ ] **Step 1: Write the failing test (real git fixture)**

Append to `packages/core/test/activity.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBlobs } from "../dist/index.js";

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-activity-"));
  const run = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  }).trim();
  run("init", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  return { root, run };
}

test("readBlobs returns content by declared size and null for missing objects", () => {
  const { root, run } = gitRepo();
  fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
  fs.writeFileSync(path.join(root, "content/specs/a.mdx"), "---\nid: SPEC-001\n---\nBody with \n newline and NUL-ish text");
  run("add", ".");
  run("commit", "-m", "one");
  const sha = run("rev-parse", "HEAD");
  const blobs = readBlobs(root, [`${sha}:content/specs/a.mdx`, `${sha}:content/specs/nope.mdx`]);
  assert.match(blobs.get(`${sha}:content/specs/a.mdx`), /^---\nid: SPEC-001/);
  assert.equal(blobs.get(`${sha}:content/specs/nope.mdx`), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: FAIL — `readBlobs` is not exported.

- [ ] **Step 3: Implement the reader**

Add to `packages/core/src/activity.ts` (top of file: `import { execFileSync } from "node:child_process";`):

```ts
const LOG_MAX_BUFFER = 64 * 1024 * 1024;
const BATCH_MAX_BUFFER = 256 * 1024 * 1024;

export function readBlobs(toplevel: string, requests: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (requests.length === 0) return result;
  const input = requests.map((request) => `${request}\u0000`).join("");
  const out = execFileSync("git", ["-C", toplevel, "cat-file", "--batch", "-Z"], {
    input,
    maxBuffer: BATCH_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let offset = 0;
  for (const request of requests) {
    const headerEnd = out.indexOf(0, offset);
    if (headerEnd === -1) {
      result.set(request, null);
      continue;
    }
    const header = out.toString("utf8", offset, headerEnd);
    offset = headerEnd + 1;
    const parts = header.split(" ");
    if (parts.at(-1) === "missing" || parts.at(-1) === "ambiguous") {
      result.set(request, null);
      continue;
    }
    const type = parts[1];
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) {
      result.set(request, null);
      continue;
    }
    result.set(request, type === "blob" ? out.toString("utf8", offset, offset + size) : null);
    offset += size + 1; // payload + trailing NUL
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/activity.ts packages/core/test/activity.test.mjs
git commit -m "feat(core): size-framed cat-file batch blob reader"
```

---

### Task 4: Dispatcher and lineage (`buildEvents`)

**Files:**
- Modify: `packages/core/src/activity.ts`
- Modify: `packages/core/test/activity.test.mjs`

**Interfaces:**
- Consumes: `CommitRecord`, `StatusRecord`, `projectRevision`, `deriveChanges` from earlier tasks.
- Produces: `buildEvents(commits: CommitRecord[], blob: (commit: string, filePath: string) => string | null, options: { prefix: string; boundary: Set<string> }): ActivityEvent[]` — `commits` is newest-first (as parsed); `prefix` is the toplevel-relative contentDir (`""` when contentDir is the toplevel); `boundary` holds shallow graft commit hashes whose `created` events are suppressed. Exported for testing.

Implements spec dispatcher rules exactly: eligibility (`specs|knowledge/**/*.{md,mdx}` under prefix, case-insensitive extensions), status normalization (`T`→`M`, unknown → opaque), kind/identity (both-parseable kind or id change → `removed`+`created`), leading-opaque silence, opaque `updated` attribution, R100 = no event, determinism ordering.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/activity.test.mjs`. The helper builds synthetic commits and an in-memory blob store:

```js
import { buildEvents } from "../dist/index.js";

function spec(id, extra = "") {
  return `---\nid: ${id}\ntitle: ${id} title\n${extra}\n---\nBody.\n`;
}

function harness() {
  const store = new Map();
  const commits = [];
  let clock = 0;
  return {
    commit(author, files) {
      clock += 100;
      const hash = `c${clock}`;
      const records = [];
      for (const [key, content] of Object.entries(files)) {
        const [status, ...rest] = key.split(":");
        const p = rest.join(":");
        if (status === "R" || status === "R100") {
          const [oldPath, newPath] = p.split("->");
          records.push({ status: "R", oldPath, path: newPath, score: status === "R100" ? 100 : 50 });
          if (content !== undefined) store.set(`${hash}:${newPath}`, content);
        } else {
          records.push({ status, path: p });
          if (content !== undefined) store.set(`${hash}:${p}`, content);
        }
      }
      commits.unshift({ commit: hash, timestamp: clock, author, files: records });
      return hash;
    },
    build(boundary = new Set()) {
      return buildEvents(commits, (c, p) => store.get(`${c}:${p}`) ?? null, { prefix: "content", boundary });
    },
  };
}

test("buildEvents: create, body edit, state flip, milestone move, delete", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "M:content/specs/a.mdx": spec("SPEC-001", "state: backlog") + "More.\n" });
  h.commit("Bob", { "M:content/specs/a.mdx": spec("SPEC-001", "state: active") });
  h.commit("Bob", { "M:content/specs/a.mdx": spec("SPEC-001", "state: active\nmilestone: v1-0") });
  h.commit("Cara", { "D:content/specs/a.mdx": undefined });
  const types = h.build().map((event) => event.type);
  assert.deepEqual(types, ["removed", "milestone-changed", "state-changed", "updated", "created"]);
  const created = h.build().at(-1);
  assert.equal(created.to, "backlog");
  assert.equal(created.entryTitle, "SPEC-001 title");
});

test("buildEvents: knowledge entries emit only created/updated/removed", () => {
  const h = harness();
  h.commit("Alice", { "A:content/knowledge/k.mdx": spec("KB-001", "state: weird") });
  h.commit("Alice", { "M:content/knowledge/k.mdx": spec("KB-001", "state: other") });
  assert.deepEqual(h.build().map((event) => [event.type, event.entryKind]), [["updated", "knowledge"], ["created", "knowledge"]]);
});

test("buildEvents: leading opaque revisions are silent; created fires at first parseable", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": "not frontmatter" });
  h.commit("Alice", { "M:content/specs/a.mdx": "still: [broken" });
  const fix = h.commit("Bob", { "M:content/specs/a.mdx": spec("SPEC-001", "state: ready") });
  const events = h.build();
  assert.deepEqual(events.map((event) => [event.type, event.commit]), [["created", fix]]);
  assert.equal(events[0].to, "ready");
});

test("buildEvents: opaque span attributes hidden transition to the repairing commit", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "M:content/specs/a.mdx": "broken: [yaml" });
  const repair = h.commit("Bob", { "M:content/specs/a.mdx": spec("SPEC-001", "state: active") });
  const events = h.build();
  assert.deepEqual(events.map((event) => [event.type, event.commit]), [
    ["state-changed", repair],
    ["updated", events[1].commit],
    ["created", events[2].commit],
  ]);
  assert.equal(events[0].from, "backlog");
});

test("buildEvents: id change and cross-kind rename emit removed+created", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "M:content/specs/a.mdx": spec("SPEC-999", "state: backlog") });
  const idChange = h.build().slice(0, 2);
  assert.deepEqual(idChange.map((event) => [event.type, event.entryId]), [["created", "SPEC-999"], ["removed", "SPEC-001"]]);

  const h2 = harness();
  h2.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-002", "state: backlog") });
  h2.commit("Alice", { "R:content/specs/a.mdx->content/knowledge/a.mdx": spec("SPEC-002", "state: backlog") });
  const cross = h2.build().slice(0, 2);
  assert.deepEqual(cross.map((event) => [event.type, event.entryKind]), [["created", "knowledge"], ["removed", "spec"]]);
});

test("buildEvents: R100 rename emits nothing; rename with edits diffs under new path", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "R100:content/specs/a.mdx->content/specs/b.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Bob", { "R:content/specs/b.mdx->content/specs/c.mdx": spec("SPEC-001", "state: active") });
  assert.deepEqual(h.build().map((event) => event.type), ["state-changed", "created"]);
});

test("buildEvents: eligibility — ineligible paths ignored, boundary-crossing rename leaves the model", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.txt": "irrelevant", "A:docs/x.mdx": "irrelevant" });
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "R100:content/specs/a.mdx->content/archive/a.mdx": spec("SPEC-001", "state: backlog") });
  assert.deepEqual(h.build().map((event) => event.type), ["removed", "created"]);
});

test("buildEvents: T normalizes to M; unknown status is opaque updated", () => {
  const h = harness();
  h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "T:content/specs/a.mdx": spec("SPEC-001", "state: ready") });
  h.commit("Bob", { "?:content/specs/a.mdx": undefined });
  assert.deepEqual(h.build().map((event) => event.type), ["updated", "state-changed", "created"]);
});

test("buildEvents: shallow boundary suppresses created only at boundary commits", () => {
  const h = harness();
  const boundaryCommit = h.commit("Alice", { "A:content/specs/a.mdx": spec("SPEC-001", "state: backlog") });
  h.commit("Alice", { "M:content/specs/a.mdx": spec("SPEC-001", "state: active") });
  h.commit("Bob", { "A:content/specs/b.mdx": spec("SPEC-002", "state: idea") });
  const events = h.build(new Set([boundaryCommit]));
  assert.deepEqual(events.map((event) => [event.type, event.entryId]), [
    ["created", "SPEC-002"],
    ["state-changed", "SPEC-001"],
  ]);
});

test("buildEvents: within-commit ordering is by path then type order", () => {
  const h = harness();
  h.commit("Alice", {
    "A:content/specs/b.mdx": spec("SPEC-002", "state: idea"),
    "A:content/specs/a.mdx": spec("SPEC-001", "state: idea"),
  });
  assert.deepEqual(h.build().map((event) => event.entryId), ["SPEC-001", "SPEC-002"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: FAIL — `buildEvents` is not exported.

- [ ] **Step 3: Implement `buildEvents`**

Add to `packages/core/src/activity.ts`:

```ts
const TYPE_ORDER: Record<ActivityEventType, number> = {
  created: 0,
  "state-changed": 1,
  "milestone-changed": 2,
  "priority-changed": 3,
  updated: 4,
  removed: 5,
};

function classify(prefix: string, filePath: string): EntryKind | null {
  const base = prefix ? `${prefix}/` : "";
  if (!filePath.startsWith(base)) return null;
  const rest = filePath.slice(base.length);
  const kind: EntryKind | null = rest.startsWith("specs/") ? "spec" : rest.startsWith("knowledge/") ? "knowledge" : null;
  return kind && /\.(md|mdx)$/i.test(rest) ? kind : null;
}

interface Lineage {
  last: TrackedFields | null; // last parseable projection; null until first parseable revision
  kind: EntryKind;
}

export function buildEvents(
  commits: CommitRecord[],
  blob: (commit: string, filePath: string) => string | null,
  options: { prefix: string; boundary: Set<string> },
): ActivityEvent[] {
  const lineages = new Map<string, Lineage>();
  const eventsPerCommit = new Map<string, ActivityEvent[]>();

  const enrich = (
    commit: CommitRecord,
    delta: ChangeDelta,
    fields: TrackedFields,
    kind: EntryKind,
  ): ActivityEvent => ({
    entryId: fields.id,
    entryTitle: fields.title ?? fields.id,
    entryKind: kind,
    type: delta.type,
    ...(delta.from !== undefined ? { from: delta.from } : {}),
    ...(delta.to !== undefined ? { to: delta.to } : {}),
    commit: commit.commit,
    timestamp: commit.timestamp,
    author: commit.author,
  });

  for (const commit of [...commits].reverse()) {
    const emitted: ActivityEvent[] = [];
    const emit = (delta: ChangeDelta, fields: TrackedFields, kind: EntryKind) => {
      if (delta.type === "created" && options.boundary.has(commit.commit)) return;
      emitted.push(enrich(commit, delta, fields, kind));
    };

    const records = [...commit.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const record of records) {
      let status = record.status === "T" ? "M" : record.status;
      let filePath = record.path;
      let oldPath = record.oldPath;

      if (status === "R") {
        const oldKind = oldPath ? classify(options.prefix, oldPath) : null;
        const newKind = classify(options.prefix, filePath);
        if (!oldKind && !newKind) continue;
        if (oldKind && !newKind) { status = "D"; filePath = oldPath!; }
        else if (!oldKind && newKind) { status = "A"; }
        else {
          const lineage = lineages.get(oldPath!) ?? { last: null, kind: oldKind! };
          lineages.delete(oldPath!);
          lineages.set(filePath, lineage);
          if (oldKind !== newKind) {
            // Cross-kind rename: removed+created, no differ call (spec dispatcher rule 3).
            const content = record.score === 100 ? null : blob(commit.commit, filePath);
            const newProjection = record.score === 100 ? lineage.last : content === null ? null : projectRevision(content);
            if (lineage.last && newProjection) {
              emit({ type: "removed" }, lineage.last, oldKind!);
              const created: ChangeDelta = { type: "created" };
              if (newKind === "spec" && newProjection.state) created.to = newProjection.state;
              emit(created, newProjection, newKind!);
            } else if (!lineage.last && newProjection) {
              // First parseable revision arrives via the rename: it is the entry's created.
              const created: ChangeDelta = { type: "created" };
              if (newKind === "spec" && newProjection.state) created.to = newProjection.state;
              emit(created, newProjection, newKind!);
            } else if (lineage.last && !newProjection) {
              emit({ type: "updated" }, lineage.last, newKind!);
            }
            lineage.kind = newKind!;
            if (newProjection) lineage.last = newProjection;
            continue;
          }
          if (record.score === 100) continue; // identical content, same kind: no event, regardless of parseability
          status = "M";
        }
      }

      const kind = classify(options.prefix, filePath);
      if (!kind) continue;
      const lineage = lineages.get(filePath) ?? { last: null, kind };
      lineages.set(filePath, lineage);

      if (status === "A" || status === "M") {
        const content = blob(commit.commit, filePath);
        const projection = content === null ? null : projectRevision(content);
        if (projection === null) {
          if (lineage.last) emit({ type: "updated" }, lineage.last, lineage.kind);
          continue;
        }
        if (lineage.last === null) {
          const created: ChangeDelta = { type: "created" };
          if (kind === "spec" && projection.state) created.to = projection.state;
          emit(created, projection, kind);
        } else if (lineage.last.id !== projection.id) {
          emit({ type: "removed" }, lineage.last, lineage.kind);
          const created: ChangeDelta = { type: "created" };
          if (kind === "spec" && projection.state) created.to = projection.state;
          emit(created, projection, kind);
        } else {
          for (const delta of deriveChanges(lineage.last, projection, kind)) emit(delta, projection, kind);
        }
        lineage.last = projection;
        lineage.kind = kind;
      } else if (status === "D") {
        if (lineage.last) emit({ type: "removed" }, lineage.last, lineage.kind);
        lineages.delete(filePath);
      } else {
        // unmodeled status letter → opaque
        if (lineage.last) emit({ type: "updated" }, lineage.last, lineage.kind);
      }
    }

    emitted.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
    // stable within path: records were processed in path order, sort() in V8 is stable
    eventsPerCommit.set(commit.commit, emitted);
  }

  return commits.flatMap((commit) => eventsPerCommit.get(commit.commit) ?? []);
}
```

Note on ordering: records are processed in path order and V8's `Array.prototype.sort` is stable, so sorting by type order alone preserves the path order for equal types — matching the spec's "path, then type" rule. The final `flatMap` walks `commits` in the original newest-first log order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: PASS. If the cross-kind or ordering tests fail, re-read the dispatcher rules in the spec (Event derivation, rules 1–4) before changing test expectations — the tests encode the spec.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/activity.ts packages/core/test/activity.test.mjs
git commit -m "feat(core): activity event dispatcher with lineage and opaque rules"
```

---

### Task 5: `extractActivity` orchestration and git integration tests

**Files:**
- Modify: `packages/core/src/activity.ts`
- Modify: `packages/core/test/activity.test.mjs`

**Interfaces:**
- Produces: `extractActivity(root: string, config: { contentDir: string }): ActivityResult` — the only function the renderer calls. Accepts any object with `contentDir` (the full `DashboardConfig` satisfies it).

- [ ] **Step 1: Write the failing integration tests**

Append to `packages/core/test/activity.test.mjs`:

```js
import { extractActivity } from "../dist/index.js";

function contentRepo() {
  const { root, run } = gitRepo();
  fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "content/knowledge"), { recursive: true });
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  const commitAll = (message, date) => {
    run("add", "-A");
    execFileSync("git", ["-C", root, "commit", "-m", message], {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@e.c", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@e.c" },
    });
  };
  return { root, run, write, commitAll };
}

const CONFIG = { contentDir: "content" };

test("extractActivity: end-to-end scripted history", () => {
  const { root, run, write, commitAll } = contentRepo();
  write("content/specs/a.mdx", spec("SPEC-001", "state: backlog"));
  commitAll("create", "2026-01-01T10:00:00Z");
  write("content/specs/a.mdx", spec("SPEC-001", "state: active"));
  commitAll("activate", "2026-01-02T10:00:00Z");
  run("mv", "content/specs/a.mdx", "content/specs/renamed.mdx");
  commitAll("rename", "2026-01-03T10:00:00Z");
  fs.rmSync(path.join(root, "content/specs/renamed.mdx"));
  commitAll("delete", "2026-01-04T10:00:00Z");

  const result = extractActivity(root, CONFIG);
  assert.equal(result.available, true);
  assert.equal(result.shallow, false);
  assert.deepEqual(result.events.map((event) => event.type), ["removed", "state-changed", "created"]);
  assert.equal(result.events.every((event) => event.author === "Test"), true);
});

test("extractActivity: merge from a side branch attributes to the merge commit", () => {
  const { root, run, write, commitAll } = contentRepo();
  write("content/specs/a.mdx", spec("SPEC-001", "state: ready"));
  commitAll("create", "2026-01-01T10:00:00Z");
  run("checkout", "-b", "side");
  write("content/specs/a.mdx", spec("SPEC-001", "state: active"));
  commitAll("side flip", "2026-01-02T10:00:00Z");
  run("checkout", "main");
  execFileSync("git", ["-C", root, "merge", "--no-ff", "side", "-m", "merge side"], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-03T10:00:00Z", GIT_COMMITTER_DATE: "2026-01-03T10:00:00Z", GIT_COMMITTER_NAME: "Merger", GIT_COMMITTER_EMAIL: "m@e.c", GIT_AUTHOR_NAME: "Merger", GIT_AUTHOR_EMAIL: "m@e.c" },
  });
  const result = extractActivity(root, CONFIG);
  const flip = result.events.find((event) => event.type === "state-changed");
  const mergeSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(flip.commit, mergeSha);
  assert.equal(result.events.length, 2); // created + one state change; no side-branch duplicates
});

test("extractActivity: shallow clone flags shallow and suppresses only boundary created", () => {
  const { root, write, commitAll } = contentRepo();
  write("content/specs/a.mdx", spec("SPEC-001", "state: backlog"));
  commitAll("create a", "2026-01-01T10:00:00Z");
  write("content/specs/a.mdx", spec("SPEC-001", "state: active"));
  commitAll("activate a", "2026-01-02T10:00:00Z");
  write("content/specs/b.mdx", spec("SPEC-002", "state: idea"));
  commitAll("create b", "2026-01-03T10:00:00Z");

  const cloneParent = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-shallow-"));
  const clone = path.join(cloneParent, "clone");
  execFileSync("git", ["clone", "--depth", "2", `file://${root}`, clone], { encoding: "utf8" });
  const result = extractActivity(clone, CONFIG);
  assert.equal(result.available, true);
  assert.equal(result.shallow, true);
  const types = result.events.map((event) => [event.type, event.entryId]);
  assert.ok(types.some(([type, id]) => type === "created" && id === "SPEC-002"));
  assert.ok(!types.some(([type, id]) => type === "created" && id === "SPEC-001"));
});

test("extractActivity: nested dashboard root inside a larger repo", () => {
  const { root, write, commitAll } = contentRepo();
  write("apps/dash/content/specs/n.mdx", spec("SPEC-010", "state: idea"));
  commitAll("nested", "2026-01-01T10:00:00Z");
  const result = extractActivity(path.join(root, "apps/dash"), CONFIG);
  assert.equal(result.available, true);
  assert.deepEqual(result.events.map((event) => [event.type, event.entryId]), [["created", "SPEC-010"]]);
});

test("extractActivity: non-repo and empty repo degrade without throwing", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-norepo-"));
  const noRepo = extractActivity(plain, CONFIG);
  assert.equal(noRepo.available, false);
  assert.ok(noRepo.reason.length > 0);

  const { root } = gitRepo(); // repo with zero commits
  const empty = extractActivity(root, CONFIG);
  assert.equal(empty.available, true);
  assert.deepEqual(empty.events, []);
});

test("extractActivity: git older than 2.42 degrades with a version reason", () => {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-gitshim-"));
  fs.writeFileSync(path.join(shimDir, "git"), '#!/bin/sh\necho "git version 2.41.0"\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${originalPath}`;
  try {
    const result = extractActivity(process.cwd(), CONFIG);
    assert.equal(result.available, false);
    assert.match(result.reason, /2\.42/);
  } finally {
    process.env.PATH = originalPath;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: FAIL — `extractActivity` is not exported.

- [ ] **Step 3: Implement `extractActivity`**

Add to `packages/core/src/activity.ts` (top of file: `import fs from "node:fs"; import path from "node:path";`):

```ts
function git(cwd: string, args: string[], maxBuffer = LOG_MAX_BUFFER): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  }).replace(/\n$/, "");
}

function gitMeetsMinimum(raw: string): boolean {
  const match = /git version (\d+)\.(\d+)/.exec(raw);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 2 || (major === 2 && minor >= 42);
}

function shallowBoundary(toplevel: string): Set<string> {
  try {
    const shallowFile = git(toplevel, ["rev-parse", "--git-path", "shallow"]);
    const absolute = path.isAbsolute(shallowFile) ? shallowFile : path.join(toplevel, shallowFile);
    return new Set(fs.readFileSync(absolute, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function extractActivity(root: string, config: { contentDir: string }): ActivityResult {
  try {
    if (!gitMeetsMinimum(git(".", ["version"]))) {
      return { available: false, reason: "git >= 2.42 required for activity extraction", shallow: false, events: [] };
    }
    const absoluteRoot = path.resolve(root);
    const toplevel = git(absoluteRoot, ["rev-parse", "--show-toplevel"]);
    const shallow = git(absoluteRoot, ["rev-parse", "--is-shallow-repository"]) === "true";
    const prefix = path
      .relative(toplevel, path.resolve(absoluteRoot, config.contentDir))
      .split(path.sep)
      .join("/");
    const pathspecs = [
      prefix ? `${prefix}/specs` : "specs",
      prefix ? `${prefix}/knowledge` : "knowledge",
    ];

    let raw = "";
    try {
      raw = git(toplevel, [
        "log",
        "--first-parent",
        "--diff-merges=first-parent",
        "-z",
        "--name-status",
        "--find-renames",
        "--format=%x01%H%x01%ct%x01%an",
        "--",
        ...pathspecs,
      ]);
    } catch (error) {
      const message = String(error instanceof Error && "stderr" in error ? (error as { stderr: unknown }).stderr : error);
      if (/does not have any commits yet|bad default revision/i.test(message)) {
        return { available: true, shallow, events: [] };
      }
      throw error;
    }

    const commits = parseLogStream(raw);
    const requests: string[] = [];
    for (const commit of commits) {
      for (const record of commit.files) {
        if (record.status === "D") continue;
        if (classify(prefix, record.path) === null) continue;
        requests.push(`${commit.commit}:${record.path}`);
      }
    }
    const blobs = readBlobs(toplevel, requests);
    const boundary = shallow ? shallowBoundary(toplevel) : new Set<string>();
    const events = buildEvents(commits, (commit, filePath) => blobs.get(`${commit}:${filePath}`) ?? null, {
      prefix,
      boundary,
    });
    return { available: true, shallow, events };
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr: unknown }).stderr).trim() : "";
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: stderr || message, shallow: false, events: [] };
  }
}
```

Note: `git(".", ["version"])` runs `git -C . version` so the version preflight works even when `root` is not a repo.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @spec-dashboard/core && npm run test -w @spec-dashboard/core`
Expected: PASS — including all Task 1–4 tests. If the end-to-end test fails on the rename step, inspect real git output with `git -C <fixture> log -z --name-status --format=%x01%H%x01%ct%x01%an -- content | od -c | head -40` and fix `parseLogStream`'s glue handling (the grammar tolerates `\n` before headers) — do not weaken the test.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (core + MCP suites).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/activity.ts packages/core/test/activity.test.mjs
git commit -m "feat(core): extractActivity orchestration with git preflight and degradation"
```

---

### Task 6: Renderer wiring — activity data, shared helpers, nav link

**Files:**
- Modify: `packages/renderer/src/lib/project.ts`
- Create: `packages/renderer/src/lib/activity.ts`
- Modify: `packages/renderer/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `extractActivity`, `ActivityEvent`, `ActivityResult` from `../../../core/dist/index.js`.
- Produces:
  - `lib/project.ts`: `export const activity: ActivityResult`
  - `lib/activity.ts`: `dateKey(timestamp: number): string` (UTC `YYYY-MM-DD`), `describeEvent(event: { type; from?; to?; count?: number }): string`, `mergeUpdated(events: ActivityEvent[]): ActivityRow[]` where `ActivityRow = ActivityEvent & { dateKey: string; count: number; authors: string[] }`

- [ ] **Step 1: Wire extraction into `lib/project.ts`**

Add to `packages/renderer/src/lib/project.ts` (after the `loadProject` call):

```ts
import { extractActivity, loadProject, projectSnapshot } from "../../../core/dist/index.js";

export const activity = extractActivity(projectRoot, projectModel.config);
if (!activity.available) {
  console.warn(`[specdash] activity feed unavailable: ${activity.reason ?? "unknown reason"}`);
}
```

(Adjust the existing import line rather than duplicating it.)

- [ ] **Step 2: Create `packages/renderer/src/lib/activity.ts`**

```ts
import type { ActivityEvent } from "../../../core/dist/index.js";

export type ActivityRow = ActivityEvent & { dateKey: string; count: number; authors: string[] };

export function dateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function describeEvent(event: { type: string; from?: string; to?: string; count?: number }): string {
  switch (event.type) {
    case "created":
      return event.to ? `created as ${event.to}` : "created";
    case "state-changed":
      return `state ${event.from ?? "unset"} → ${event.to ?? "unset"}`;
    case "milestone-changed":
      if (!event.to) return "milestone cleared";
      return event.from ? `milestone ${event.from} → ${event.to}` : `milestone set to ${event.to}`;
    case "priority-changed":
      if (!event.to) return "priority cleared";
      return event.from ? `priority ${event.from} → ${event.to}` : `priority set to ${event.to}`;
    case "removed":
      return "removed";
    default:
      return (event.count ?? 1) > 1 ? `updated ×${event.count}` : "updated";
  }
}

export function mergeUpdated(events: ActivityEvent[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    const day = dateKey(event.timestamp);
    const previous = rows.at(-1);
    if (
      event.type === "updated" &&
      previous?.type === "updated" &&
      previous.entryId === event.entryId &&
      previous.dateKey === day
    ) {
      previous.count += 1;
      if (!previous.authors.includes(event.author)) previous.authors.push(event.author);
      continue;
    }
    rows.push({ ...event, dateKey: day, count: 1, authors: [event.author] });
  }
  return rows;
}
```

`events` arrive newest first, so a merged row keeps the newest event's commit/timestamp and `authors` collects distinct names in order of first appearance, newest first — exactly the spec's merge rule.

- [ ] **Step 3: Add the nav link**

In `packages/renderer/src/layouts/BaseLayout.astro`, in the `<nav>` block, insert after the Roadmap link:

```astro
<a href={withBase("activity/")}>Activity</a>
```

Resulting order: Dashboard, Roadmap, Activity, Knowledge, Graph, Health, Search.

- [ ] **Step 4: Verify the build still works**

Run: `npm run build`
Expected: build completes; during the build the console shows no `[specdash] activity feed unavailable` warning (this repo has full git history). The nav link 404s for now — the page arrives in Task 7.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/lib/project.ts packages/renderer/src/lib/activity.ts packages/renderer/src/layouts/BaseLayout.astro
git commit -m "feat(renderer): load activity data and add Activity nav link"
```

---

### Task 7: `/activity` page with URL-backed filters and styles

**Files:**
- Create: `packages/renderer/src/pages/activity/index.astro`
- Modify: `assets/style.css` (shared stylesheet — `global.css` imports it)

**Interfaces:**
- Consumes: `activity`, `snapshot`, `hrefFor` from `../../lib/project`; `mergeUpdated`, `describeEvent` from `../../lib/activity`.

- [ ] **Step 1: Create the page**

`packages/renderer/src/pages/activity/index.astro`:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { describeEvent, mergeUpdated } from "../../lib/activity";
import { activity, hrefFor, snapshot } from "../../lib/project";

const EVENT_TYPES = ["created", "state-changed", "milestone-changed", "priority-changed", "updated", "removed"];
const liveIds = new Set([...snapshot.specs, ...snapshot.knowledge].map((entry) => entry.id));
const rows = mergeUpdated(activity.events);
const days: Array<{ date: string; rows: typeof rows }> = [];
for (const row of rows) {
  const last = days.at(-1);
  if (last && last.date === row.dateKey) last.rows.push(row);
  else days.push({ date: row.dateKey, rows: [row] });
}
---
<BaseLayout title="Activity">
  <section class="activity">
    <header class="page-head">
      <p class="eyebrow">Change view</p>
      <h1>Activity</h1>
      <p class="page-job">What changed recently — creations, lifecycle moves, and edits derived from git history.</p>
    </header>

    {!activity.available && (
      <div class="activity-notice" role="status">
        Activity requires git history at build time. See the automation guide (docs/AUTOMATION.md) for checkout configuration.
      </div>
    )}

    {activity.available && activity.shallow && (
      <div class="activity-notice" role="status">
        History is truncated: this dashboard was built from a shallow clone. Configure <code>fetch-depth: 0</code> — see docs/AUTOMATION.md.
      </div>
    )}

    {activity.available && (
      <>
        <div class="activity-filters">
          <label>Type
            <select id="activity-type">
              <option value="all">All</option>
              {EVENT_TYPES.map((type) => <option value={type}>{type}</option>)}
            </select>
          </label>
          <label>Kind
            <select id="activity-kind">
              <option value="all">All</option>
              <option value="spec">Spec</option>
              <option value="knowledge">Knowledge</option>
            </select>
          </label>
          <label>Filter
            <input id="activity-q" type="search" placeholder="Filter by id, title, change…" autocomplete="off" />
          </label>
        </div>
        <p class="activity-count" id="activity-count" role="status"></p>
        <div class="activity-empty" id="activity-empty" role="status" hidden>
          No activity matches these filters. Clear a filter to see more.
        </div>

        {days.map((day) => (
          <section class="activity-day" data-activity-day>
            <h2>{day.date}</h2>
            <ul class="activity-list">
              {day.rows.map((row) => (
                <li
                  class="activity-row"
                  data-activity-row
                  data-type={row.type}
                  data-kind={row.entryKind}
                  data-search={`${row.entryId} ${row.entryTitle} ${describeEvent(row)}`.toLowerCase()}
                >
                  <span class="pill activity-badge" data-event={row.type}>{row.type}</span>
                  {liveIds.has(row.entryId) ? (
                    <a class="activity-entry" href={hrefFor(row.entryKind === "spec" ? "specs" : "knowledge", row.entryId)}>
                      <span class="activity-id">{row.entryId}</span> {row.entryTitle}
                    </a>
                  ) : (
                    <span class="activity-entry"><span class="activity-id">{row.entryId}</span> {row.entryTitle}</span>
                  )}
                  <span class="activity-desc">{describeEvent(row)}</span>
                  <span class="activity-author">{row.authors.join(", ")}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </>
    )}
  </section>

  {activity.available && (
    <script>
      const typeSelect = document.querySelector("#activity-type");
      const kindSelect = document.querySelector("#activity-kind");
      const queryInput = document.querySelector("#activity-q");
      const countLine = document.querySelector("#activity-count");
      const emptyState = document.querySelector("#activity-empty");
      const rows = [...document.querySelectorAll("[data-activity-row]")];
      const dayGroups = [...document.querySelectorAll("[data-activity-day]")];
      const TYPES = ["created", "state-changed", "milestone-changed", "priority-changed", "updated", "removed"];
      const KINDS = ["spec", "knowledge"];

      const params = new URLSearchParams(location.search);
      if (TYPES.includes(params.get("type") ?? "")) typeSelect.value = params.get("type");
      if (KINDS.includes(params.get("kind") ?? "")) kindSelect.value = params.get("kind");
      queryInput.value = params.get("q") ?? "";

      function apply() {
        const type = typeSelect.value;
        const kind = kindSelect.value;
        const query = queryInput.value.trim().toLowerCase();
        let shown = 0;
        for (const row of rows) {
          const match =
            (type === "all" || row.dataset.type === type) &&
            (kind === "all" || row.dataset.kind === kind) &&
            (!query || (row.dataset.search ?? "").includes(query));
          row.hidden = !match;
          if (match) shown += 1;
        }
        for (const day of dayGroups) {
          day.hidden = ![...day.querySelectorAll("[data-activity-row]")].some((row) => !row.hidden);
        }
        countLine.textContent = `Showing ${shown} of ${rows.length} events`;
        emptyState.hidden = shown > 0;
        const next = new URLSearchParams();
        if (type !== "all") next.set("type", type);
        if (kind !== "all") next.set("kind", kind);
        if (queryInput.value.trim()) next.set("q", queryInput.value.trim());
        history.replaceState(null, "", next.size > 0 ? `?${next}` : location.pathname);
      }

      typeSelect.addEventListener("change", apply);
      kindSelect.addEventListener("change", apply);
      queryInput.addEventListener("input", apply);
      apply();
    </script>
  )}
</BaseLayout>
```

- [ ] **Step 2: Add styles**

Append to `assets/style.css` (follow the existing token/variable names used by `.roadmap-*` and `.pill` rules — inspect them before writing; the classes to style are):

```css
.activity { display: grid; gap: 18px; }
.activity-filters { display: flex; flex-wrap: wrap; gap: 14px; align-items: end; }
.activity-filters label { display: grid; gap: 4px; font-size: 0.85rem; color: var(--muted); }
.activity-count { color: var(--muted); font-size: 0.9rem; margin: 0; }
.activity-empty { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; color: var(--muted); }
.activity-notice { border: 1px solid var(--border); border-left: 3px solid var(--warn, #fbbf24); border-radius: var(--radius); padding: 12px 14px; }
.activity-day h2 { font-size: 0.95rem; color: var(--muted); margin: 12px 0 6px; }
.activity-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.activity-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); }
.activity-row[data-type="updated"] { opacity: 0.65; }
.activity-id { font-family: var(--mono, monospace); font-size: 0.85rem; }
.activity-desc { color: var(--muted); }
.activity-author { margin-left: auto; color: var(--muted); font-size: 0.85rem; }
.activity-badge[data-event="state-changed"] { font-weight: 600; }
@media (max-width: 480px) { .activity-author { margin-left: 0; } }
```

If `--warn`, `--mono`, `--muted`, `--border`, or `--radius` do not exist in `assets/style.css`, substitute the actual token names used by neighbouring rules — do not invent new tokens.

- [ ] **Step 3: Verify the built page**

Run: `npm run build`
Then:
```bash
test -f dist/activity/index.html && echo PAGE-OK
grep -c 'data-activity-row' dist/activity/index.html
grep -o 'activity/' dist/index.html | head -1
```
Expected: `PAGE-OK`; a row count > 0 (this repo's own history); the nav link present on the dashboard page.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/pages/activity/index.astro assets/style.css
git commit -m "feat(renderer): activity feed page with URL-backed filters"
```

---

### Task 8: `ActivityHistory` component on entry pages

**Files:**
- Create: `packages/renderer/src/components/ActivityHistory.astro`
- Modify: `packages/renderer/src/pages/specs/[...id].astro`
- Modify: `packages/renderer/src/pages/knowledge/[...id].astro`

**Interfaces:**
- Consumes: `activity` from `../lib/project`; `dateKey`, `describeEvent` from `../lib/activity`.
- Produces: `<ActivityHistory id={entry.data.id} />` — renders nothing when `activity.available` is false.

- [ ] **Step 1: Create the component**

`packages/renderer/src/components/ActivityHistory.astro`:

```astro
---
import { dateKey, describeEvent } from "../lib/activity";
import { activity } from "../lib/project";

interface Props {
  id: string;
}

const { id } = Astro.props;
const events = activity.events.filter((event) => event.entryId === id);
---
{activity.available && (
  <section class="activity-history">
    <h2>History</h2>
    {activity.shallow && (
      <p class="activity-truncated">History may be truncated — this dashboard was built from a shallow clone.</p>
    )}
    {events.length === 0 ? (
      <p class="activity-history-empty">No recorded history yet.</p>
    ) : (
      <ul class="activity-list">
        {events.map((event) => (
          <li class="activity-row" data-type={event.type}>
            <span class="pill activity-badge" data-event={event.type}>{event.type}</span>
            <span class="activity-desc">{describeEvent(event)}</span>
            <time datetime={dateKey(event.timestamp)}>{dateKey(event.timestamp)}</time>
            <span class="activity-author">{event.author}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
)}
```

Per-entry history is **unmerged** (no `mergeUpdated`) by spec.

- [ ] **Step 2: Render it on both entry pages**

In `packages/renderer/src/pages/specs/[...id].astro` and `packages/renderer/src/pages/knowledge/[...id].astro`: import the component and add `<ActivityHistory id={entry.data.id} />` directly after `<Relationships id={entry.data.id} />` (specs) / at the equivalent position (knowledge — inspect the file; it mirrors the specs page).

```astro
import ActivityHistory from "../../components/ActivityHistory.astro";
```

- [ ] **Step 3: Add the two remaining styles**

Append to `assets/style.css`:

```css
.activity-history { margin-top: 28px; display: grid; gap: 10px; }
.activity-history h2 { font-size: 1rem; margin: 0; }
.activity-history-empty, .activity-truncated { color: var(--muted); font-size: 0.9rem; margin: 0; }
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Then:
```bash
grep -c 'activity-history' dist/specs/SPEC-012/index.html
grep -c 'activity-history' dist/knowledge/KB-001/index.html || true
```
Expected: SPEC-012's page contains a History section with events from this repo's real history (it shipped today — at least a `created` event). Use an id that exists under `dist/knowledge/` for the second check (list `dist/knowledge/` first).

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/components/ActivityHistory.astro "packages/renderer/src/pages/specs/[...id].astro" "packages/renderer/src/pages/knowledge/[...id].astro" assets/style.css
git commit -m "feat(renderer): per-entry activity history sections"
```

---

### Task 9: Documentation and workflow updates

**Files:**
- Modify: `README.md` (Requirements section)
- Modify: `docs/AUTOMATION.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: README requirement**

In `README.md`, under `## Requirements`, add:

```markdown
- Git 2.42 or newer for the activity feed (older Git builds the dashboard without activity)
```

Also add one bullet to the "Dashboard intelligence" list:

```markdown
- a git-derived activity feed with per-entry history sections showing creations, lifecycle moves, and edits;
```

- [ ] **Step 2: AUTOMATION.md**

Near the existing `fetch-depth: 0` guidance (line ~178: "The comparison requires enough Git history…"), extend the paragraph:

```markdown
The activity feed also requires full history at build time: a shallow checkout truncates the feed and suppresses creation events at the shallow boundary. Use `fetch-depth: 0` in any workflow that builds the dashboard, including Pages deployment.
```

Add `fetch-depth: 0` to the Pages workflow example checkout step in this doc if it lacks one (the doc's line ~112 checkout).

- [ ] **Step 3: TROUBLESHOOTING.md**

Add a section following the document's existing heading style:

```markdown
## Activity page shows "Activity requires git history"

The activity feed is extracted from git at build time. This message means the build ran without usable history: the project is not a git repository, git is missing, or git is older than 2.42. Build from a full clone with Git ≥ 2.42. If the page shows a truncation banner instead, the checkout was shallow — use `fetch-depth: 0`.
```

- [ ] **Step 4: Pages workflow**

In `.github/workflows/pages.yml`, extend the checkout step:

```yaml
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
```

- [ ] **Step 5: Verify and commit**

Run: `npm run validate` (config and content untouched — must stay green).

```bash
git add README.md docs/AUTOMATION.md docs/TROUBLESHOOTING.md .github/workflows/pages.yml
git commit -m "docs: activity feed requirements, shallow-clone guidance, full-history Pages checkout"
```

---

### Task 10: End-to-end verification sweep

**Files:** none created — verification only. Fix regressions where they live; re-run.

- [ ] **Step 1: Full test suite and build**

```bash
npm test
npm run build
```
Expected: all suites pass; build succeeds with no activity warning.

- [ ] **Step 2: Degraded build (no git)**

```bash
SCRATCH=$(mktemp -d)
git archive HEAD | tar -x -C "$SCRATCH"
cd "$SCRATCH" && npm install --no-audit --no-fund && npm run build; cd -
grep -c "Activity requires git history" "$SCRATCH/dist/activity/index.html"
```
Expected: the copied tree (no `.git`) builds successfully, the build log contains exactly one `[specdash] activity feed unavailable` warning, and the notice appears on the activity page. Entry pages contain no `activity-history` section.

- [ ] **Step 3: Browser sweep (Playwright MCP)**

Start the dev server (`npm run dev`), then with the Playwright MCP tools verify on `/activity`:

1. Day groups render newest first; each row shows badge, id+title, description, author.
2. Deep-link `?type=state-changed&kind=spec&q=search` hydrates all three controls and filters rows; the count line reads `Showing X of N events` counting rendered rows.
3. Changing a filter updates rows and the URL query via replaceState (no history entries added — Back leaves the page).
4. An invalid param (`?type=bogus`) falls back to "All".
5. An `updated ×n` merged row exists (this repo has multi-edit days) and counts once.
6. A no-match query shows the directive empty state and hides all day headings.
7. Clicking a row's entry link navigates to the entry page, which shows a History section with matching unmerged events.
8. At 390×844 the page has no horizontal overflow.

Close the browser with `browser_close` when done (per global Playwright guidance). Screenshots go under the project root, not /tmp.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(renderer): activity feed verification fixes"
```
(Skip if the sweep found nothing.)

---

## Self-Review Notes

- Spec coverage: extraction (Tasks 1–5), renderer feed + filters (Tasks 6–7), per-entry history (Task 8), degradation states (Tasks 5, 7, 8, 10), docs/workflow (Task 9), verification incl. merge, shallow `file://` depth-2 clone, nested root, old git, empty repo (Task 5), browser sweep (Task 10).
- Out of scope per spec: no MCP/`project.json` exposure, no RSS, no config knobs, no owner events, no metrics.
- Type consistency: `TrackedFields`/`ChangeDelta`/`ActivityEvent`/`ActivityResult`/`CommitRecord`/`StatusRecord` defined in Task 1–2 and consumed by name in Tasks 4–8; renderer helpers `dateKey`/`describeEvent`/`mergeUpdated` defined in Task 6, consumed in Tasks 7–8.
