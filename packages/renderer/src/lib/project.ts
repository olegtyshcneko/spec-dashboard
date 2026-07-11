import path from "node:path";
import { loadProject, projectSnapshot } from "../../../core/dist/index.js";

export const projectRoot = path.resolve(process.env.SPECDASH_PROJECT_ROOT || "../..");
export const projectModel = loadProject(projectRoot);
export const dashboardConfig = projectModel.config;
const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export function withBase(value = ""): string {
  return `${base}${value.replace(/^\//, "")}`;
}

const rawSnapshot = projectSnapshot(projectModel);
export const snapshot = {
  ...rawSnapshot,
  specs: rawSnapshot.specs.map((entry) => ({ ...entry, href: withBase(entry.href) })),
  knowledge: rawSnapshot.knowledge.map((entry) => ({ ...entry, href: withBase(entry.href) })),
};

export function hrefFor(kind: "specs" | "knowledge", id: string): string {
  return withBase(`${kind}/${id}/`);
}
