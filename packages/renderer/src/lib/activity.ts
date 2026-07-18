import type { ActivityEvent } from "../../../core/dist/index.js";

export type ActivityRow = ActivityEvent & { dateKey: string; count: number; authors: string[] };

export function dateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function describeEvent(event: { type: string; from?: string; to?: string; count?: number }): string {
  switch (event.type) {
    case "created":
      return event.to ? `created as ${event.to}` : "created";
    case "state-changed":
      return `state ${event.from ?? "unset"} → ${event.to ?? "unset"}`;
    case "milestone-changed":
      if (!event.to) return "milestone cleared";
      return event.from ? `milestone ${event.from} → ${event.to}` : `milestone set to ${event.to}`;
    case "priority-changed":
      if (!event.to) return "priority cleared";
      return event.from ? `priority ${event.from} → ${event.to}` : `priority set to ${event.to}`;
    case "removed":
      return "removed";
    default:
      return (event.count ?? 1) > 1 ? `updated ×${event.count}` : "updated";
  }
}

export function mergeUpdated(events: ActivityEvent[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    const day = dateKey(event.timestamp);
    const previous = rows.at(-1);
    if (
      event.type === "updated" &&
      previous?.type === "updated" &&
      previous.entryId === event.entryId &&
      previous.dateKey === day
    ) {
      previous.count += 1;
      if (!previous.authors.includes(event.author)) previous.authors.push(event.author);
      continue;
    }
    rows.push({ ...event, dateKey: day, count: 1, authors: [event.author] });
  }
  return rows;
}
