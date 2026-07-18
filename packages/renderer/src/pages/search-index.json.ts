import type { APIRoute } from "astro";
import { mdxBodyToPlainText } from "../../../core/dist/index.js";
import { projectModel, hrefFor } from "../lib/project";

const specRecords = projectModel.specs
  .filter((entry) => entry.data.state !== "archived")
  .map((entry) => ({
    id: entry.id,
    collection: "spec",
    title: entry.data.title,
    summary: entry.data.summary,
    kind: entry.data.kind,
    state: entry.data.state,
    ...(entry.data.milestone ? { milestone: entry.data.milestone } : {}),
    tags: (entry.data.tags ?? []).join(" "),
    url: hrefFor("specs", entry.id),
    body: mdxBodyToPlainText(entry.body),
  }));

const knowledgeRecords = projectModel.knowledge.map((entry) => ({
  id: entry.id,
  collection: "knowledge",
  title: entry.data.title,
  summary: entry.data.summary,
  kind: entry.data.kind,
  tags: (entry.data.tags ?? []).join(" "),
  url: hrefFor("knowledge", entry.id),
  body: mdxBodyToPlainText(entry.body),
}));

export const GET: APIRoute = async () =>
  new Response(JSON.stringify([...specRecords, ...knowledgeRecords]), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
