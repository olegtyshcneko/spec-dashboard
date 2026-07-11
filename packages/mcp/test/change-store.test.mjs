import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChangeStore } from "../dist/change-store.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-mcp-"));
  fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "content/knowledge"), { recursive: true });
  fs.writeFileSync(path.join(root, "specdash.config.yaml"), `schemaVersion: 1
project:
  name: MCP Test
contentDir: content
outputDir: dist
categories:
  - id: platform
    label: Platform
`);
  const file = path.join(root, "content/specs/example.mdx");
  fs.writeFileSync(file, `---
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
blockers: []
dependsOn: []
related: []
sourceRefs: []
created: 2026-07-11
updated: 2026-07-11
---
## Intent
Original.
`);
  return { root, file };
}

test("previews and applies a revision-bound content change", () => {
  const { root, file } = fixture();
  const store = new ChangeStore(root);
  const content = fs.readFileSync(file, "utf8").replace("Original.", "Updated.");
  const preview = store.preview("content/specs/example.mdx", content);
  assert.match(preview.diff, /\+Updated\./);
  const result = store.apply(preview.changeId, preview.expectedRevision);
  assert.equal(result.applied, true);
  assert.match(fs.readFileSync(file, "utf8"), /Updated\./);
});

test("rejects traversal outside the content root", () => {
  const { root } = fixture();
  const store = new ChangeStore(root);
  assert.throws(() => store.preview("../README.mdx", "unsafe"), /outside the configured content root/);
});

test("rolls back invalid changes", () => {
  const { root, file } = fixture();
  const store = new ChangeStore(root);
  const before = fs.readFileSync(file, "utf8");
  const preview = store.preview("content/specs/example.mdx", "---\nid: invalid\n---\nbroken");
  assert.throws(() => store.apply(preview.changeId, preview.expectedRevision), /invalidate the project/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});
