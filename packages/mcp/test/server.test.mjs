import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("serves resources and structured tools over stdio", async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "packages/mcp/dist/index.js"), "--root", root],
    cwd: root,
    stderr: "pipe",
  });
  const client = new Client({ name: "specdash-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "specdash.validate"));
    assert.ok(tools.tools.some((tool) => tool.name === "specdash.apply_change"));
    assert.ok(tools.tools.some((tool) => tool.name === "specdash.scan"));
    assert.ok(tools.tools.some((tool) => tool.name === "specdash.reconcile"));

    const result = await client.callTool({ name: "specdash.validate", arguments: {} });
    assert.equal(result.structuredContent.valid, true);
    assert.equal(result.structuredContent.specs, 6);
    const scan = await client.callTool({ name: "specdash.scan", arguments: {} });
    assert.equal(scan.structuredContent.nextSpecId, "SPEC-007");
    const reconciliation = await client.callTool({ name: "specdash.reconcile", arguments: { since: "HEAD~1" } });
    assert.equal(reconciliation.structuredContent.repository.since, "HEAD~1");
    assert.ok(Array.isArray(reconciliation.structuredContent.suggestions));
    const build = await client.callTool({ name: "specdash.build", arguments: {} });
    assert.equal(build.structuredContent.exitCode, 0);

    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "specdash://items/SPEC-004"));
    const item = await client.readResource({ uri: "specdash://items/SPEC-004" });
    assert.match(item.contents[0].text, /Scoped project MCP server/);
  } finally {
    await client.close();
  }
});

test("initializes an unconfigured project through preview and apply", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specdash-init-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "packages/mcp/dist/index.js"), "--root", projectRoot],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "specdash-init-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const preview = await client.callTool({ name: "specdash.init", arguments: { projectName: "New Project", categories: [{ id: "platform", label: "Platform" }], apply: false } });
    assert.equal(preview.structuredContent.applied, false);
    assert.equal(fs.existsSync(path.join(projectRoot, "specdash.config.yaml")), false);
    const applied = await client.callTool({ name: "specdash.init", arguments: { projectName: "New Project", categories: [{ id: "platform", label: "Platform" }], apply: true } });
    assert.equal(applied.structuredContent.initialized, true);
    assert.equal(fs.existsSync(path.join(projectRoot, "specdash.config.yaml")), true);
    const validation = await client.callTool({ name: "specdash.validate", arguments: {} });
    assert.equal(validation.structuredContent.valid, true);
  } finally {
    await client.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
