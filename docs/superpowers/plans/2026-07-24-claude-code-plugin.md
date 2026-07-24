# Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `plugins/spec-dashboard` plugin installable from Claude Code — same skills, same MCP server — without breaking the Codex plugin, and ship it as v0.10.0 with mechanical release guards.

**Architecture:** One shared plugin directory serves both ecosystems. Only the manifests and MCP launch configuration are per-tool: Codex keeps a file-pointer config (`mcp.codex.json`, `--root .`), Claude Code gets an inline `mcpServers` block in `.claude-plugin/plugin.json` using `--root ${CLAUDE_PROJECT_DIR}`. A dependency-free Node script discovers every version string and tag pin in the repo and fails CI when they disagree.

**Tech Stack:** Node >= 22.12 (ESM, `node --test`), npm workspaces, JSON manifests, GitHub Actions. No new runtime or dev dependencies.

**Design spec:** `docs/superpowers/specs/2026-07-24-claude-code-plugin-design.md` — read it before starting.

## Global Constraints

- **Branch, never main.** All tasks happen on branch `claude-code-plugin`. Main receives the whole set in one push (see Task 6 atomicity rule). Create it first: `git switch -c claude-code-plugin`.
- **Node >= 22.12**, npm workspaces; the guard script uses only `node:` builtins — no new dependencies anywhere.
- **Tag pins do not move until Task 6.** Tasks 1–5 leave every `#v0.8.0` / `--ref v0.8.0` / `SPECDASH_REF: v0.8.0` pin at `v0.8.0`, and both plugin manifests at version `0.8.0`. Root `package.json` stays `0.9.0` until Task 6. `npm run check:versions` must pass at the end of every task.
- **Repo version reality (verified 2026-07-24):** root and all four workspaces are `0.9.0`; the Codex plugin manifest is `0.8.0`; all 19 discovered tag pins are `v0.8.0`. Manifest versions trailing root is the standing convention, not drift.
- **Verified toolchain:** Claude Code 2.1.219, Codex CLI 0.145.0, both installed locally.
- **Content baseline:** `npm run validate` currently reports 12 specs, 1 knowledge entry, **zero diagnostics**. That zero is the bar for Task 5.
- **Commit trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- **Never invent** owners, dates, URLs, or completion claims in dashboard content.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/check-versions.mjs` (new) | Discovers and cross-checks all version strings and tag pins. Exports `checkVersions()`; CLI entry when run directly. |
| `scripts/check-versions.test.mjs` (new) | Fixture-based `node --test` coverage of the three rule classes and both modes. |
| `package.json` (modify) | Adds `check:versions` script; extends `test` to run the guard's tests. |
| `.github/workflows/validate.yml` (modify) | Adds the guard step, a tag-push trigger running release mode, and an isolated plugin-manifest lint job. |
| `plugins/spec-dashboard/mcp.codex.json` (renamed from `.mcp.json`) | Codex MCP launch, `--root .`. No longer auto-discovered by Claude Code. |
| `plugins/spec-dashboard/.codex-plugin/plugin.json` (modify) | Points `mcpServers` at the renamed file. |
| `plugins/spec-dashboard/.claude-plugin/plugin.json` (new) | Claude Code manifest + inline `mcpServers` with `${CLAUDE_PROJECT_DIR}`. |
| `.claude-plugin/marketplace.json` (new, repo root) | Claude Code catalog pointing at `./plugins/spec-dashboard`. |
| `plugins/spec-dashboard/skills/*/SKILL.md` (modify ×4) | Tool references rephrased tool-agnostically. |
| `README.md`, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/AUTOMATION.md`, `docs/MCP_REFERENCE.md`, `CLAUDE.md` (modify) | Claude Code install path, renamed-file references, release checklist. |
| `specdash.config.yaml`, `content/specs/*.mdx` (modify/new) | Dogfooding: `v0-9-0`/`v0-10-0` milestones, SPEC-013/014/015, SPEC-012 retarget. |

---

### Task 1: Release guard script

**Files:**
- Create: `scripts/check-versions.mjs`
- Create: `scripts/check-versions.test.mjs`
- Modify: `package.json:31-40` (scripts block)
- Modify: `.github/workflows/validate.yml:3-6` (triggers), `:29-30` (new step)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `checkVersions({ root, release })` → `{ rootVersion: string, releaseVersion: string | null, pinCount: number, problems: string[] }`. Later tasks rely on `npm run check:versions` (default mode) and `npm run check:versions -- --release` (Task 6).

- [ ] **Step 1: Create the branch**

```bash
git switch -c claude-code-plugin
```

- [ ] **Step 2: Write the failing test**

Create `scripts/check-versions.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/check-versions.test.mjs`
Expected: FAIL — cannot resolve module `./check-versions.mjs`.

- [ ] **Step 4: Write the guard script**

Create `scripts/check-versions.mjs`:

```js
#!/usr/bin/env node
/**
 * Cross-checks every version string and Git tag pin in the repository.
 *
 * Three classes of version material:
 *   1. Always lockstep with the root package version (workspaces, lockfile, literal source strings).
 *   2. Release-pinned plugin manifest versions — may trail root between releases, must equal each other.
 *   3. Tag pins — discovered by pattern, never enumerated, must equal the class 2 version.
 *
 * Default mode allows classes 2 and 3 to trail root (the state between releases).
 * `--release` additionally requires them to equal root — the state a tagged release commit must be in.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACES = ["cli", "core", "mcp", "renderer"];

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".astro", ".playwright-mcp", "dist", "coverage",
]);

const SCANNED_EXTENSIONS = new Set([
  ".json", ".md", ".mdx", ".mjs", ".yaml", ".yml", ".ts", ".astro",
]);

// Historical design artifacts record the pins of their own era and are never rewritten.
const EXCLUDED_PATHS = ["docs/superpowers"];

const PIN_PATTERNS = [
  { label: "npx --package pin", pattern: /#v(\d+\.\d+\.\d+)/g },
  { label: "marketplace --ref pin", pattern: /--ref v(\d+\.\d+\.\d+)/g },
  { label: "SPECDASH_REF pin", pattern: /SPECDASH_REF:\s*v(\d+\.\d+\.\d+)/g },
];

const LITERAL_SITES = [
  { file: "packages/cli/src/index.ts", pattern: /const VERSION = "(\d+\.\d+\.\d+)"/ },
  { file: "packages/mcp/src/index.ts", pattern: /Spec Dashboard MCP (\d+\.\d+\.\d+) running over stdio/ },
  { file: "packages/mcp/src/server.ts", pattern: /version: "(\d+\.\d+\.\d+)" \}\)/ },
];

const MANIFESTS = [
  "plugins/spec-dashboard/.codex-plugin/plugin.json",
  "plugins/spec-dashboard/.claude-plugin/plugin.json",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function* walk(root, current = root) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    const rel = relative(root, full).split("\\").join("/");
    if (EXCLUDED_PATHS.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walk(root, full);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      yield { rel, full };
    }
  }
}

export function checkVersions({ root, release = false }) {
  const problems = [];
  const rootVersion = readJson(join(root, "package.json")).version;

  // Class 1 — always lockstep with the root version.
  for (const workspace of WORKSPACES) {
    const relativePath = `packages/${workspace}/package.json`;
    const manifest = readJson(join(root, relativePath));
    if (manifest.version !== rootVersion) {
      problems.push(`${relativePath} version ${manifest.version} != root ${rootVersion}`);
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith("@spec-dashboard/") && range !== rootVersion) {
          problems.push(`${relativePath} ${field}.${name} pinned at ${range} != root ${rootVersion}`);
        }
      }
    }
  }

  const lock = readJson(join(root, "package-lock.json"));
  if (lock.version !== rootVersion) {
    problems.push(`package-lock.json version ${lock.version} != root ${rootVersion}`);
  }
  if (lock.packages?.[""]?.version !== rootVersion) {
    problems.push(`package-lock.json packages[""] version ${lock.packages?.[""]?.version} != root ${rootVersion}`);
  }
  for (const workspace of WORKSPACES) {
    const key = `packages/${workspace}`;
    const entry = lock.packages?.[key];
    if (!entry) {
      problems.push(`package-lock.json is missing the ${key} entry`);
    } else if (entry.version !== rootVersion) {
      problems.push(`package-lock.json ${key} version ${entry.version} != root ${rootVersion}`);
    }
  }

  for (const site of LITERAL_SITES) {
    const source = readFileSync(join(root, site.file), "utf8");
    const match = source.match(site.pattern);
    if (!match) {
      problems.push(`${site.file} no longer contains a recognizable version string (${site.pattern})`);
    } else if (match[1] !== rootVersion) {
      problems.push(`${site.file} version ${match[1]} != root ${rootVersion}`);
    }
  }

  // Class 2 — release-pinned plugin manifest versions.
  const manifestVersions = MANIFESTS
    .filter((relativePath) => existsSync(join(root, relativePath)))
    .map((relativePath) => ({ relativePath, version: readJson(join(root, relativePath)).version }));
  const distinctManifestVersions = [...new Set(manifestVersions.map((entry) => entry.version))];
  if (distinctManifestVersions.length > 1) {
    const detail = manifestVersions.map((entry) => `${entry.relativePath}=${entry.version}`).join(", ");
    problems.push(`plugin manifest versions disagree: ${detail}`);
  }
  const releaseVersion = distinctManifestVersions.length === 1 ? distinctManifestVersions[0] : null;

  // Class 3 — tag pins, discovered rather than enumerated.
  const pins = [];
  for (const file of walk(root)) {
    const text = readFileSync(file.full, "utf8");
    for (const { label, pattern } of PIN_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        pins.push({ rel: file.rel, label, version: match[1] });
      }
    }
  }
  if (pins.length === 0) {
    problems.push("no tag pins were discovered; the pin patterns are probably stale");
  }
  const expectedPin = releaseVersion ?? pins[0]?.version ?? null;
  for (const pin of pins) {
    if (expectedPin && pin.version !== expectedPin) {
      problems.push(`${pin.rel}: ${pin.label} v${pin.version} != expected v${expectedPin}`);
    }
  }

  if (release) {
    if (releaseVersion === null) {
      problems.push("release mode: no plugin manifest version was found");
    } else if (releaseVersion !== rootVersion) {
      problems.push(`release mode: plugin manifest version ${releaseVersion} != root ${rootVersion}`);
    }
    if (expectedPin && expectedPin !== rootVersion) {
      problems.push(`release mode: tag pins are at v${expectedPin} != root v${rootVersion}`);
    }
  }

  return { rootVersion, releaseVersion, pinCount: pins.length, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const release = process.argv.includes("--release");
  const result = checkVersions({ root: process.cwd(), release });
  const mode = release ? "release" : "default";
  if (result.problems.length > 0) {
    console.error(`check-versions (${mode} mode): ${result.problems.length} problem(s)`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `check-versions (${mode} mode): OK — root ${result.rootVersion}, ` +
    `release pin v${result.releaseVersion}, ${result.pinCount} tag pins consistent`,
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/check-versions.test.mjs`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 6: Run the guard against the real repository**

Run: `node scripts/check-versions.mjs`
Expected: exit 0, and exactly this shape —
`check-versions (default mode): OK — root 0.9.0, release pin v0.8.0, 19 tag pins consistent`

If the pin count is not 19, discovery is wrong — do not "fix" it by editing pins; re-read the pattern list.

- [ ] **Step 7: Verify release mode currently fails**

Run: `node scripts/check-versions.mjs --release`
Expected: exit 1, reporting `plugin manifest version 0.8.0 != root 0.9.0` and `tag pins are at v0.8.0 != root v0.9.0`. This is correct — the tree is not in a release state until Task 6.

- [ ] **Step 8: Wire the npm scripts**

In `package.json`, replace the `test` line and add `check:versions` immediately after it:

```json
    "test": "npm run build:packages && npm run test -w @spec-dashboard/core && npm run test -w @spec-dashboard/mcp && node --test scripts/check-versions.test.mjs",
    "check:versions": "node scripts/check-versions.mjs",
```

- [ ] **Step 9: Wire CI**

In `.github/workflows/validate.yml`, replace the trigger block (lines 3–6) with:

```yaml
on:
  pull_request:
  push:
    branches: [main]
    tags: ['v*']
```

Then insert a new step immediately after the `Run tests` step (before `Validate dashboard content`):

```yaml
      - name: Check version and tag-pin consistency
        run: |
          if [ "${GITHUB_REF_TYPE}" = "tag" ]; then
            npm run check:versions -- --release
          else
            npm run check:versions
          fi
```

- [ ] **Step 10: Verify the full suite still passes**

Run: `npm test`
Expected: core tests pass, mcp tests pass, 6 check-versions tests pass.

- [ ] **Step 11: Commit**

```bash
git add scripts/check-versions.mjs scripts/check-versions.test.mjs package.json .github/workflows/validate.yml
git commit -m "$(cat <<'EOF'
feat(ci): discover and enforce version and tag-pin consistency

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: MCP config split and Claude Code manifests

**Files:**
- Rename: `plugins/spec-dashboard/.mcp.json` → `plugins/spec-dashboard/mcp.codex.json`
- Modify: `plugins/spec-dashboard/.codex-plugin/plugin.json:20` (`mcpServers` pointer)
- Create: `plugins/spec-dashboard/.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Modify: `.github/workflows/validate.yml` (new isolated lint job)

**Interfaces:**
- Consumes: `npm run check:versions` from Task 1.
- Produces: an installable Claude Code plugin named `spec-dashboard` in a marketplace also named `spec-dashboard`; install command `/plugin install spec-dashboard@spec-dashboard`; skills surface as `/spec-dashboard:<skill-name>`.

**Why the rename is load-bearing:** Claude Code auto-discovers a plugin-root file named exactly `.mcp.json`. That file's `--root .` is correct for Codex (server cwd = project root) but wrong for Claude Code, which substitutes `${CLAUDE_PROJECT_DIR}` instead of guaranteeing a project cwd — a server left on auto-discovery would silently scan the plugin cache. `${CLAUDE_PROJECT_DIR}` cannot go in the shared file either: Codex would pass the literal string.

**Version note:** both manifests carry `"version": "0.8.0"` and pin `#v0.8.0` — the currently released runtime, and the only one installable until Task 6 tags v0.10.0. Task 6 moves them together.

- [ ] **Step 1: Rename the Codex MCP config**

```bash
git mv plugins/spec-dashboard/.mcp.json plugins/spec-dashboard/mcp.codex.json
```

Do not edit its contents — `--root .` and `#v0.8.0` both stay.

- [ ] **Step 2: Point the Codex manifest at the renamed file**

In `plugins/spec-dashboard/.codex-plugin/plugin.json`, change:

```json
  "mcpServers": "./.mcp.json",
```

to:

```json
  "mcpServers": "./mcp.codex.json",
```

- [ ] **Step 3: Verify Claude Code no longer auto-discovers a Codex config**

Run: `ls -a plugins/spec-dashboard/`
Expected: no `.mcp.json` entry; `mcp.codex.json` present.

- [ ] **Step 4: Create the Claude Code plugin manifest**

Create `plugins/spec-dashboard/.claude-plugin/plugin.json`:

```json
{
  "name": "spec-dashboard",
  "displayName": "Spec Dashboard",
  "version": "0.8.0",
  "description": "Build and maintain a Git-native specification, planning, backlog, and knowledge dashboard.",
  "author": {
    "name": "Oleg Tyshchenko",
    "url": "https://github.com/olegtyshcneko"
  },
  "homepage": "https://github.com/olegtyshcneko/spec-dashboard",
  "repository": "https://github.com/olegtyshcneko/spec-dashboard",
  "license": "MIT",
  "keywords": [
    "specifications",
    "planning",
    "backlog",
    "knowledge",
    "mcp"
  ],
  "mcpServers": {
    "spec-dashboard": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=github:olegtyshcneko/spec-dashboard#v0.8.0",
        "specdash-mcp",
        "--root",
        "${CLAUDE_PROJECT_DIR}"
      ]
    }
  }
}
```

Skills are auto-discovered from `skills/*/SKILL.md`; do not add a `skills` key.

- [ ] **Step 5: Create the marketplace catalog**

Create `.claude-plugin/marketplace.json` at the repository root:

```json
{
  "name": "spec-dashboard",
  "owner": {
    "name": "Oleg Tyshchenko"
  },
  "description": "Git-native specification, planning, backlog, and knowledge dashboards.",
  "plugins": [
    {
      "name": "spec-dashboard",
      "source": "./plugins/spec-dashboard",
      "description": "Create validated MDX specifications, reconcile them with project evidence, review readiness, and generate a static planning and knowledge dashboard.",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 6: Lint both manifests**

Run: `npx --yes @anthropic-ai/claude-code@2.1.219 plugin validate . --strict`
Then: `npx --yes @anthropic-ai/claude-code@2.1.219 plugin validate ./plugins/spec-dashboard --strict`

Expected: both clean. If the validator rejects a field (most likely candidate: `category` casing) fix the manifest to match the validator and note the correction in the commit body — the validator is authoritative over the design spec's illustrative JSON. If `plugin validate` rejects the repo-root path outright, validate the plugin directory only and record that in the commit body.

- [ ] **Step 7: Verify the version guard still passes**

Run: `npm run check:versions`
Expected: `OK — root 0.9.0, release pin v0.8.0, 20 tag pins consistent`

The count rises from 19 to 20: the new Claude manifest adds one `#v0.8.0` pin. A `plugin manifest versions disagree` error here means Step 4 used the wrong version.

- [ ] **Step 8: Smoke-test the Claude Code install locally**

```bash
claude
```

In the session run:
- `/plugin marketplace add /home/oleg/projects/personal_projects/spec-dashboard`
- `/plugin install spec-dashboard@spec-dashboard`

Expected: install succeeds; `/help` (or the `/` menu) lists four namespaced skills — `/spec-dashboard:bootstrap-spec-dashboard`, `/spec-dashboard:capture-spec-work`, `/spec-dashboard:reconcile-spec-dashboard`, `/spec-dashboard:review-spec-quality`.

Record the observed skill names in the commit body. Uninstall afterwards: `/plugin uninstall spec-dashboard@spec-dashboard` and `/plugin marketplace remove spec-dashboard`.

- [ ] **Step 9: Prove `${CLAUDE_PROJECT_DIR}` scoping against a scratch project**

The published npx pin (`#v0.8.0`) predates this plugin, so test the launch with a local override instead. Create a scratch project and confirm the server binds to *it*, not to the plugin directory:

```bash
mkdir -p /tmp/claude-1000/-home-oleg-projects-personal-projects-spec-dashboard/d723fe5c-4bc4-46e3-8e95-9a7e5d48269c/scratchpad/scratch-project
cd /home/oleg/projects/personal_projects/spec-dashboard && npm run build:packages
node packages/mcp/dist/index.js --root /tmp/claude-1000/-home-oleg-projects-personal-projects-spec-dashboard/d723fe5c-4bc4-46e3-8e95-9a7e5d48269c/scratchpad/scratch-project 2>&1 | head -3
```

Expected: the banner names the running version and the server reports the scratch root (an uninitialized-project error naming that path is a correct outcome — it proves root binding). A server that reports the spec-dashboard repo instead means the root argument was ignored.

- [ ] **Step 10: Add the isolated manifest-lint CI job**

Append to `.github/workflows/validate.yml`, at the same indentation as the existing `validate:` job:

```yaml
  plugin-manifests:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
      - name: Validate marketplace manifest
        run: npx --yes @anthropic-ai/claude-code@2.1.219 plugin validate . --strict
      - name: Validate plugin manifest
        run: npx --yes @anthropic-ai/claude-code@2.1.219 plugin validate ./plugins/spec-dashboard --strict
```

If Step 6 established that the root path is not a valid validate target, include only the plugin-manifest step.

- [ ] **Step 11: Commit**

```bash
git add plugins/spec-dashboard .claude-plugin .github/workflows/validate.yml
git commit -m "$(cat <<'EOF'
feat(plugin): add Claude Code manifests and split the Codex MCP config

Rename .mcp.json to mcp.codex.json so Claude Code cannot auto-discover a
--root . config, and give Claude an inline mcpServers block using
${CLAUDE_PROJECT_DIR}.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tool-agnostic skill wording

**Files:**
- Modify: `plugins/spec-dashboard/skills/bootstrap-spec-dashboard/SKILL.md:15-20,26`
- Modify: `plugins/spec-dashboard/skills/capture-spec-work/SKILL.md:13-14,24-25,29`
- Modify: `plugins/spec-dashboard/skills/reconcile-spec-dashboard/SKILL.md:12,21,23`
- Modify: `plugins/spec-dashboard/skills/review-spec-quality/SKILL.md:14,20`

**Interfaces:**
- Consumes: the plugin directory from Task 2.
- Produces: skill bodies that name MCP tools without either ecosystem's surface syntax. Frontmatter (`name`, `description`) is unchanged — it is already valid for both.

**Rule:** Codex surfaces these tools as `specdash.query`; Claude Code surfaces them as `mcp__spec-dashboard__query`. Replace every `` `specdash.<tool>` `` reference with the tool-agnostic form — the spec-dashboard `` `<tool>` `` tool — keeping sentences readable rather than mechanically substituted. Do **not** touch `specdash.config.yaml` (a filename, not a tool) or `SPEC-*`/`KB-*` references.

- [ ] **Step 1: Confirm the full reference inventory**

Run: `grep -rn 'specdash\.' plugins/spec-dashboard/skills/*/SKILL.md`
Expected: 16 matching lines. One of them (`bootstrap-spec-dashboard/SKILL.md:3`) is the frontmatter mention of `specdash.config.yaml` — leave it alone. The other 15 are tool references.

- [ ] **Step 2: Rewrite `bootstrap-spec-dashboard/SKILL.md`**

Replace workflow steps 4–9 and the Baseline-content paragraph with:

```markdown
4. Call the spec-dashboard `init` tool with `apply: false`. Show the configuration preview and candidate category mapping before initializing unless the user already approved that exact taxonomy.
5. Call `init` again with `apply: true` after approval. Then call the `scan` tool to obtain stable next IDs.
6. Create a baseline in small batches with the `preview_change` tool. Use `idea` or `backlog` for inferred future work; use `active`, `review`, or `shipped` only when current evidence proves that lifecycle state.
7. Review each preview for duplicate scope, unsupported claims, incorrect relationships, and executable content copied from untrusted sources. Keep imported text as plain Markdown.
8. Apply reviewed previews with the `apply_change` tool and their returned expected revisions.
9. Finish with the `validate` and `build` tools. Do not report success if validation errors remain or the build fails.
```

and, in Baseline content:

```markdown
Use stable `SPEC-*` and `KB-*` IDs from the `scan` tool. Put narrative reasoning in the MDX body and queryable facts in frontmatter.
```

- [ ] **Step 3: Rewrite `capture-spec-work/SKILL.md`**

Replace workflow steps 2, 3, 8, 9 and the Update-behavior sentence with:

```markdown
2. Call the spec-dashboard `query` tool before creating anything. Update an existing item when its intent and acceptance boundary substantially overlap the request.
3. Call the `scan` tool when a new stable ID is needed.
```

```markdown
8. Call the `preview_change` tool and inspect the diff. If the user requested creation or editing, apply the reviewed preview with the `apply_change` tool; otherwise return the preview without writing.
9. Run the `validate` and `build` tools after writes.
```

```markdown
Preserve stable IDs and useful historical decisions. Replace stale claims rather than appending contradictions. Use the `preview_transition` tool for lifecycle changes so the state machine and evidence remain reviewable.
```

- [ ] **Step 4: Rewrite `reconcile-spec-dashboard/SKILL.md`**

Replace workflow steps 1, 6, 8 with:

```markdown
1. Call the spec-dashboard `scan`, `validate`, and `reconcile` tools plus relevant `query` filters to establish current dashboard state. Pass the requested Git boundary to `reconcile` when one is available.
```

```markdown
6. Use the `preview_transition` tool for allowed lifecycle changes and `preview_change` for content edits. Present semantic previews before applying unless the user explicitly requested those exact updates.
```

```markdown
8. Finish with the `validate` and `build` tools.
```

- [ ] **Step 5: Rewrite `review-spec-quality/SKILL.md`**

Replace workflow steps 1 and 7 with:

```markdown
1. Call the spec-dashboard `validate` tool and query the requested entries. Treat schema errors and broken references as blockers, not stylistic feedback.
```

```markdown
7. Re-run the `validate` tool after fixes and build when content changed.
```

- [ ] **Step 6: Verify no surface-specific syntax remains**

Run: `grep -rn 'specdash\.' plugins/spec-dashboard/skills/*/SKILL.md`
Expected: exactly one line — `bootstrap-spec-dashboard/SKILL.md:3`, the `specdash.config.yaml` filename in frontmatter.

Run: `grep -rn 'mcp__' plugins/spec-dashboard/skills/*/SKILL.md`
Expected: no output — Claude-specific syntax must not leak in either.

- [ ] **Step 7: Confirm frontmatter is untouched**

Run: `git diff -U0 plugins/spec-dashboard/skills/ | grep -E '^[+-](name|description):'`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add plugins/spec-dashboard/skills
git commit -m "$(cat <<'EOF'
docs(plugin): make skill tool references tool-agnostic

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md:32-51` (new Claude Code quickstart), `:128` (example ID)
- Modify: `docs/USER_GUIDE.md:44-56` (install section), `:274` (`.mcp.json` reference)
- Modify: `docs/TROUBLESHOOTING.md:13` (`.mcp.json` reference), plus a new entry
- Modify: `docs/AUTOMATION.md:16` (`.mcp.json` reference)
- Modify: `docs/MCP_REFERENCE.md:10` (plugin sentence), `:246` (`.mcp.json` reference)
- Modify: `CLAUDE.md:40-48` (release checklist)

**Interfaces:**
- Consumes: install commands and skill names confirmed in Task 2 Step 8.
- Produces: the documented Claude Code install path referenced by Task 6's post-tag verification.

**Constraint:** tag pins stay at `v0.8.0` in this task. Only the `.mcp.json` → `mcp.codex.json` filename references and new prose change. Task 6 moves the pins.

- [ ] **Step 1: Add the Claude Code quickstart to README**

Insert a new section immediately after the existing "Five-minute Codex quickstart" section (after its closing line, before `## Use this repository`):

```markdown
## Five-minute Claude Code quickstart

Add the marketplace and install the plugin:

```sh
/plugin marketplace add olegtyshcneko/spec-dashboard
/plugin install spec-dashboard@spec-dashboard
```

Open the repository you want to document, then run `/spec-dashboard:bootstrap-spec-dashboard` to inspect the project and create a reviewed dashboard baseline. The skills are also model-invocable — asking for a dashboard in plain language reaches the same workflows.

Continue with:

- `/spec-dashboard:capture-spec-work` — capture an issue, PR, or plan as a validated specification;
- `/spec-dashboard:reconcile-spec-dashboard` — compare documentation with Git evidence;
- `/spec-dashboard:review-spec-quality` — critique readiness without editing.

The bundled MCP server scopes itself to the open project via `${CLAUDE_PROJECT_DIR}`, and the plugin runtime is pinned to a tagged release. Unlike the Codex marketplace ref, the Claude Code marketplace tracks `main`; `/plugin update` offers a new version only when the plugin version changes.
```

Use the skill names exactly as observed in Task 2 Step 8.

- [ ] **Step 2: Remove the example-ID collision in README**

`README.md:128` currently reads `id: SPEC-014` inside the content-model example. A real SPEC-014 arrives in Task 5. Change that line to:

```yaml
id: SPEC-140
```

and, three lines below, leave the rest of the example untouched.

- [ ] **Step 3: Verify no other example collides**

Run: `grep -n 'SPEC-01[345]' README.md docs/*.md`
Expected: no output.

- [ ] **Step 4: Add the Claude Code install path to the user guide**

In `docs/USER_GUIDE.md`, change the requirement line 41 from:

```markdown
- Codex with plugin support for the recommended workflow.
```

to:

```markdown
- Codex or Claude Code with plugin support for the recommended workflow.
```

Then insert a new section immediately after the existing "Install the Codex plugin" section:

```markdown
## Install the Claude Code plugin

Run these commands once inside Claude Code:

```sh
/plugin marketplace add olegtyshcneko/spec-dashboard
/plugin install spec-dashboard@spec-dashboard
```

The four workflows then appear as `/spec-dashboard:bootstrap-spec-dashboard`, `/spec-dashboard:capture-spec-work`, `/spec-dashboard:reconcile-spec-dashboard`, and `/spec-dashboard:review-spec-quality`, and remain available to the model without an explicit command.

The bundled MCP command passes `--root ${CLAUDE_PROJECT_DIR}`, so the server scopes to the project Claude Code has open rather than to its own installation directory. The marketplace tracks `main`; the plugin version pins the runtime, so `/plugin update` surfaces a new release only when that version changes.
```

- [ ] **Step 5: Update the renamed-file references**

Four references name the old file. Update each:

`docs/USER_GUIDE.md:274` — replace the sentence:

```markdown
To update, install a newer reviewed marketplace ref and plugin version. Ensure the plugin manifest and its MCP configuration (`mcp.codex.json` for Codex, the inline `mcpServers` block for Claude Code) point to the same release.
```

`docs/TROUBLESHOOTING.md:13` — replace the sentence:

```markdown
Inspect the installed `spec-dashboard` version and the Git ref in the active plugin MCP configuration (`mcp.codex.json` under Codex, the `mcpServers` block of `.claude-plugin/plugin.json` under Claude Code). Documentation on `main` may describe changes that are not in the currently pinned release.
```

`docs/AUTOMATION.md:16` — replace the sentence:

```markdown
Keep the automation ref aligned with the plugin MCP configuration (`plugins/spec-dashboard/mcp.codex.json`). Do not point production CI at an unreviewed moving branch.
```

`docs/MCP_REFERENCE.md:246` — replace the bullet:

```markdown
- Git release pinned in the plugin MCP configuration (`mcp.codex.json` and the Claude manifest's `mcpServers` block).
```

- [ ] **Step 6: Note both plugins in the MCP reference**

`docs/MCP_REFERENCE.md:10` currently reads:

```markdown
The Codex plugin uses the same command with `--root .`. See the [user guide](USER_GUIDE.md) for the recommended natural-language workflow.
```

Replace with:

```markdown
The Codex plugin uses the same command with `--root .`; the Claude Code plugin uses `--root ${CLAUDE_PROJECT_DIR}`, which Claude Code substitutes with the open project directory. See the [user guide](USER_GUIDE.md) for the recommended natural-language workflow.
```

- [ ] **Step 7: Add the troubleshooting entry**

Append a new section to `docs/TROUBLESHOOTING.md`, following the file's existing heading style:

```markdown
## The plugin MCP server scans the wrong directory

Symptom: under Claude Code, dashboard tools report no project, an uninitialized project, or entries from an unrelated directory.

The Claude Code plugin launches the server with `--root ${CLAUDE_PROJECT_DIR}`. Claude Code substitutes that variable with the open project directory; plugin MCP servers are not guaranteed to start with the project as their working directory, so a configuration using `--root .` would resolve against the plugin installation instead.

Check the `mcpServers` block of the installed `.claude-plugin/plugin.json`:

- if it passes `--root .`, it is a Codex configuration reaching Claude Code — reinstall the plugin;
- if it passes the literal string `${CLAUDE_PROJECT_DIR}` through to the server, the Claude Code build is too old to substitute plugin MCP variables — upgrade Claude Code.

The server exits with an error naming the root it received, so the path it actually used is visible in the MCP server logs.
```

- [ ] **Step 8: Update the release checklist**

In `CLAUDE.md`, replace the tagged-release paragraph (lines 46–48) with:

```markdown
For tagged releases (`git tag v<x.y.z>`, "Release v<x.y.z> …" commit) additionally update the release-pinned references: the `version` field of `plugins/spec-dashboard/.codex-plugin/plugin.json` and `plugins/spec-dashboard/.claude-plugin/plugin.json` (these two must always match each other), and every Git tag pin — the `--package` refs in `plugins/spec-dashboard/mcp.codex.json` and the Claude manifest's `mcpServers` block, the `--ref` in the README and user-guide quickstarts, and the `SPECDASH_REF` values in the automation guide.

Do not enumerate those pins by hand. `npm run check:versions` discovers every pin by pattern and fails when they disagree; `npm run check:versions -- --release` additionally requires the manifest versions and pins to equal the root version, which is the state a release commit must be in. CI runs the default mode on pull requests and pushes, and release mode on tag pushes.
```

- [ ] **Step 9: Verify pins did not move and the guard still passes**

Run: `npm run check:versions`
Expected: `OK — root 0.9.0, release pin v0.8.0, 20 tag pins consistent` — the same count as Task 2. A different count means a pin was added or removed in prose; revert that edit.

- [ ] **Step 10: Verify documentation links resolve**

Run: `grep -c 'mcp.codex.json' docs/*.md README.md`
Expected: `docs/AUTOMATION.md:1`, `docs/MCP_REFERENCE.md:1`, `docs/TROUBLESHOOTING.md:1`, `docs/USER_GUIDE.md:1`, `README.md:0`.

Run: `grep -rn '`\.mcp\.json`' docs/ README.md CLAUDE.md`
Expected: no output — no stale references to the old filename remain.

- [ ] **Step 11: Commit**

```bash
git add README.md docs/USER_GUIDE.md docs/TROUBLESHOOTING.md docs/AUTOMATION.md docs/MCP_REFERENCE.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document the Claude Code plugin and the split MCP configs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Content housekeeping

**Files:**
- Modify: `specdash.config.yaml:62-72` (milestones)
- Create: `content/specs/activity-feed.mdx` (SPEC-013)
- Create: `content/specs/fluid-typography.mdx` (SPEC-014)
- Create: `content/specs/claude-code-plugin.mdx` (SPEC-015)
- Modify: `content/specs/full-text-search.mdx:9` (milestone retarget)

**Interfaces:**
- Consumes: nothing from earlier tasks (content is independent of packaging).
- Produces: SPEC-015, which Task 6 flips to `shipped`; milestone `v0-10-0`, which Task 6 flips to `completed`.

**Verified facts (do not re-derive):** the v0.9.0 scope shipped from `main` between 2026-07-18 (`859db76`, search index) and 2026-07-19 (`c5ecc28`, fluid typography), with `ff47746` (activity filters) also on 2026-07-19. There is **no** `v0.9.0` tag and none will be created — a retroactive tag would violate the rule that a tagged release commit moves every pin. Existing IDs run SPEC-001…SPEC-012, so 013–015 are free.

**Quality bar:** `packages/core/src/project.ts` warns when a `shipped` entry has empty `sourceRefs` (`missing-shipping-evidence`) or no heading matching `/acceptance criteria/i` (`missing-acceptance-criteria`), and when an `active` entry lacks owners (`missing-owner`) or `nextAction` (`missing-next-action`). Every new entry below satisfies these. The current diagnostic count is zero and must stay zero.

- [ ] **Step 1: Add the two milestones**

In `specdash.config.yaml`, insert both entries between the `v0-8-0` block and the `next-release` block, preserving config order (config order = roadmap order):

```yaml
  - id: v0-9-0
    label: v0.9.0 · Search, activity & fluid type
    description: Global full-text search, the git-derived activity feed, and viewport-scaled typography. Delivered from main without a release tag.
    status: completed
    startDate: 2026-07-18
    completedDate: 2026-07-19
  - id: v0-10-0
    label: v0.10.0 · Claude Code plugin
    description: Claude Code packaging alongside the Codex plugin, with mechanical release guards.
    status: active
    startDate: 2026-07-24
```

- [ ] **Step 2: Retarget the shipped search entry**

In `content/specs/full-text-search.mdx`, change line 9 from `milestone: next-release` to:

```yaml
milestone: v0-9-0
```

- [ ] **Step 3: Create SPEC-013 (activity feed)**

Create `content/specs/activity-feed.mdx`:

```mdx
---
schemaVersion: 1
id: SPEC-013
title: Git-derived activity feed
summary: Show what changed in the dashboard over time by deriving creations, lifecycle moves, and edits from Git history.
kind: feature
state: shipped
priority: p1
milestone: v0-9-0
categories: [platform]
tags: [git, activity, history]
owners: [maintainer]
blockers: []
dependsOn: [SPEC-002]
related: [SPEC-003]
sourceRefs:
  - type: file
    value: packages/core/src/activity.ts
  - type: file
    value: packages/renderer/src/pages/activity/index.astro
  - type: file
    value: packages/renderer/src/components/ActivityHistory.astro
  - type: file
    value: docs/superpowers/specs/2026-07-18-activity-feed-design.md
created: 2026-07-18
updated: 2026-07-19
---

## Intent

Let a reader see how the dashboard reached its current state — when entries were created, when work moved between lifecycle states, and when content was edited — without reading Git history by hand.

## Acceptance criteria

- [x] Derive activity from first-parent Git history over the configured content directories, reading historical frontmatter to detect tracked-field changes.
- [x] Emit creation, lifecycle transition, metadata change, edit, and removal events with commit, timestamp, and author attribution.
- [x] Degrade gracefully without Git, on shallow clones, and on Git older than 2.42, building the dashboard without activity rather than failing.
- [x] Render a filterable activity page with URL-backed filters.
- [x] Show per-entry history sections on specification and knowledge detail pages.

## Verification

- Core integration tests drive a scripted temporary repository covering creation, body-only edits, state flips, milestone moves, renames within and across content directories, typechanges, deletions, ID changes, malformed-frontmatter spans, and a divergent-branch merge.
- The Pages workflow checks out full history (`fetch-depth: 0`) so deployed builds carry activity.

## Risks

- Activity depends on commit history quality; squashed or rewritten history changes attribution.
- Large histories increase extraction cost at build time.

## Out of scope

Delivery metrics such as cycle time and throughput, owner-change events, activity in MCP resources, and RSS or JSON activity feeds.
```

- [ ] **Step 4: Create SPEC-014 (fluid typography)**

Create `content/specs/fluid-typography.mdx`:

```mdx
---
schemaVersion: 1
id: SPEC-014
title: Fluid viewport-scaled typography
summary: Scale the type system with viewport width so the dashboard stays proportionate on large displays.
kind: chore
state: shipped
priority: p2
milestone: v0-9-0
categories: [experience]
tags: [typography, responsive, accessibility]
owners: [maintainer]
blockers: []
dependsOn: []
related: [SPEC-010]
sourceRefs:
  - type: commit
    value: c5ecc28
    label: feat(renderer) fluid viewport-scaled typography for large displays
  - type: file
    value: assets/style.css
  - type: file
    value: packages/renderer/src/styles/global.css
created: 2026-07-19
updated: 2026-07-19
---

## Intent

On large displays the fixed type scale left the dashboard reading as a small page stretched across a wide screen. Type, spacing, and component sizing should scale with the viewport instead of stepping only at breakpoints.

## Acceptance criteria

- [x] Express the type scale in fluid, viewport-relative tokens rather than fixed pixel sizes.
- [x] Keep the scale bounded at both ends so small viewports stay readable and very large ones do not overshoot.
- [x] Apply the fluid tokens across shared component styles and page-specific styles from the same token set.
- [x] Preserve the existing font faces, mono display identity, and contrast floor established by SPEC-010.

## Verification

- Rendered pages inspected across small, standard, and large viewport widths.
- Shared and page-level stylesheets consume the same tokens, so no page carries an independent scale.

## Risks

- Viewport-relative sizing interacts with browser zoom and user font-size preferences; the bounded clamp limits, but does not eliminate, surprising combinations.

## Out of scope

Theme switching, further identity work, and per-page typographic exceptions.
```

**Scope boundary (deliberate):** SPEC-010 covered self-hosted faces, the raised *base* scale, and the mono display identity, and shipped in `v0-8-0`. SPEC-014 is the later, distinct capability of scaling that type fluidly with viewport size. SPEC-010 is closed and is not reopened.

- [ ] **Step 5: Create SPEC-015 (this work)**

Create `content/specs/claude-code-plugin.mdx`:

```mdx
---
schemaVersion: 1
id: SPEC-015
title: Claude Code plugin packaging
summary: Ship the existing plugin skills and MCP server to Claude Code alongside Codex from one shared plugin directory.
kind: feature
state: active
priority: p1
milestone: v0-10-0
categories: [platform]
tags: [plugin, claude-code, mcp, packaging]
owners: [maintainer]
nextAction: Release v0.10.0 and verify both install paths from the published tag
blockers: []
dependsOn: [SPEC-004]
related: [SPEC-005]
sourceRefs:
  - type: file
    value: docs/superpowers/specs/2026-07-24-claude-code-plugin-design.md
  - type: file
    value: plugins/spec-dashboard/.claude-plugin/plugin.json
  - type: file
    value: .claude-plugin/marketplace.json
  - type: file
    value: scripts/check-versions.mjs
created: 2026-07-24
updated: 2026-07-24
---

## Intent

Claude Code users cannot install the dashboard workflows today; only Codex packaging exists. One plugin directory should serve both ecosystems, with per-tool manifests and MCP launch configuration as the only difference.

## Acceptance criteria

- [ ] Publish a repository-root Claude Code marketplace whose entry resolves to the shared plugin directory.
- [ ] Ship a Claude Code plugin manifest whose MCP server binds to the open project through `${CLAUDE_PROJECT_DIR}`.
- [ ] Keep the Codex plugin working from a renamed MCP configuration that Claude Code cannot auto-discover.
- [ ] Express skill tool references without either ecosystem's surface syntax.
- [ ] Fail CI when any version string or discovered Git tag pin disagrees, and require full alignment on tag pushes.
- [ ] Document both install paths and the failure mode of a wrongly scoped MCP root.

## Plan

1. Add the discovery-based version and tag-pin guard with tests and CI wiring.
2. Split the MCP configurations and add the Claude Code manifests.
3. Make skill tool references tool-agnostic.
4. Document both install paths.
5. Reconcile dashboard content with what actually shipped.
6. Release v0.10.0 with every version string and tag pin moved together.

## Risks

- Claude Code plugin format details are externally sourced; the manifest linter and local install smokes are the mitigation.
- The MCP configuration rename touches Codex packaging, so both install paths need verification before and after the release tag.

## Out of scope

claude.ai web and Claude desktop app distribution, marketplace ref-pinning for Claude Code installs, behavioral MCP server changes, and new skills beyond the wording pass.
```

- [ ] **Step 6: Validate content and require zero diagnostics**

Run: `npm run validate -- --json`
Expected: valid JSON reporting **15 specs**, 1 knowledge entry, and an empty diagnostics array.

If any diagnostic appears, fix the entry rather than the checker. The likely causes are a missing `## Acceptance criteria` heading, empty `sourceRefs` on a shipped entry, or a milestone ID that is not declared in `specdash.config.yaml`.

- [ ] **Step 7: Confirm the roadmap renders the new milestones**

Run: `npm run build`
Expected: the build completes; `dist/roadmap/index.html` exists.

Run: `grep -c 'v0.9.0 · Search, activity &amp; fluid type\|v0.10.0 · Claude Code plugin' dist/roadmap/index.html`
Expected: a non-zero count (both milestone labels reach the rendered roadmap).

- [ ] **Step 8: Commit**

```bash
git add specdash.config.yaml content/specs
git commit -m "$(cat <<'EOF'
docs(content): record v0.9.0 delivery and capture the Claude Code plugin

Add SPEC-013 (activity feed), SPEC-014 (fluid typography), and SPEC-015
(this work); retarget SPEC-012 to the v0-9-0 milestone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Release v0.10.0

**Files:**
- Modify: `package.json:3`, `packages/{cli,core,mcp,renderer}/package.json` (versions + cross-workspace pins), `package-lock.json`
- Modify: `packages/cli/src/index.ts:10`, `packages/mcp/src/index.ts:14`, `packages/mcp/src/server.ts:32`
- Modify: `plugins/spec-dashboard/.codex-plugin/plugin.json`, `plugins/spec-dashboard/.claude-plugin/plugin.json` (versions + pin)
- Modify: `plugins/spec-dashboard/mcp.codex.json` (pin)
- Modify: `README.md`, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/AUTOMATION.md`, `docs/MCP_REFERENCE.md` (19 doc pins)
- Modify: `specdash.config.yaml` (milestone `v0-10-0` → completed), `content/specs/claude-code-plugin.mdx` (SPEC-015 → shipped)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: tag `v0.10.0` on the release commit; the npx pins reference the tag this task creates.

**Atomicity rule:** the Claude Code marketplace is rolling — the catalog goes live the moment it reaches `main`. Therefore main receives the entire branch in one push, the release commit is its tip, and the tag is pushed with it. No intermediate main state may exist (catalog without manifests, rename without pointer, pins ahead of the tag).

- [ ] **Step 1: Pre-tag Codex smoke on a throwaway tag**

The renamed `mcp.codex.json` must be exercised through a real Codex install before the release. Push the branch and tag a release candidate on it:

```bash
git push -u origin claude-code-plugin
git tag v0.10.0-rc.1
git push origin v0.10.0-rc.1
```

Then, in a scratch directory:

```bash
codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v0.10.0-rc.1
codex plugin add spec-dashboard@spec-dashboard
codex plugin list --json
```

Expected: the plugin installs and lists four skills. This proves manifest-pointer resolution against `mcp.codex.json` and skill discovery. The rc tree's npx pin still references `#v0.8.0`, so the MCP launch itself is covered by the local `--root` check already done in Task 2 Step 9.

- [ ] **Step 2: Remove the release candidate**

```bash
codex plugin remove spec-dashboard@spec-dashboard
codex plugin marketplace remove spec-dashboard
git push origin :refs/tags/v0.10.0-rc.1
git tag -d v0.10.0-rc.1
```

- [ ] **Step 3: Bump the root and workspace versions**

Set `"version": "0.10.0"` in `package.json` and in all four `packages/*/package.json`, and update every cross-workspace pin to `0.10.0`:
- `packages/cli/package.json` — `@spec-dashboard/core`, `@spec-dashboard/renderer`
- `packages/mcp/package.json` — `@spec-dashboard/cli`, `@spec-dashboard/core`
- `packages/renderer/package.json` — `@spec-dashboard/core`

- [ ] **Step 4: Regenerate the lockfile**

Run: `npm install --package-lock-only`

Run: `node -e 'const l=require("./package-lock.json");console.log(l.version,l.packages[""].version,...["cli","core","mcp","renderer"].map(w=>l.packages["packages/"+w].version))'`
Expected: `0.10.0 0.10.0 0.10.0 0.10.0 0.10.0 0.10.0`

- [ ] **Step 5: Update the literal version strings**

- `packages/cli/src/index.ts:10` → `const VERSION = "0.10.0";`
- `packages/mcp/src/index.ts:14` → `console.error("Spec Dashboard MCP 0.10.0 running over stdio");`
- `packages/mcp/src/server.ts:32` → `const server = new McpServer({ name: "spec-dashboard", version: "0.10.0" });`

- [ ] **Step 6: Bump both plugin manifest versions**

Set `"version": "0.10.0"` in `plugins/spec-dashboard/.codex-plugin/plugin.json` and `plugins/spec-dashboard/.claude-plugin/plugin.json`.

- [ ] **Step 7: Move every tag pin**

Run: `grep -rln 'v0\.8\.0' --include='*.md' --include='*.json' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | grep -v docs/superpowers`
Expected file list: `README.md`, `docs/AUTOMATION.md`, `docs/MCP_REFERENCE.md`, `docs/TROUBLESHOOTING.md`, `docs/USER_GUIDE.md`, `plugins/spec-dashboard/mcp.codex.json`, `plugins/spec-dashboard/.claude-plugin/plugin.json`.

Replace `v0.8.0` with `v0.10.0` in exactly those files:

```bash
grep -rl 'v0\.8\.0' --include='*.md' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . \
  | grep -v docs/superpowers \
  | xargs sed -i 's/v0\.8\.0/v0.10.0/g'
```

Every `v0.8.0` occurrence outside `docs/superpowers` is a pin (verified 2026-07-24: 20 occurrences, no prose mentions), so a blanket replace is safe here — `docs/superpowers` artifacts keep their historical pins.

- [ ] **Step 8: Verify release mode passes**

Run: `npm run check:versions -- --release`
Expected: `check-versions (release mode): OK — root 0.10.0, release pin v0.10.0, 20 tag pins consistent`

A failure here names the exact file still holding an old value. Fix it before continuing — this gate is the whole point of Task 1.

- [ ] **Step 9: Flip the shipped state**

In `content/specs/claude-code-plugin.mdx`: set `state: shipped`, remove the `nextAction` line, set `updated: 2026-07-24`, and check every acceptance-criteria box (`- [ ]` → `- [x]`).

In `specdash.config.yaml`, change the `v0-10-0` milestone to:

```yaml
    status: completed
    startDate: 2026-07-24
    completedDate: 2026-07-24
```

- [ ] **Step 10: Run the full gate**

```bash
npm test
npm run validate -- --json
npm run build
npm run check:versions -- --release
npx --yes @anthropic-ai/claude-code@2.1.219 plugin validate ./plugins/spec-dashboard --strict
```

Expected: tests pass; validation reports 15 specs and zero diagnostics; the build completes; release mode is OK; the manifest lints clean.

- [ ] **Step 11: Commit the release**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Release v0.10.0 Claude Code plugin

Move every version string and Git tag pin to v0.10.0, ship SPEC-015, and
close the v0-10-0 milestone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Merge to main and tag atomically**

```bash
git switch main
git merge --ff-only claude-code-plugin
git tag v0.10.0
git push origin main v0.10.0
```

If `--ff-only` is refused, main has moved: rebase the branch onto main, re-run Step 10, and retry. Never push a partial state.

- [ ] **Step 13: Post-tag verification of both install paths**

Claude Code, in a scratch project:
- `/plugin marketplace add olegtyshcneko/spec-dashboard`
- `/plugin install spec-dashboard@spec-dashboard`
- run `/spec-dashboard:review-spec-quality` against a test repository and confirm the MCP tools resolve against that repository.

Codex, in a scratch project:

```bash
codex plugin marketplace add olegtyshcneko/spec-dashboard --ref v0.10.0
codex plugin add spec-dashboard@spec-dashboard
```

Expected: both install and reach a working MCP server from the published tag. This step is inherently post-release — the npx pins reference the tag this task creates. Fix forward if it misbehaves.

- [ ] **Step 14: Clean up the branch**

```bash
git push origin --delete claude-code-plugin
git branch -d claude-code-plugin
```

---

## Verification Summary

| Gate | Command | Where |
|---|---|---|
| Guard unit tests | `node --test scripts/check-versions.test.mjs` | Task 1 |
| Guard on real tree | `npm run check:versions` | Tasks 1, 2, 4 |
| Guard at release | `npm run check:versions -- --release` | Task 6 |
| Manifest lint | `claude plugin validate … --strict` | Tasks 2, 6 |
| Claude install smoke | local marketplace add + install | Task 2 |
| MCP root binding | `node packages/mcp/dist/index.js --root <scratch>` | Task 2 |
| Codex install smoke | `--ref v0.10.0-rc.1` | Task 6 |
| Content diagnostics | `npm run validate -- --json` → zero | Tasks 5, 6 |
| Full suite | `npm test`, `npm run build` | Tasks 1, 5, 6 |
| Published install | both marketplaces from the tag | Task 6 |
