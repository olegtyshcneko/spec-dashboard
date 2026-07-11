import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertTransition, loadProject } from "../dist/index.js";

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
