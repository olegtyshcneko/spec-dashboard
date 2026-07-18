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
