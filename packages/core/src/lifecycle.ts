import type { SpecFrontmatter } from "./schema.js";

export type ItemState = SpecFrontmatter["state"];

export const allowedTransitions: Record<ItemState, ItemState[]> = {
  idea: ["backlog", "archived"],
  backlog: ["ready", "active", "archived"],
  ready: ["active", "backlog", "archived"],
  active: ["blocked", "review", "backlog"],
  blocked: ["active", "backlog", "archived"],
  review: ["active", "blocked", "shipped"],
  shipped: ["active", "archived"],
  archived: ["backlog"],
};

export function assertTransition(from: ItemState, to: ItemState): void {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) throw new Error(`Invalid lifecycle transition from ${from} to ${to}`);
}
