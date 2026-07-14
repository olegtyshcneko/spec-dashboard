import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import YAML from "yaml";
import {
  dashboardConfigSchema,
  knowledgeFrontmatterSchema,
  specFrontmatterSchema,
  type DashboardConfig,
  type KnowledgeFrontmatter,
  type SpecFrontmatter,
} from "./schema.js";

export interface ContentEntry<T> {
  id: string;
  slug: string;
  filePath: string;
  relativePath: string;
  body: string;
  data: T;
  analysis: BodyAnalysis;
}

export interface BodyAnalysis {
  headings: string[];
  tasks: { total: number; done: number; open: number };
  wordCount: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "depends-on" | "related";
}

export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
}

export interface ProjectModel {
  root: string;
  config: DashboardConfig;
  specs: ContentEntry<SpecFrontmatter>[];
  knowledge: ContentEntry<KnowledgeFrontmatter>[];
  diagnostics: Diagnostic[];
  edges: GraphEdge[];
  backlinks: Record<string, GraphEdge[]>;
}

export function configPath(root: string): string {
  return path.join(root, "specdash.config.yaml");
}

export function loadConfig(root: string): DashboardConfig {
  const source = fs.readFileSync(configPath(root), "utf8");
  return dashboardConfigSchema.parse(YAML.parse(source));
}

function slugFrom(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/\.(md|mdx)$/i, "");
}

export function analyzeBody(body: string): BodyAnalysis {
  const tasks = [...body.matchAll(/^\s*-\s+\[([ xX])\]\s+/gm)];
  const done = tasks.filter((task) => task[1]?.toLowerCase() === "x").length;
  const headings = [...body.matchAll(/^#{2,6}\s+(.+)$/gm)].map((match) => match[1]!.trim());
  const words = body.replace(/[`*_#[\](){}<>|~-]/g, " ").trim().split(/\s+/).filter(Boolean);
  return { headings, tasks: { total: tasks.length, done, open: tasks.length - done }, wordCount: words.length };
}

function loadEntries<T>(
  root: string,
  baseDir: string,
  collection: "specs" | "knowledge",
  schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
  diagnostics: Diagnostic[],
): ContentEntry<T>[] {
  const absoluteBase = path.resolve(root, baseDir, collection);
  if (!fs.existsSync(absoluteBase)) return [];

  return fg.sync("**/*.{md,mdx}", { cwd: absoluteBase, onlyFiles: true }).sort().flatMap((relativePath) => {
    const filePath = path.join(absoluteBase, relativePath);
    const parsed = matter(fs.readFileSync(filePath, "utf8"));
    const result = schema.safeParse(parsed.data);
    const displayPath = path.relative(root, filePath);
    if (!result.success || !result.data) {
      for (const issue of result.error?.issues ?? []) {
        diagnostics.push({
          severity: "error",
          code: "invalid-frontmatter",
          file: displayPath,
          message: `${issue.path.join(".") || "frontmatter"}: ${issue.message}`,
        });
      }
      return [];
    }
    const data = result.data as T & { id: string };
    return [{
      id: data.id,
      slug: slugFrom(relativePath),
      filePath,
      relativePath: displayPath,
      body: parsed.content.trim(),
      data: result.data,
      analysis: analyzeBody(parsed.content),
    }];
  });
}

export function loadProject(rootInput: string, options: { now?: Date } = {}): ProjectModel {
  const root = path.resolve(rootInput);
  const config = loadConfig(root);
  const diagnostics: Diagnostic[] = [];
  const specs = loadEntries(root, config.contentDir, "specs", specFrontmatterSchema, diagnostics);
  const knowledge = loadEntries(root, config.contentDir, "knowledge", knowledgeFrontmatterSchema, diagnostics);
  const entries = [...specs, ...knowledge];
  const byId = new Map<string, ContentEntry<SpecFrontmatter | KnowledgeFrontmatter>>();
  const categoryIds = new Set(config.categories.map((category) => category.id));
  const milestoneIds = new Set<string>();
  const now = options.now ?? new Date();

  for (const milestone of config.milestones) {
    if (milestoneIds.has(milestone.id)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-milestone",
        file: path.relative(root, configPath(root)),
        message: `Milestone ${milestone.id} is declared more than once`,
      });
    }
    milestoneIds.add(milestone.id);
  }

  for (const entry of entries) {
    const duplicate = byId.get(entry.id);
    if (duplicate) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        file: entry.relativePath,
        message: `${entry.id} is already defined in ${duplicate.relativePath}`,
      });
    } else {
      byId.set(entry.id, entry);
    }

    for (const category of entry.data.categories) {
      if (!categoryIds.has(category)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-category",
          file: entry.relativePath,
          message: `Category ${category} is not declared in specdash.config.yaml`,
        });
      }
    }

    if ("milestone" in entry.data && entry.data.milestone && !milestoneIds.has(entry.data.milestone)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-milestone",
        file: entry.relativePath,
        message: `Milestone ${entry.data.milestone} is not declared in specdash.config.yaml`,
      });
    }
  }

  for (const entry of entries) {
    const references = [
      ...entry.data.related,
      ...("dependsOn" in entry.data ? entry.data.dependsOn : []),
    ];
    for (const reference of references) {
      if (reference === entry.id) {
        diagnostics.push({
          severity: "error",
          code: "self-reference",
          file: entry.relativePath,
          message: `${entry.id} cannot reference itself`,
        });
      } else if (!byId.has(reference)) {
        diagnostics.push({
          severity: "error",
          code: "broken-reference",
          file: entry.relativePath,
          message: `${reference} does not exist`,
        });
      }
    }

    const updatedAt = new Date(`${entry.data.updated}T00:00:00Z`);
    const ageDays = Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
    if (ageDays > config.quality.staleAfterDays && !("state" in entry.data && entry.data.state === "archived")) {
      diagnostics.push({
        severity: "warning",
        code: "stale-entry",
        file: entry.relativePath,
        message: `${entry.id} has not been meaningfully updated for ${ageDays} days`,
      });
    }

    if ("state" in entry.data) {
      const spec = entry.data;
      if (["active", "blocked", "review"].includes(spec.state) && spec.owners.length === 0) {
        diagnostics.push({ severity: "warning", code: "missing-owner", file: entry.relativePath, message: `${entry.id} is ${spec.state} but has no owner` });
      }
      if (["active", "blocked"].includes(spec.state) && !spec.nextAction) {
        diagnostics.push({ severity: "warning", code: "missing-next-action", file: entry.relativePath, message: `${entry.id} is ${spec.state} but has no next action` });
      }
      if (spec.state === "blocked" && spec.blockers.length === 0) {
        diagnostics.push({ severity: "warning", code: "missing-blocker", file: entry.relativePath, message: `${entry.id} is blocked but does not name a blocker` });
      }
      if (["ready", "active", "blocked", "review", "shipped"].includes(spec.state) && !entry.analysis.headings.some((heading) => /acceptance criteria/i.test(heading))) {
        diagnostics.push({ severity: "warning", code: "missing-acceptance-criteria", file: entry.relativePath, message: `${entry.id} is ${spec.state} but has no Acceptance criteria section` });
      }
      if (spec.state === "shipped" && spec.sourceRefs.length === 0) {
        diagnostics.push({ severity: "warning", code: "missing-shipping-evidence", file: entry.relativePath, message: `${entry.id} is shipped but has no source evidence` });
      }
    }
  }

  if (specs.length === 0) {
    diagnostics.push({ severity: "warning", code: "no-specs", message: "No specification entries were found" });
  }

  const edges: GraphEdge[] = [];
  for (const entry of entries) {
    for (const target of entry.data.related) edges.push({ from: entry.id, to: target, type: "related" });
    if ("dependsOn" in entry.data) {
      for (const target of entry.data.dependsOn) edges.push({ from: entry.id, to: target, type: "depends-on" });
    }
  }
  const backlinks = Object.fromEntries(entries.map((entry) => [entry.id, [] as GraphEdge[]]));
  for (const edge of edges) backlinks[edge.to]?.push(edge);

  return { root, config, specs, knowledge, diagnostics, edges, backlinks };
}

export function hasErrors(project: ProjectModel): boolean {
  return project.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function projectSnapshot(project: ProjectModel) {
  return {
    schemaVersion: 1,
    project: project.config.project,
    categories: project.config.categories,
    milestones: project.config.milestones,
    specs: project.specs.map((entry) => ({
      ...entry.data,
      analysis: entry.analysis,
      href: `/specs/${entry.id}/`,
      backlinks: project.backlinks[entry.id] ?? [],
    })),
    knowledge: project.knowledge.map((entry) => ({
      ...entry.data,
      analysis: entry.analysis,
      href: `/knowledge/${entry.id}/`,
      backlinks: project.backlinks[entry.id] ?? [],
    })),
    edges: project.edges,
    diagnostics: project.diagnostics,
  };
}
