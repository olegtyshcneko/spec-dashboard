#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSpecDashboardServer } from "./server.js";

function rootArgument(): string {
  const index = process.argv.indexOf("--root");
  return path.resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : process.cwd());
}

async function main(): Promise<void> {
  const server = createSpecDashboardServer(rootArgument());
  await server.connect(new StdioServerTransport());
console.error("Spec Dashboard MCP 0.7.0 running over stdio");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
