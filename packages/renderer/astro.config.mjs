import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import path from "node:path";

const projectRoot = path.resolve(process.env.SPECDASH_PROJECT_ROOT || "../..");
const outDir = path.resolve(process.env.SPECDASH_OUTPUT_DIR || path.join(projectRoot, "dist"));
const base = process.env.SPECDASH_BASE || "/";

export default defineConfig({
  output: "static",
  outDir,
  base,
  integrations: [mdx()],
  vite: {
    server: {
      fs: { allow: [projectRoot, path.resolve("../..")] },
    },
  },
});
