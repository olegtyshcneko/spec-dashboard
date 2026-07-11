import assert from "node:assert/strict";
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

    const result = await client.callTool({ name: "specdash.validate", arguments: {} });
    assert.equal(result.structuredContent.valid, true);
    assert.equal(result.structuredContent.specs, 6);
    const scan = await client.callTool({ name: "specdash.scan", arguments: {} });
    assert.equal(scan.structuredContent.nextSpecId, "SPEC-007");
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
