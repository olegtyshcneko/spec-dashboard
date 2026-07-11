import type { APIRoute } from "astro";
import { snapshot } from "../lib/project";

export const GET: APIRoute = async () => new Response(JSON.stringify(snapshot, null, 2), {
  headers: { "content-type": "application/json; charset=utf-8" },
});
