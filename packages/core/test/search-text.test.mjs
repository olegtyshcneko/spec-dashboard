import assert from "node:assert/strict";
import test from "node:test";
import { mdxBodyToPlainText } from "../dist/index.js";

const sample = [
  'import { Chart } from "./chart.js";',
  'import Widget',
  '  from "widget";',
  "",
  "## Delivery notes",
  "",
  "The **reconcile** loop compares [Git evidence](https://example.com/evidence) with specs.",
  "",
  "![Roadmap overview](./roadmap.png)",
  "",
  '<Widget kind="stat" label="Specs shipped">',
  "  Eleven specs shipped.",
  "</Widget>",
  "",
  "{new Date().getFullYear()}",
  "",
  "Run `specdash validate` before building.",
  "",
  "```ts",
  'import MiniSearch from "minisearch";',
  'const button = "<button>";',
  "```",
].join("\n");

test("strips MDX syntax but keeps searchable text including code content", () => {
  assert.equal(
    mdxBodyToPlainText(sample),
    'Delivery notes The reconcile loop compares Git evidence with specs. ' +
      'Roadmap overview Eleven specs shipped. Run specdash validate before building. ' +
      'import MiniSearch from "minisearch"; const button = "<button>";',
  );
});

test("caps output at the limit", () => {
  const long = "word ".repeat(6000);
  assert.equal(mdxBodyToPlainText(long).length, 20000);
  assert.equal(mdxBodyToPlainText("alpha beta gamma", 5), "alpha");
});

test("returns empty string for empty body", () => {
  assert.equal(mdxBodyToPlainText(""), "");
});
