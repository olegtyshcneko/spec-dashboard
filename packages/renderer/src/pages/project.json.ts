import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { dashboardConfig } from "../lib/project";

export const GET: APIRoute = async () => {
  const specs = await getCollection("specs");
  const knowledge = await getCollection("knowledge");
  return new Response(JSON.stringify({
    schemaVersion: 1,
    project: dashboardConfig.project,
    specs: specs.map((entry) => ({ ...entry.data, href: `/specs/${entry.data.id}/` })),
    knowledge: knowledge.map((entry) => ({ ...entry.data, href: `/knowledge/${entry.data.id}/` })),
  }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
};
