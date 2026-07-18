import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";

const parser = unified().use(remarkParse).use(remarkMdx);

interface MdastNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MdastNode[];
}

const DROPPED_TYPES = new Set([
  "mdxjsEsm",
  "mdxFlowExpression",
  "mdxTextExpression",
  "yaml",
  "html",
  "definition",
]);

const VALUE_TYPES = new Set(["text", "code", "inlineCode"]);

export function mdxBodyToPlainText(body: string, limit = 20000): string {
  const tree = parser.parse(body) as unknown as MdastNode;
  const parts: string[] = [];
  collect(tree, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function collect(node: MdastNode, parts: string[]): void {
  if (DROPPED_TYPES.has(node.type)) return;
  if (node.type === "image" || node.type === "imageReference") {
    if (node.alt) parts.push(node.alt);
    return;
  }
  if (VALUE_TYPES.has(node.type) && typeof node.value === "string") {
    parts.push(node.value);
    return;
  }
  for (const child of node.children ?? []) collect(child, parts);
}
