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
    }];
  });
}

export function loadProject(rootInput: string): ProjectModel {
  const root = path.resolve(rootInput);
  const config = loadConfig(root);
  const diagnostics: Diagnostic[] = [];
  const specs = loadEntries(root, config.contentDir, "specs", specFrontmatterSchema, diagnostics);
  const knowledge = loadEntries(root, config.contentDir, "knowledge", knowledgeFrontmatterSchema, diagnostics);
  const entries = [...specs, ...knowledge];
  const byId = new Map<string, ContentEntry<SpecFrontmatter | KnowledgeFrontmatter>>();
  const categoryIds = new Set(config.categories.map((category) => category.id));

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
  }

  if (specs.length === 0) {
    diagnostics.push({ severity: "warning", code: "no-specs", message: "No specification entries were found" });
  }

  return { root, config, specs, knowledge, diagnostics };
}

export function hasErrors(project: ProjectModel): boolean {
  return project.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
