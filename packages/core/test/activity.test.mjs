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
