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
      // Test files carry deliberately mismatched fixture pins; they are not release material.
      if (entry.name.endsWith(".test.mjs")) continue;
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
