import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import path from "node:path";
import { loadConfig, knowledgeFrontmatterSchema, specFrontmatterSchema } from "@spec-dashboard/core";

const projectRoot = path.resolve(process.env.SPECDASH_PROJECT_ROOT || "../..");
const config = loadConfig(projectRoot);
const contentRoot = path.resolve(projectRoot, config.contentDir);

const specs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: path.join(contentRoot, "specs") }),
  schema: specFrontmatterSchema,
});

const knowledge = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: path.join(contentRoot, "knowledge") }),
  schema: knowledgeFrontmatterSchema,
});

export const collections = { specs, knowledge };
