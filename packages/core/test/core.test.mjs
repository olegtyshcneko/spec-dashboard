import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProject } from "../dist/index.js";

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
