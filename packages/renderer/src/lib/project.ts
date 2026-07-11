import path from "node:path";
import { loadConfig } from "@spec-dashboard/core";

export const projectRoot = path.resolve(process.env.SPECDASH_PROJECT_ROOT || "../..");
export const dashboardConfig = loadConfig(projectRoot);

export function hrefFor(kind: "specs" | "knowledge", id: string): string {
  return `/${kind}/${id}/`;
}
