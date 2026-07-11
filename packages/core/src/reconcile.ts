import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ContentEntry, ProjectModel } from "./project.js";
import type { KnowledgeFrontmatter, SpecFrontmatter } from "./schema.js";

export type ReconciliationSuggestionKind =
  | "source-changed"
  | "source-missing"
  | "documentation-stale"
  | "transition-candidate";

export interface ReconciliationEvidence {
  type: "git-diff" | "git-history" | "file" | "checklist";
  value: string;
}

export interface ReconciliationSuggestion {
  id: string;
  itemId: string;
  kind: ReconciliationSuggestionKind;
  message: string;
  evidence: ReconciliationEvidence[];
  proposedAction: string;
  confidence: "low" | "medium" | "high";
}

export interface ReconciliationReport {
  repository: { branch: string; head: string; since: string };
  changedFiles: string[];
  suggestions: ReconciliationSuggestion[];
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`Git reconciliation failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function normalizeRepositoryPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function lastCommitTime(root: string, relativePath: string): number | undefined {
  const value = git(root, ["log", "-1", "--format=%ct", "--", relativePath]);
  return value ? Number(value) : undefined;
}

function changedPaths(root: string, since: string): string[] {
  const committed = git(root, ["diff", "--name-only", "--find-renames", `${since}...HEAD`, "--"]);
  const working = git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "");
  return [...new Set([...committed.split("\n"), ...working].map(normalizeRepositoryPath).filter((value): value is string => Boolean(value)))].sort();
}

function pathMatches(changed: string, source: string): boolean {
  return changed === source || changed.startsWith(`${source}/`) || source.startsWith(`${changed}/`);
}

function entrySuggestions(
  root: string,
  entry: ContentEntry<SpecFrontmatter | KnowledgeFrontmatter>,
  changedFiles: string[],
  since: string,
): ReconciliationSuggestion[] {
  const suggestions: ReconciliationSuggestion[] = [];
  const contentCommitTime = lastCommitTime(root, entry.relativePath);
  const fileSources = entry.data.sourceRefs
    .filter((source) => source.type === "file")
    .map((source) => normalizeRepositoryPath(source.value))
    .filter((value): value is string => Boolean(value));
  const changedSources = new Set<string>();

  for (const source of fileSources) {
    const absolute = path.resolve(root, source);
    const insideRoot = absolute === root || absolute.startsWith(`${root}${path.sep}`);
    if (!insideRoot || !fs.existsSync(absolute)) {
      suggestions.push({
        id: `${entry.id}:source-missing:${source}`,
        itemId: entry.id,
        kind: "source-missing",
        message: `${entry.id} references a source path that does not exist: ${source}`,
        evidence: [{ type: "file", value: source }],
        proposedAction: "Correct or remove the source reference after confirming the intended evidence.",
        confidence: "high",
      });
      continue;
    }

    if (changedFiles.some((changed) => pathMatches(changed, source))) {
      changedSources.add(source);
      suggestions.push({
        id: `${entry.id}:source-changed:${source}`,
        itemId: entry.id,
        kind: "source-changed",
        message: `${entry.id} has implementation evidence changed since ${since}: ${source}`,
        evidence: [{ type: "git-diff", value: `${since}...HEAD:${source}` }],
        proposedAction: "Review the specification against the changed source and update it if behavior or scope moved.",
        confidence: "high",
      });
    }

    const sourceCommitTime = lastCommitTime(root, source);
    if (contentCommitTime && sourceCommitTime && sourceCommitTime > contentCommitTime) {
      suggestions.push({
        id: `${entry.id}:documentation-stale:${source}`,
        itemId: entry.id,
        kind: "documentation-stale",
        message: `${source} has a newer Git commit than ${entry.relativePath}.`,
        evidence: [
          { type: "git-history", value: `${entry.relativePath}:${contentCommitTime}` },
          { type: "git-history", value: `${source}:${sourceCommitTime}` },
        ],
        proposedAction: "Check whether the newer implementation commit requires a documentation update.",
        confidence: "medium",
      });
    }
  }

  if ("state" in entry.data && changedSources.size > 0) {
    const spec = entry as ContentEntry<SpecFrontmatter>;
    const tasksComplete = spec.analysis.tasks.total > 0 && spec.analysis.tasks.open === 0;
    const transition = spec.data.state === "backlog" || spec.data.state === "ready"
      ? "active"
      : spec.data.state === "active" && tasksComplete
        ? "review"
        : spec.data.state === "review" && tasksComplete
          ? "shipped"
          : undefined;
    if (transition) {
      suggestions.push({
        id: `${entry.id}:transition-candidate:${transition}`,
        itemId: entry.id,
        kind: "transition-candidate",
        message: `${entry.id} may be ready to move from ${spec.data.state} to ${transition}.`,
        evidence: [
          ...[...changedSources].map((source): ReconciliationEvidence => ({ type: "git-diff", value: `${since}...HEAD:${source}` })),
          { type: "checklist", value: `${spec.analysis.tasks.done}/${spec.analysis.tasks.total} complete` },
        ],
        proposedAction: `Review the evidence, then preview an explicit transition to ${transition} if it is correct.`,
        confidence: tasksComplete ? "medium" : "low",
      });
    }
  }

  return suggestions;
}

export function reconcileProject(project: ProjectModel, options: { since?: string } = {}): ReconciliationReport {
  const root = project.root;
  git(root, ["rev-parse", "--is-inside-work-tree"]);
  const since = options.since ?? project.config.reconciliation.baseRef;
  git(root, ["rev-parse", "--verify", `${since}^{commit}`]);
  const changedFiles = changedPaths(root, since);
  const suggestions = [...project.specs, ...project.knowledge]
    .flatMap((entry) => entrySuggestions(root, entry, changedFiles, since))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    repository: {
      branch: git(root, ["branch", "--show-current"]) || "detached",
      head: git(root, ["rev-parse", "HEAD"]),
      since,
    },
    changedFiles,
    suggestions,
  };
}
