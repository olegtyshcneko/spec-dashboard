#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { configPath, hasErrors, loadProject, reconcileProject } from "@spec-dashboard/core";

const require = createRequire(import.meta.url);
const VERSION = "0.5.1";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function printDiagnostics(project: ReturnType<typeof loadProject>, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({
      valid: !hasErrors(project),
      counts: { specs: project.specs.length, knowledge: project.knowledge.length },
      diagnostics: project.diagnostics,
    }, null, 2) + "\n");
    return;
  }
  for (const diagnostic of project.diagnostics) {
    const location = diagnostic.file ? ` ${diagnostic.file}` : "";
    process.stdout.write(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}: ${diagnostic.message}\n`);
  }
  process.stdout.write(`${project.specs.length} specs, ${project.knowledge.length} knowledge entries, ${project.diagnostics.length} diagnostics\n`);
}

async function runAstro(command: "build" | "dev", root: string, outDir?: string, baseOverride?: string): Promise<number> {
  const rendererRoot = fileURLToPath(new URL("../../renderer/", import.meta.url));
  const astroPackage = require.resolve("astro/package.json");
  const astroBin = path.join(path.dirname(astroPackage), "bin/astro.mjs");
  const config = loadProject(root).config;
  const env = {
    ...process.env,
    SPECDASH_PROJECT_ROOT: root,
    SPECDASH_OUTPUT_DIR: path.resolve(root, outDir || config.outputDir),
    SPECDASH_BASE: baseOverride ?? config.base,
  };
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [astroBin, command, "--root", rendererRoot], { env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function initialize(root: string): void {
  if (fs.existsSync(configPath(root))) throw new Error(`Project already initialized at ${root}`);
  fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "content/knowledge"), { recursive: true });
  fs.writeFileSync(configPath(root), `schemaVersion: 1\nproject:\n  name: ${path.basename(root)}\n  tagline: Specifications and project knowledge\ncontentDir: content\noutputDir: dist\nbase: /\nquality:\n  staleAfterDays: 90\nreconciliation:\n  baseRef: HEAD~1\ncategories:\n  - id: general\n    label: General\n`);
  process.stdout.write(`Initialized spec dashboard at ${root}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2] || "help";
  if (command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const root = path.resolve(arg("--root", process.cwd())!);
  if (command === "init") {
    initialize(root);
    return;
  }
  if (command === "validate") {
    const project = loadProject(root);
    printDiagnostics(project, process.argv.includes("--json"));
    process.exitCode = hasErrors(project) ? 1 : 0;
    return;
  }
  if (command === "reconcile") {
    const report = reconcileProject(loadProject(root), { since: arg("--since") });
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${report.changedFiles.length} changed files, ${report.suggestions.length} suggestions since ${report.repository.since}\n`);
      for (const suggestion of report.suggestions) process.stdout.write(`${suggestion.kind.toUpperCase()} ${suggestion.itemId}: ${suggestion.message}\n`);
    }
    return;
  }
  if (command === "build" || command === "dev") {
    const project = loadProject(root);
    printDiagnostics(project, false);
    if (hasErrors(project)) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runAstro(command, root, arg("--out-dir"), arg("--base"));
    return;
  }
  process.stdout.write(`specdash ${VERSION}\n\nCommands:\n  init       Initialize content and configuration\n  validate   Validate schema and references\n  reconcile  Compare specs with Git evidence\n  build      Generate a static dashboard\n  dev        Start the Astro development server\n\nOptions:\n  --root <path>\n  --out-dir <path>\n  --base <url-path>\n  --since <git-ref>\n  --json\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
