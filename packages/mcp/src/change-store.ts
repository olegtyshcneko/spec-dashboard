import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasErrors, loadProject, type Diagnostic } from "@spec-dashboard/core";

export interface ChangePreview {
  changeId: string;
  relativePath: string;
  expectedRevision: string;
  diff: string;
  content: string;
}

export interface ApplyResult {
  applied: boolean;
  relativePath: string;
  revision: string;
  diagnostics: Diagnostic[];
}

function hash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function previewDiff(relativePath: string, before: string, after: string): string {
  const beforeLines = before ? before.split("\n").map((line) => `-${line}`) : ["-(new file)"];
  const afterLines = after.split("\n").map((line) => `+${line}`);
  return [`--- a/${relativePath}`, `+++ b/${relativePath}`, ...beforeLines, ...afterLines].join("\n").slice(0, 24_000);
}

export class ChangeStore {
  readonly root: string;
  readonly contentRoot: string;
  private readonly changes = new Map<string, ChangePreview>();

  constructor(rootInput: string) {
    this.root = fs.realpathSync(path.resolve(rootInput));
    const config = loadProject(this.root).config;
    this.contentRoot = fs.realpathSync(path.resolve(this.root, config.contentDir));
  }

  private resolveContentPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) throw new Error("Change paths must be relative to the project root");
    if (!/\.(md|mdx)$/i.test(relativePath)) throw new Error("Only Markdown and MDX content files can be changed");
    const target = path.resolve(this.root, relativePath);
    const relation = path.relative(this.contentRoot, target);
    if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("Change path is outside the configured content root");
    const parent = fs.realpathSync(path.dirname(target));
    const parentRelation = path.relative(this.contentRoot, parent);
    if (parentRelation.startsWith("..") || path.isAbsolute(parentRelation)) throw new Error("Change path resolves through a directory outside the content root");
    if (fs.existsSync(target)) {
      const realTarget = fs.realpathSync(target);
      const targetRelation = path.relative(this.contentRoot, realTarget);
      if (targetRelation.startsWith("..") || path.isAbsolute(targetRelation)) throw new Error("Change target resolves outside the content root");
    }
    return target;
  }

  revision(relativePath: string): string {
    const target = this.resolveContentPath(relativePath);
    return fs.existsSync(target) ? hash(fs.readFileSync(target, "utf8")) : "new";
  }

  preview(relativePath: string, content: string): ChangePreview {
    const target = this.resolveContentPath(relativePath);
    const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    const expectedRevision = before ? hash(before) : "new";
    const changeId = hash(`${relativePath}\0${expectedRevision}\0${content}`);
    const preview = { changeId, relativePath, expectedRevision, diff: previewDiff(relativePath, before, content), content };
    this.changes.set(changeId, preview);
    return preview;
  }

  get(changeId: string): ChangePreview | undefined {
    return this.changes.get(changeId);
  }

  apply(changeId: string, expectedRevision: string): ApplyResult {
    const change = this.changes.get(changeId);
    if (!change) throw new Error("Unknown or expired change preview");
    if (expectedRevision !== change.expectedRevision) throw new Error("Expected revision does not match the preview");
    if (this.revision(change.relativePath) !== expectedRevision) throw new Error("Content changed after the preview was created");

    const target = this.resolveContentPath(change.relativePath);
    const existed = fs.existsSync(target);
    const before = existed ? fs.readFileSync(target, "utf8") : "";
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
    fs.writeFileSync(temp, change.content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, target);

    const project = loadProject(this.root);
    if (hasErrors(project)) {
      if (existed) fs.writeFileSync(target, before, "utf8");
      else fs.unlinkSync(target);
      throw new Error(`Change would invalidate the project: ${project.diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; ")}`);
    }

    this.changes.delete(changeId);
    return { applied: true, relativePath: change.relativePath, revision: hash(change.content), diagnostics: project.diagnostics };
  }
}
