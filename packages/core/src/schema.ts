import { z } from "zod";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const ID_PATTERN = /^(SPEC|KB)-\d{3,}$/;

const dateSchema = z.union([
  z.string().regex(DATE_PATTERN),
  z.date(),
]).transform((value) => value instanceof Date ? value.toISOString().slice(0, 10) : value);

export const itemKindSchema = z.enum(["feature", "bug", "chore", "spike"]);
export const itemStateSchema = z.enum([
  "idea",
  "backlog",
  "ready",
  "active",
  "blocked",
  "review",
  "shipped",
  "archived",
]);
export const prioritySchema = z.enum(["p0", "p1", "p2", "p3"]);
export const knowledgeKindSchema = z.enum([
  "research",
  "adr",
  "architecture",
  "glossary",
  "runbook",
]);

export const sourceRefSchema = z.object({
  type: z.enum(["file", "issue", "pull-request", "commit", "url"]),
  value: z.string().min(1),
  label: z.string().min(1).optional(),
});

const commonFields = {
  schemaVersion: z.literal(1),
  id: z.string().regex(ID_PATTERN),
  title: z.string().min(3),
  summary: z.string().min(10),
  categories: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).default([]),
  related: z.array(z.string().regex(ID_PATTERN)).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
  created: dateSchema,
  updated: dateSchema,
  featured: z.boolean().default(false),
};

export const specFrontmatterSchema = z.object({
  ...commonFields,
  id: z.string().regex(/^SPEC-\d{3,}$/),
  kind: itemKindSchema,
  state: itemStateSchema,
  priority: prioritySchema,
  owners: z.array(z.string().min(1)).default([]),
  nextAction: z.string().min(3).optional(),
  blockers: z.array(z.string().min(3)).default([]),
  dependsOn: z.array(z.string().regex(/^SPEC-\d{3,}$/)).default([]),
});

export const knowledgeFrontmatterSchema = z.object({
  ...commonFields,
  id: z.string().regex(/^KB-\d{3,}$/),
  kind: knowledgeKindSchema,
  authors: z.array(z.string().min(1)).default([]),
  sources: z.array(z.string().min(1)).default([]),
});

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().min(1),
  description: z.string().optional(),
  match: z.array(z.string()).default([]),
});

export const dashboardConfigSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    name: z.string().min(1),
    tagline: z.string().default("Specifications and project knowledge"),
  }),
  contentDir: z.string().default("content"),
  outputDir: z.string().default("dist"),
  base: z.string().default("/"),
  categories: z.array(categorySchema).default([]),
  quality: z.object({
    staleAfterDays: z.number().int().positive().default(90),
  }).default({ staleAfterDays: 90 }),
  reconciliation: z.object({
    baseRef: z.string().min(1).default("HEAD~1"),
  }).default({ baseRef: "HEAD~1" }),
});

export type SpecFrontmatter = z.infer<typeof specFrontmatterSchema>;
export type KnowledgeFrontmatter = z.infer<typeof knowledgeFrontmatterSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
