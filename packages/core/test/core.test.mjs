import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertTransition, loadProject, reconcileProject } from "../dist/index.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-core-"));
  fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "content/knowledge"), { recursive: true });
  fs.writeFileSync(path.join(root, "specdash.config.yaml"), `
schemaVersion: 1
project:
  name: Test
contentDir: content
outputDir: dist
categories:
  - id: platform
    label: Platform
`);
  return root;
}

test("loads valid MDX frontmatter", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "content/specs/example.mdx"), `---
schemaVersion: 1
id: SPEC-001
title: Example feature
summary: A sufficiently useful example summary.
kind: feature
state: backlog
priority: p1
categories: [platform]
tags: []
owners: []
dependsOn: []
related: []
sourceRefs: []
created: 2026-07-11
updated: 2026-07-11
---
# Intent
Example.
`);
  const project = loadProject(root);
  assert.equal(project.specs.length, 1);
  assert.deepEqual(project.diagnostics, []);
});

test("reports broken references", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "content/specs/example.mdx"), `---
schemaVersion: 1
id: SPEC-001
title: Example feature
summary: A sufficiently useful example summary.
kind: feature
state: backlog
priority: p1
categories: [platform]
tags: []
owners: []
dependsOn: [SPEC-999]
related: []
sourceRefs: []
created: 2026-07-11
updated: 2026-07-11
---
Body.
`);
  const project = loadProject(root);
  assert.equal(project.diagnostics[0]?.code, "broken-reference");
});

test("derives task progress, graph edges, and readiness diagnostics", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "content/specs/foundation.mdx"), `---
schemaVersion: 1
id: SPEC-001
title: Foundation feature
summary: A sufficiently useful foundation summary.
kind: feature
state: shipped
priority: p0
categories: [platform]
tags: []
owners: [maintainer]
dependsOn: []
related: []
sourceRefs:
  - type: file
    value: src/index.ts
created: 2026-07-01
updated: 2026-07-01
---
## Acceptance criteria
- [x] Foundation exists.
`);
  fs.writeFileSync(path.join(root, "content/specs/active.mdx"), `---
schemaVersion: 1
id: SPEC-002
title: Active feature
summary: A sufficiently useful active feature summary.
kind: feature
state: active
priority: p1
categories: [platform]
tags: []
owners: []
nextAction: Complete the open task.
dependsOn: [SPEC-001]
related: []
sourceRefs: []
created: 2026-07-01
updated: 2026-07-01
---
## Acceptance criteria
- [x] First task.
- [ ] Second task.
`);
  const project = loadProject(root, { now: new Date("2026-07-11T00:00:00Z") });
  assert.deepEqual(project.edges, [{ from: "SPEC-002", to: "SPEC-001", type: "depends-on" }]);
  assert.equal(project.specs.find((entry) => entry.id === "SPEC-002").analysis.tasks.done, 1);
  assert.ok(project.diagnostics.some((diagnostic) => diagnostic.code === "missing-owner"));
});

test("enforces explicit lifecycle transitions", () => {
  assert.doesNotThrow(() => assertTransition("review", "shipped"));
  assert.throws(() => assertTransition("backlog", "shipped"), /Invalid lifecycle transition/);
});

test("reconciles changed Git evidence without mutating specifications", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.ts"), "export const version = 1;\n");
  const specPath = path.join(root, "content/specs/example.mdx");
  fs.writeFileSync(specPath, `---
schemaVersion: 1
id: SPEC-001
title: Reconciled feature
summary: A sufficiently useful reconciliation example.
kind: feature
state: active
priority: p1
categories: [platform]
tags: []
owners: [maintainer]
nextAction: Review the completed implementation.
dependsOn: []
related: []
sourceRefs:
  - type: file
    value: src/app.ts
created: 2026-07-10
updated: 2026-07-10
---
## Acceptance criteria
- [x] Implementation is complete.
`);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Spec Dashboard Test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "Initial spec"], {
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-07-10T10:00:00Z", GIT_COMMITTER_DATE: "2026-07-10T10:00:00Z" },
  });
  fs.writeFileSync(path.join(root, "src/app.ts"), "export const version = 2;\n");
  execFileSync("git", ["-C", root, "add", "src/app.ts"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "Implement feature"], {
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-07-11T10:00:00Z", GIT_COMMITTER_DATE: "2026-07-11T10:00:00Z" },
  });

  const before = fs.readFileSync(specPath, "utf8");
  const report = reconcileProject(loadProject(root), { since: "HEAD~1" });
  assert.deepEqual(report.changedFiles, ["src/app.ts"]);
  assert.ok(report.suggestions.some((suggestion) => suggestion.kind === "source-changed"));
  assert.ok(report.suggestions.some((suggestion) => suggestion.kind === "documentation-stale"));
  assert.ok(report.suggestions.some((suggestion) => suggestion.kind === "transition-candidate" && suggestion.proposedAction.includes("review")));
  assert.equal(fs.readFileSync(specPath, "utf8"), before);
});
