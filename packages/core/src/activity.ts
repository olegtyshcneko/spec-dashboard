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
