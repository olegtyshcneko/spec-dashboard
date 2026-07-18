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
