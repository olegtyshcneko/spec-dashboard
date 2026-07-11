import path from "node:path";
import { loadProject, projectSnapshot } from "@spec-dashboard/core";

export const projectRoot = path.resolve(process.env.SPECDASH_PROJECT_ROOT || "../..");
export const projectModel = loadProject(projectRoot);
export const dashboardConfig = projectModel.config;
export const snapshot = projectSnapshot(projectModel);

export function hrefFor(kind: "specs" | "knowledge", id: string): string {
  return `/${kind}/${id}/`;
}
