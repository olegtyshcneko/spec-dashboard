import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";

import { checkVersions } from "./check-versions.mjs";

const WORKSPACES = ["cli", "core", "mcp", "renderer"];

function write(root, relativePath, contents) {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

/**
 * Builds a miniature repository mirroring the real version topology:
 * root/workspaces at `rootVersion`, plugin manifests at `manifestVersion`,
 * and every tag pin at `pinVersion`.
 */
function buildFixture({ rootVersion = "0.9.0", manifestVersion = "0.8.0", pinVersion = "0.8.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "specdash-versions-"));

  write(root, "package.json", JSON.stringify({ name: "spec-dashboard", version: rootVersion }, null, 2));
  for (const workspace of WORKSPACES) {
    const manifest = { name: `@spec-dashboard/${workspace}`, version: rootVersion };
    if (workspace === "cli") manifest.dependencies = { "@spec-dashboard/core": rootVersion };
    write(root, `packages/${workspace}/package.json`, JSON.stringify(manifest, null, 2));
  }
  write(root, "package-lock.json", JSON.stringify({
    name: "spec-dashboard",
    version: rootVersion,
    packages: {
      "": { name: "spec-dashboard", version: rootVersion },
      ...Object.fromEntries(WORKSPACES.map((w) => [`packages/${w}`, { version: rootVersion }])),
    },
  }, null, 2));

  write(root, "packages/cli/src/index.ts", `const VERSION = "${rootVersion}";\n`);
  write(root, "packages/mcp/src/index.ts", `console.error("Spec Dashboard MCP ${rootVersion} running over stdio");\n`);
  write(root, "packages/mcp/src/server.ts", `const server = new McpServer({ name: "spec-dashboard", version: "${rootVersion}" });\n`);

  const pinArgs = `--package=github:olegtyshcneko/spec-dashboard#v${pinVersion}`;
  write(root, "plugins/spec-dashboard/.codex-plugin/plugin.json", JSON.stringify({ name: "spec-dashboard", version: manifestVersion }, null, 2));
  write(root, "plugins/spec-dashboard/.claude-plugin/plugin.json", JSON.stringify({
    name: "spec-dashboard",
    version: manifestVersion,
    mcpServers: { "spec-dashboard": { command: "npx", args: ["--yes", pinArgs, "specdash-mcp"] } },
  }, null, 2));
  write(root, "plugins/spec-dashboard/mcp.codex.json", JSON.stringify({
    mcpServers: { "spec-dashboard": { command: "npx", args: ["--yes", pinArgs, "specdash-mcp"] } },
  }, null, 2));

  write(root, "README.md", `codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v${pinVersion}\n`);
  write(root, "docs/AUTOMATION.md", `env:\n  SPECDASH_REF: v${pinVersion}\n`);
  // Historical artifact carrying an old pin — must be ignored by discovery.
  write(root, "docs/superpowers/specs/2026-01-01-old-design.md", "npx --package=github:olegtyshcneko/spec-dashboard#v0.1.0\n");

  return root;
}

test("a consistent tree reports no problems", () => {
  const root = buildFixture();
  try {
    const result = checkVersions({ root });
    assert.deepEqual(result.problems, []);
    assert.equal(result.rootVersion, "0.9.0");
    assert.equal(result.releaseVersion, "0.8.0");
    assert.equal(result.pinCount, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release mode requires manifests and pins to reach the root version", () => {
  const root = buildFixture();
  try {
    const problems = checkVersions({ root, release: true }).problems;
    assert.ok(problems.some((p) => p.includes("plugin manifest version 0.8.0")), problems.join("\n"));
    assert.ok(problems.some((p) => p.includes("tag pins are at v0.8.0")), problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release mode passes once everything is bumped together", () => {
  const root = buildFixture({ rootVersion: "0.10.0", manifestVersion: "0.10.0", pinVersion: "0.10.0" });
  try {
    assert.deepEqual(checkVersions({ root, release: true }).problems, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a single stray pin is reported with its file", () => {
  const root = buildFixture();
  try {
    write(root, "docs/TROUBLESHOOTING.md", "npx --package=github:olegtyshcneko/spec-dashboard#v0.7.0 specdash --version\n");
    const problems = checkVersions({ root }).problems;
    assert.ok(problems.some((p) => p.includes("docs/TROUBLESHOOTING.md") && p.includes("v0.7.0")), problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace and cross-workspace drift is reported", () => {
  const root = buildFixture();
  try {
    write(root, "packages/core/package.json", JSON.stringify({ name: "@spec-dashboard/core", version: "0.8.0" }, null, 2));
    write(root, "packages/cli/package.json", JSON.stringify({
      name: "@spec-dashboard/cli",
      version: "0.9.0",
      dependencies: { "@spec-dashboard/core": "0.8.0" },
    }, null, 2));
    const problems = checkVersions({ root }).problems;
    assert.ok(problems.some((p) => p.includes("packages/core/package.json version 0.8.0")), problems.join("\n"));
    assert.ok(problems.some((p) => p.includes("dependencies.@spec-dashboard/core")), problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mismatched plugin manifests are reported", () => {
  const root = buildFixture();
  try {
    write(root, "plugins/spec-dashboard/.claude-plugin/plugin.json", JSON.stringify({ name: "spec-dashboard", version: "0.9.0" }, null, 2));
    const problems = checkVersions({ root }).problems;
    assert.ok(problems.some((p) => p.includes("plugin manifest versions disagree")), problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
