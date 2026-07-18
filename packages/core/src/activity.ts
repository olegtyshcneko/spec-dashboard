import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type EntryKind = "spec" | "knowledge";
export type ActivityEventType =
  | "created"
  | "state-changed"
  | "milestone-changed"
  | "priority-changed"
  | "updated"
  | "removed";

export interface TrackedFields {
  id: string;
  title?: string;
  state?: string;
  milestone?: string;
  priority?: string;
}

export interface ChangeDelta {
  type: ActivityEventType;
  from?: string;
  to?: string;
}

export interface ActivityEvent {
  entryId: string;
  entryTitle: string;
  entryKind: EntryKind;
  type: ActivityEventType;
  from?: string;
  to?: string;
  commit: string;
  timestamp: number;
  author: string;
}

export interface ActivityResult {
  available: boolean;
  reason?: string;
  shallow: boolean;
  events: ActivityEvent[];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function projectRevision(content: string): TrackedFields | null {
  if (!content.startsWith("---")) return null;
  const fenceEnd = content.indexOf("\n---", 3);
  if (fenceEnd === -1) return null;
  let data: unknown;
  try {
    data = YAML.parse(content.slice(3, fenceEnd));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    id: record.id,
    title: asString(record.title),
    state: asString(record.state),
    milestone: asString(record.milestone),
    priority: asString(record.priority),
  };
}

const TRACKED: Array<{ field: "state" | "milestone" | "priority"; type: ActivityEventType }> = [
  { field: "state", type: "state-changed" },
  { field: "milestone", type: "milestone-changed" },
  { field: "priority", type: "priority-changed" },
];

export function deriveChanges(
  older: TrackedFields | null,
  newer: TrackedFields | null,
  kind: EntryKind,
): ChangeDelta[] {
  if (!older && !newer) return [];
  if (!older) {
    const created: ChangeDelta = { type: "created" };
    if (kind === "spec" && newer!.state) created.to = newer!.state;
    return [created];
  }
  if (!newer) return [{ type: "removed" }];
  const deltas: ChangeDelta[] = [];
  if (kind === "spec") {
    for (const { field, type } of TRACKED) {
      if (older[field] !== newer[field]) deltas.push({ type, from: older[field], to: newer[field] });
    }
  }
  return deltas.length > 0 ? deltas : [{ type: "updated" }];
}

export interface StatusRecord {
  status: string;
  path: string;
  oldPath?: string;
  score?: number;
}

export interface CommitRecord {
  commit: string;
  timestamp: number;
  author: string;
  files: StatusRecord[];
}

const TYPE_ORDER: Record<ActivityEventType, number> = {
  created: 0,
  "state-changed": 1,
  "milestone-changed": 2,
  "priority-changed": 3,
  updated: 4,
  removed: 5,
};

function classify(prefix: string, filePath: string): EntryKind | null {
  const base = prefix ? `${prefix}/` : "";
  if (!filePath.startsWith(base)) return null;
  const rest = filePath.slice(base.length);
  const kind: EntryKind | null = rest.startsWith("specs/") ? "spec" : rest.startsWith("knowledge/") ? "knowledge" : null;
  return kind && /\.(md|mdx)$/i.test(rest) ? kind : null;
}

interface Lineage {
  last: TrackedFields | null; // last parseable projection; null until first parseable revision
  kind: EntryKind;
}

export function buildEvents(
  commits: CommitRecord[],
  blob: (commit: string, filePath: string) => string | null,
  options: { prefix: string; boundary: Set<string> },
): ActivityEvent[] {
  const lineages = new Map<string, Lineage>();
  const eventsPerCommit = new Map<string, ActivityEvent[]>();

  const enrich = (
    commit: CommitRecord,
    delta: ChangeDelta,
    fields: TrackedFields,
    kind: EntryKind,
  ): ActivityEvent => ({
    entryId: fields.id,
    entryTitle: fields.title ?? fields.id,
    entryKind: kind,
    type: delta.type,
    ...(delta.from !== undefined ? { from: delta.from } : {}),
    ...(delta.to !== undefined ? { to: delta.to } : {}),
    commit: commit.commit,
    timestamp: commit.timestamp,
    author: commit.author,
  });

  for (const commit of [...commits].reverse()) {
    const emitted: ActivityEvent[] = [];
    const emit = (delta: ChangeDelta, fields: TrackedFields, kind: EntryKind) => {
      if (delta.type === "created" && options.boundary.has(commit.commit)) return;
      emitted.push(enrich(commit, delta, fields, kind));
    };

    const records = [...commit.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const record of records) {
      let status = record.status === "T" ? "M" : record.status;
      let filePath = record.path;
      let oldPath = record.oldPath;

      if (status === "R") {
        const oldKind = oldPath ? classify(options.prefix, oldPath) : null;
        const newKind = classify(options.prefix, filePath);
        if (!oldKind && !newKind) continue;
        if (oldKind && !newKind) { status = "D"; filePath = oldPath!; }
        else if (!oldKind && newKind) { status = "A"; }
        else {
          const lineage = lineages.get(oldPath!) ?? { last: null, kind: oldKind! };
          lineages.delete(oldPath!);
          lineages.set(filePath, lineage);
          if (oldKind !== newKind) {
            // Cross-kind rename: removed+created, no differ call (spec dispatcher rule 3).
            const content = record.score === 100 ? null : blob(commit.commit, filePath);
            const newProjection = record.score === 100 ? lineage.last : content === null ? null : projectRevision(content);
            if (lineage.last && newProjection) {
              emit({ type: "removed" }, lineage.last, oldKind!);
              const created: ChangeDelta = { type: "created" };
              if (newKind === "spec" && newProjection.state) created.to = newProjection.state;
              emit(created, newProjection, newKind!);
            } else if (!lineage.last && newProjection) {
              // First parseable revision arrives via the rename: it is the entry's created.
              const created: ChangeDelta = { type: "created" };
              if (newKind === "spec" && newProjection.state) created.to = newProjection.state;
              emit(created, newProjection, newKind!);
            } else if (lineage.last && !newProjection) {
              emit({ type: "updated" }, lineage.last, newKind!);
            }
            lineage.kind = newKind!;
            if (newProjection) lineage.last = newProjection;
            continue;
          }
          if (record.score === 100) continue; // identical content, same kind: no event, regardless of parseability
          status = "M";
        }
      }

      const kind = classify(options.prefix, filePath);
      if (!kind) continue;
      const lineage = lineages.get(filePath) ?? { last: null, kind };
      lineages.set(filePath, lineage);

      if (status === "A" || status === "M") {
        const content = blob(commit.commit, filePath);
        const projection = content === null ? null : projectRevision(content);
        if (projection === null) {
          if (lineage.last) emit({ type: "updated" }, lineage.last, lineage.kind);
          continue;
        }
        if (lineage.last === null) {
          const created: ChangeDelta = { type: "created" };
          if (kind === "spec" && projection.state) created.to = projection.state;
          emit(created, projection, kind);
        } else if (lineage.last.id !== projection.id) {
          emit({ type: "removed" }, lineage.last, lineage.kind);
          const created: ChangeDelta = { type: "created" };
          if (kind === "spec" && projection.state) created.to = projection.state;
          emit(created, projection, kind);
        } else {
          for (const delta of deriveChanges(lineage.last, projection, kind)) emit(delta, projection, kind);
        }
        lineage.last = projection;
        lineage.kind = kind;
      } else if (status === "D") {
        if (lineage.last) emit({ type: "removed" }, lineage.last, lineage.kind);
        lineages.delete(filePath);
      } else {
        // unmodeled status letter → opaque
        if (lineage.last) emit({ type: "updated" }, lineage.last, lineage.kind);
      }
    }

    emitted.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
    // stable within path: records were processed in path order, sort() in V8 is stable
    eventsPerCommit.set(commit.commit, emitted);
  }

  return commits.flatMap((commit) => eventsPerCommit.get(commit.commit) ?? []);
}

const LOG_MAX_BUFFER = 64 * 1024 * 1024;
const BATCH_MAX_BUFFER = 256 * 1024 * 1024;

export function readBlobs(toplevel: string, requests: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (requests.length === 0) return result;
  const input = requests.map((request) => `${request}\u0000`).join("");
  const out = execFileSync("git", ["-C", toplevel, "cat-file", "--batch", "-Z"], {
    input,
    maxBuffer: BATCH_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let offset = 0;
  for (const request of requests) {
    const headerEnd = out.indexOf(0, offset);
    if (headerEnd === -1) {
      result.set(request, null);
      continue;
    }
    const header = out.toString("utf8", offset, headerEnd);
    offset = headerEnd + 1;
    const parts = header.split(" ");
    if (parts.at(-1) === "missing" || parts.at(-1) === "ambiguous") {
      result.set(request, null);
      continue;
    }
    const type = parts[1];
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) {
      result.set(request, null);
      continue;
    }
    result.set(request, type === "blob" ? out.toString("utf8", offset, offset + size) : null);
    offset += size + 1; // payload + trailing NUL
  }
  return result;
}

export function parseLogStream(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  let current: CommitRecord | null = null;
  let pendingStatus: string | null = null;
  let pendingPaths: string[] = [];

  for (const token of raw.split("\u0000")) {
    const headerAt = token.indexOf("\u0001");
    if (headerAt !== -1) {
      const [hash = "", timestamp = "", author = ""] = token.slice(headerAt + 1).split("\u0001");
      current = { commit: hash, timestamp: Number(timestamp), author, files: [] };
      commits.push(current);
      pendingStatus = null;
      pendingPaths = [];
      continue;
    }
    const cleaned = token.replace(/^\n+/, "");
    if (!current || cleaned === "") continue;
    if (pendingStatus === null) {
      pendingStatus = cleaned;
      pendingPaths = [];
      continue;
    }
    pendingPaths.push(token);
    const twoPath = pendingStatus.startsWith("R") || pendingStatus.startsWith("C");
    if (pendingPaths.length === (twoPath ? 2 : 1)) {
      const record: StatusRecord = twoPath
        ? { status: pendingStatus[0]!, path: pendingPaths[1]!, oldPath: pendingPaths[0]! }
        : { status: pendingStatus[0]!, path: pendingPaths[0]! };
      const score = Number(pendingStatus.slice(1));
      if (twoPath && Number.isFinite(score) && pendingStatus.length > 1) record.score = score;
      current.files.push(record);
      pendingStatus = null;
    }
  }
  return commits;
}

function git(cwd: string, args: string[], maxBuffer = LOG_MAX_BUFFER): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  }).replace(/\n$/, "");
}

function gitMeetsMinimum(raw: string): boolean {
  const match = /git version (\d+)\.(\d+)/.exec(raw);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 2 || (major === 2 && minor >= 42);
}

function shallowBoundary(toplevel: string): Set<string> {
  try {
    const shallowFile = git(toplevel, ["rev-parse", "--git-path", "shallow"]);
    const absolute = path.isAbsolute(shallowFile) ? shallowFile : path.join(toplevel, shallowFile);
    return new Set(fs.readFileSync(absolute, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function extractActivity(root: string, config: { contentDir: string }): ActivityResult {
  try {
    if (!gitMeetsMinimum(git(".", ["version"]))) {
      return { available: false, reason: "git >= 2.42 required for activity extraction", shallow: false, events: [] };
    }
    const absoluteRoot = path.resolve(root);
    const toplevel = git(absoluteRoot, ["rev-parse", "--show-toplevel"]);
    const shallow = git(absoluteRoot, ["rev-parse", "--is-shallow-repository"]) === "true";
    const prefix = path
      .relative(toplevel, path.resolve(absoluteRoot, config.contentDir))
      .split(path.sep)
      .join("/");
    const pathspecs = [
      prefix ? `${prefix}/specs` : "specs",
      prefix ? `${prefix}/knowledge` : "knowledge",
    ];

    let raw = "";
    try {
      raw = git(toplevel, [
        "log",
        "--first-parent",
        "--diff-merges=first-parent",
        "-z",
        "--name-status",
        "--find-renames",
        "--format=%x01%H%x01%ct%x01%an",
        "--",
        ...pathspecs,
      ]);
    } catch (error) {
      const message = String(error instanceof Error && "stderr" in error ? (error as { stderr: unknown }).stderr : error);
      if (/does not have any commits yet|bad default revision/i.test(message)) {
        return { available: true, shallow, events: [] };
      }
      throw error;
    }

    const commits = parseLogStream(raw);
    const requests: string[] = [];
    for (const commit of commits) {
      for (const record of commit.files) {
        if (record.status === "D") continue;
        if (classify(prefix, record.path) === null) continue;
        requests.push(`${commit.commit}:${record.path}`);
      }
    }
    const blobs = readBlobs(toplevel, requests);
    const boundary = shallow ? shallowBoundary(toplevel) : new Set<string>();
    const events = buildEvents(commits, (commit, filePath) => blobs.get(`${commit}:${filePath}`) ?? null, {
      prefix,
      boundary,
    });
    return { available: true, shallow, events };
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr: unknown }).stderr).trim() : "";
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: stderr || message, shallow: false, events: [] };
  }
}
