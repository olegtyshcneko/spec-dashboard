import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { assertTransition, configPath, hasErrors, loadProject, projectSnapshot, reconcileProject } from "@spec-dashboard/core";
import { ChangeStore } from "./change-store.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

async function buildProject(root: string, base?: string): Promise<{ exitCode: number; output: string }> {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/bin.mjs");
  return await new Promise((resolve) => {
    const args = [cli, "build", "--root", root];
    if (base) args.push("--base", base);
    const child = spawn(process.execPath, args, { cwd: root, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("exit", (code) => resolve({ exitCode: code ?? 1, output: output.slice(-24_000) }));
  });
}

export function createSpecDashboardServer(rootInput: string): McpServer {
  const root = fs.realpathSync(path.resolve(rootInput));
  let changes: ChangeStore | undefined;
  const changeStore = () => changes ??= new ChangeStore(root);
  const server = new McpServer({ name: "spec-dashboard", version: "0.7.0" });

  const readJson = (uri: string, value: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });

  server.registerTool("specdash.init", {
    title: "Initialize spec dashboard",
    description: "Preview or create the bounded project configuration and content directories in an uninitialized repository",
    inputSchema: {
      projectName: z.string().min(1),
      categories: z.array(z.object({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().min(1) })).min(1).default([{ id: "general", label: "General" }]),
      apply: z.boolean().default(false),
    },
    outputSchema: { initialized: z.boolean(), applied: z.boolean(), configPath: z.string(), preview: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ projectName, categories, apply }) => {
    const target = configPath(root);
    if (fs.existsSync(target)) throw new Error(`Project is already initialized at ${target}`);
    const preview = `schemaVersion: 1\nproject:\n  name: ${JSON.stringify(projectName)}\n  tagline: Specifications and project knowledge\ncontentDir: content\noutputDir: dist\nbase: /\nquality:\n  staleAfterDays: 90\nreconciliation:\n  baseRef: HEAD~1\ncategories:\n${categories.map((category) => `  - id: ${category.id}\n    label: ${JSON.stringify(category.label)}`).join("\n")}\n`;
    if (apply) {
      fs.mkdirSync(path.join(root, "content/specs"), { recursive: true });
      fs.mkdirSync(path.join(root, "content/knowledge"), { recursive: true });
      fs.writeFileSync(target, preview, { encoding: "utf8", flag: "wx" });
      changes = new ChangeStore(root);
    }
    return textResult({ initialized: apply, applied: apply, configPath: path.relative(root, target), preview });
  });

  server.registerResource("project-summary", "specdash://project/summary", {
    title: "Spec dashboard project summary",
    description: "Validated specs, knowledge, counts, and quality diagnostics",
    mimeType: "application/json",
  }, async () => readJson("specdash://project/summary", projectSnapshot(loadProject(root))));

  server.registerResource("project-graph", "specdash://project/graph", {
    title: "Spec dashboard relationship graph",
    description: "Dependency, related-entry, and backlink edges",
    mimeType: "application/json",
  }, async () => {
    const project = loadProject(root);
    return readJson("specdash://project/graph", { edges: project.edges, backlinks: project.backlinks });
  });

  server.registerResource("project-diagnostics", "specdash://project/diagnostics", {
    title: "Spec dashboard diagnostics",
    description: "Schema, relationship, readiness, and freshness diagnostics",
    mimeType: "application/json",
  }, async () => readJson("specdash://project/diagnostics", loadProject(root).diagnostics));

  server.registerResource("project-item", new ResourceTemplate("specdash://items/{id}", {
    list: async () => {
      const project = loadProject(root);
      return { resources: [...project.specs, ...project.knowledge].map((entry) => ({ uri: `specdash://items/${entry.id}`, name: `${entry.id} · ${entry.data.title}`, mimeType: "application/json" })) };
    },
    complete: { id: async (value) => [...loadProject(root).specs, ...loadProject(root).knowledge].map((entry) => entry.id).filter((id) => id.startsWith(value)) },
  }), {
    title: "Spec dashboard item",
    description: "One specification or knowledge entry with body, analysis, and backlinks",
    mimeType: "application/json",
  }, async (uri, variables) => {
    const id = String(variables.id);
    const project = loadProject(root);
    const entry = [...project.specs, ...project.knowledge].find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown item ${id}`);
    return readJson(uri.toString(), { ...entry.data, body: entry.body, analysis: entry.analysis, backlinks: project.backlinks[id] ?? [] });
  });

  server.registerTool("specdash.validate", {
    title: "Validate spec dashboard",
    description: "Validate schema, categories, references, readiness, and freshness without changing files",
    inputSchema: {},
    outputSchema: { valid: z.boolean(), specs: z.number(), knowledge: z.number(), diagnostics: z.array(z.record(z.string(), z.unknown())) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const project = loadProject(root);
    return textResult({ valid: !hasErrors(project), specs: project.specs.length, knowledge: project.knowledge.length, diagnostics: project.diagnostics });
  });

  server.registerTool("specdash.query", {
    title: "Query spec dashboard",
    description: "Query specs and knowledge with structured filters",
    inputSchema: {
      collection: z.enum(["all", "specs", "knowledge"]).default("all"),
      state: z.string().optional(),
      kind: z.string().optional(),
      category: z.string().optional(),
      milestone: z.string().optional(),
      owner: z.string().optional(),
      text: z.string().optional(),
    },
    outputSchema: { count: z.number(), entries: z.array(z.record(z.string(), z.unknown())) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ collection, state, kind, category, milestone, owner, text }) => {
    const snapshot = projectSnapshot(loadProject(root));
    const entries = collection === "specs" ? snapshot.specs : collection === "knowledge" ? snapshot.knowledge : [...snapshot.specs, ...snapshot.knowledge];
    const query = text?.toLowerCase();
    const filtered = entries.filter((entry) => {
      if (state && (!("state" in entry) || entry.state !== state)) return false;
      if (kind && entry.kind !== kind) return false;
      if (category && !entry.categories.includes(category)) return false;
      if (milestone && (!("milestone" in entry) || entry.milestone !== milestone)) return false;
      if (owner && (!("owners" in entry) || !entry.owners.includes(owner))) return false;
      const haystack = [entry.id, entry.title, entry.summary, ...entry.tags, ...entry.categories].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    });
    return textResult({ count: filtered.length, entries: filtered });
  });

  server.registerTool("specdash.scan", {
    title: "Scan spec dashboard content",
    description: "Inventory project content and identify unowned active work, orphan knowledge, and the next stable IDs",
    inputSchema: {},
    outputSchema: {
      counts: z.record(z.string(), z.number()),
      nextSpecId: z.string(),
      nextKnowledgeId: z.string(),
      unownedActive: z.array(z.string()),
      orphanKnowledge: z.array(z.string()),
      diagnostics: z.array(z.record(z.string(), z.unknown())),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const project = loadProject(root);
    const nextId = (prefix: "SPEC" | "KB", ids: string[]) => `${prefix}-${String(Math.max(0, ...ids.map((id) => Number(id.split("-")[1]))) + 1).padStart(3, "0")}`;
    const counts = Object.fromEntries(["idea", "backlog", "ready", "active", "blocked", "review", "shipped", "archived"].map((state) => [state, project.specs.filter((entry) => entry.data.state === state).length]));
    const connected = new Set(project.edges.flatMap((edge) => [edge.from, edge.to]));
    return textResult({
      counts,
      nextSpecId: nextId("SPEC", project.specs.map((entry) => entry.id)),
      nextKnowledgeId: nextId("KB", project.knowledge.map((entry) => entry.id)),
      unownedActive: project.specs.filter((entry) => ["active", "blocked", "review"].includes(entry.data.state) && entry.data.owners.length === 0).map((entry) => entry.id),
      orphanKnowledge: project.knowledge.filter((entry) => !connected.has(entry.id)).map((entry) => entry.id),
      diagnostics: project.diagnostics,
    });
  });

  server.registerTool("specdash.reconcile", {
    title: "Reconcile specs with Git evidence",
    description: "Report changed source references, stale documentation, and reviewable lifecycle candidates without changing files",
    inputSchema: { since: z.string().min(1).optional() },
    outputSchema: {
      repository: z.object({ branch: z.string(), head: z.string(), since: z.string() }),
      changedFiles: z.array(z.string()),
      suggestions: z.array(z.object({
        id: z.string(),
        itemId: z.string(),
        kind: z.enum(["source-changed", "source-missing", "documentation-stale", "transition-candidate"]),
        message: z.string(),
        evidence: z.array(z.object({ type: z.enum(["git-diff", "git-history", "file", "checklist"]), value: z.string() })),
        proposedAction: z.string(),
        confidence: z.enum(["low", "medium", "high"]),
      })),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ since }) => textResult(reconcileProject(loadProject(root), { since })));

  server.registerTool("specdash.preview_change", {
    title: "Preview spec dashboard content change",
    description: "Create a hash-bound preview for a Markdown or MDX content file without writing it",
    inputSchema: { relativePath: z.string().min(1), content: z.string().min(1) },
    outputSchema: { changeId: z.string(), relativePath: z.string(), expectedRevision: z.string(), diff: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ relativePath, content }) => {
    const preview = changeStore().preview(relativePath, content);
    return textResult({ changeId: preview.changeId, relativePath, expectedRevision: preview.expectedRevision, diff: preview.diff });
  });

  server.registerTool("specdash.preview_transition", {
    title: "Preview work item transition",
    description: "Preview a lifecycle transition and optional evidence update without writing files",
    inputSchema: {
      id: z.string().regex(/^SPEC-\d{3,}$/),
      state: z.enum(["idea", "backlog", "ready", "active", "blocked", "review", "shipped", "archived"]),
      evidence: z.object({ type: z.enum(["file", "issue", "pull-request", "commit", "url"]), value: z.string().min(1), label: z.string().optional() }).optional(),
    },
    outputSchema: { changeId: z.string(), relativePath: z.string(), expectedRevision: z.string(), diff: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, state, evidence }) => {
    const project = loadProject(root);
    const entry = project.specs.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown specification ${id}`);
    assertTransition(entry.data.state, state);
    const parsed = matter(fs.readFileSync(entry.filePath, "utf8"));
    parsed.data.state = state;
    parsed.data.updated = new Date().toISOString().slice(0, 10);
    if (evidence) parsed.data.sourceRefs = [...(parsed.data.sourceRefs ?? []), evidence];
    const content = matter.stringify(parsed.content, parsed.data);
    const preview = changeStore().preview(entry.relativePath, content);
    return textResult({ changeId: preview.changeId, relativePath: preview.relativePath, expectedRevision: preview.expectedRevision, diff: preview.diff });
  });

  server.registerTool("specdash.apply_change", {
    title: "Apply reviewed spec dashboard change",
    description: "Apply a previously previewed change when its expected revision still matches; invalid projects are rolled back",
    inputSchema: { changeId: z.string().length(64), expectedRevision: z.string().min(3) },
    outputSchema: { applied: z.boolean(), relativePath: z.string(), revision: z.string(), diagnostics: z.array(z.record(z.string(), z.unknown())) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ changeId, expectedRevision }) => textResult(changeStore().apply(changeId, expectedRevision)));

  server.registerTool("specdash.build", {
    title: "Build static spec dashboard",
    description: "Validate and generate the configured static dashboard output",
    inputSchema: { base: z.string().min(1).optional() },
    outputSchema: { exitCode: z.number(), output: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ base }) => textResult(await buildProject(root, base)));

  return server;
}
